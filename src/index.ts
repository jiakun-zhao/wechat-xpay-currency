/* oxlint-disable eslint/one-var, eslint/max-params, eslint/no-undefined, unicorn/prefer-export-from */

import type {
  AccessTokenCache,
  AccessTokenOnly,
  AccessTokenResult,
  AppCredentials,
  BalanceResult,
  MutationResult,
  Options,
  OrderInput,
  OrderResult,
  RechargeInput,
  RefundInput,
  RefundResult,
  RechargeSignResult,
  Result,
  SessionKeyResult,
  SessionOptions,
  XpayResult,
} from './types'
import {
  apiUrl,
  createOrderId,
  envOf,
  failure,
  fetchJson,
  hmacSha256,
  paymentSignature,
  rechargeSignData,
  sessionSignature,
  validAmount,
  validOrderId,
  wechatFailure,
} from './utils'

export type {
  AccessTokenCache,
  AccessTokenOnly,
  AccessTokenResult,
  AppCredentials,
  BalanceResult,
  ErrorBody,
  ErrorCategory,
  MutationResult,
  Options,
  OrderInput,
  OrderResult,
  RefundInput,
  RefundResult,
  RechargeSignResult,
  RechargeInput,
  Result,
  SessionKeyResult,
  SessionOptions,
  XpayResult,
} from './types'

/** 官方微信接口使用的默认服务地址。 */
export const WECHAT_API_ORIGIN = 'https://api.weixin.qq.com'

const TOKEN_PATH = '/cgi-bin/stable_token',
  SESSION_PATH = '/sns/jscode2session',
  BALANCE_PATH = '/xpay/query_user_balance',
  CHARGE_PATH = '/xpay/currency_pay',
  PRESENT_PATH = '/xpay/present_currency',
  REFUND_PATH = '/xpay/cancel_currency_pay',
  RECHARGE_PATH = 'requestVirtualPayment',
  DEFAULT_USER_IP = '127.0.0.1'

/** 使用应用凭证换取稳定的微信访问令牌。 */
export async function getAccessToken(options: AppCredentials): Promise<Result<AccessTokenResult>> {
  const response = await fetchJson(apiUrl(options.apiOrigin ?? WECHAT_API_ORIGIN, TOKEN_PATH), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      appid: options.appId,
      force_refresh: false,
      grant_type: 'client_credential',
      secret: options.appSecret,
    }),
  })
  if (!response.ok) {
    return response.result
  }
  if (!isRecord(response.data)) {
    return failure('protocol', -2, 'WeChat returned an invalid response')
  }
  if (typeof response.data.errcode === 'number' && response.data.errcode !== 0) {
    return wechatFailure(response.data.errcode, stringOrDefault(response.data.errmsg))
  }
  if (response.status < 200 || response.status >= 300) {
    return failure('http', response.status, `HTTP ${response.status}`)
  }
  if (
    typeof response.data.access_token !== 'string' ||
    typeof response.data.expires_in !== 'number'
  ) {
    return failure('protocol', -2, 'WeChat returned an invalid access token response')
  }
  return {
    success: true,
    accessToken: response.data.access_token,
    expiresIn: response.data.expires_in,
  }
}

/** 使用小程序登录码换取 openid 和会话密钥。 */
export async function getSessionKey(options: SessionOptions): Promise<Result<SessionKeyResult>> {
  const url = apiUrl(options.apiOrigin ?? WECHAT_API_ORIGIN, SESSION_PATH, {
      appid: options.appId,
      secret: options.appSecret,
      js_code: options.code,
      grant_type: 'authorization_code',
    }),
    response = await fetchJson(url, { method: 'GET' })
  if (!response.ok) {
    return response.result
  }
  if (!isRecord(response.data)) {
    return failure('protocol', -2, 'WeChat returned an invalid response')
  }
  if (typeof response.data.errcode === 'number' && response.data.errcode !== 0) {
    return wechatFailure(response.data.errcode, stringOrDefault(response.data.errmsg))
  }
  if (response.status < 200 || response.status >= 300) {
    return failure('http', response.status, `HTTP ${response.status}`)
  }
  if (typeof response.data.openid !== 'string' || typeof response.data.session_key !== 'string') {
    return failure('protocol', -2, 'WeChat returned an invalid session response')
  }
  return { success: true, openid: response.data.openid, sessionKey: response.data.session_key }
}

/** 使用小程序登录码换取 openid 和会话密钥。 */
export const jscode2session = getSessionKey

/** 提供一个轻量且零运行时依赖的微信代币接口客户端。 */
export class WeChatXpayCurrency {
  private readonly options: Options
  private tokenCache: AccessTokenCache | undefined

  /** 创建一个微信代币客户端。 */
  constructor(options: Options) {
    this.options = options
  }

  /** 查询用户当前的微信代币余额。 */
  async queryBalance(): Promise<Result<BalanceResult>> {
    return this.xpayBalance()
  }

  /** 查询用户当前的微信代币余额。 */
  async getBalance(): Promise<Result<BalanceResult>> {
    return this.queryBalance()
  }

  /** 扣除微信代币并返回扣除后的余额。 */
  async charge(input: OrderInput): Promise<Result<OrderResult>>
  /** 扣除微信代币并返回扣除后的余额。 */
  async charge(amount: number, orderId?: string): Promise<Result<OrderResult>>
  async charge(inputOrAmount: OrderInput | number, orderId?: string): Promise<Result<OrderResult>> {
    const input = normalizeOrderInput(inputOrAmount, orderId)
    if (!input) {
      return failure('validation', -3, 'A positive integer amount is required')
    }
    const id = input.orderId ?? createOrderId('CHG')
    return this.mutate(CHARGE_PATH, input.amount, id, [0]).then((result) => {
      if (!result.success) {
        return result
      }
      return mutationOrderResult(id, result.response)
    })
  }

  /** 退还之前扣除的代币，并返回两个订单号及余额。 */
  async refund(input: RefundInput): Promise<Result<RefundResult>>
  /** 退还之前扣除的代币，并返回两个订单号及余额。 */
  async refund(
    amount: number,
    orderId: string,
    refundOrderId?: string,
  ): Promise<Result<RefundResult>>
  async refund(
    inputOrAmount: RefundInput | number,
    orderId?: string,
    refundOrderId?: string,
  ): Promise<Result<RefundResult>> {
    const input = normalizeRefundInput(inputOrAmount, orderId, refundOrderId)
    if (!input) {
      return failure(
        'validation',
        -3,
        'A positive integer amount and original orderId are required',
      )
    }
    const id = input.refundOrderId ?? createOrderId('RFD')
    return this.mutate(
      REFUND_PATH,
      input.amount,
      id,
      [0, 268_490_004, 268_490_005, 268_490_014],
      input.orderId,
    ).then(async (result) => {
      if (!result.success) {
        return result
      }
      const balance = await this.xpayBalance()
      return balance.success
        ? { success: true, refundOrderId: id, orderId: input.orderId, balance: balance.balance }
        : balance
    })
  }

  /** 赠送微信代币并返回赠送后的余额。 */
  async present(input: OrderInput): Promise<Result<OrderResult>>
  /** 赠送微信代币并返回赠送后的余额。 */
  async present(amount: number, orderId?: string): Promise<Result<OrderResult>>
  async present(
    inputOrAmount: OrderInput | number,
    orderId?: string,
  ): Promise<Result<OrderResult>> {
    const input = normalizeOrderInput(inputOrAmount, orderId)
    if (!input) {
      return failure('validation', -3, 'A positive integer amount is required')
    }
    const id = input.orderId ?? createOrderId('PRS')
    return this.mutate(PRESENT_PATH, input.amount, id, [0, 268_490_004]).then((result) => {
      if (!result.success) {
        return result
      }
      return mutationOrderResult(id, result.response)
    })
  }

  /** 创建发起小程序充值所需的签名载荷。 */
  async recharge(credits: number, orderId?: string): Promise<Result<RechargeSignResult>>
  /** 创建发起小程序充值所需的签名载荷。 */
  async recharge(input: RechargeInput): Promise<Result<RechargeSignResult>>
  async recharge(
    inputOrCredits: number | RechargeInput,
    orderId?: string,
  ): Promise<Result<RechargeSignResult>> {
    const credits = typeof inputOrCredits === 'number' ? inputOrCredits : inputOrCredits.credits,
      id = typeof inputOrCredits === 'number' ? orderId : inputOrCredits.orderId
    if (!validAmount(credits)) {
      return failure('validation', -3, 'A positive integer credits value is required')
    }
    const order = id ?? createOrderId('RCG')
    if (!validOrderId(order)) {
      return failure('validation', -3, 'orderId must be 8-32 uppercase letters or digits')
    }
    const signData = rechargeSignData(
      credits,
      envOf(this.options.isSandbox),
      this.options.offerId,
      order,
    )
    return {
      success: true,
      orderId: order,
      signData,
      paySig: paymentSignature(this.selectedAppKey(), RECHARGE_PATH, signData),
      signature: sessionSignature(this.options.sessionKey, signData),
    }
  }

  /** 创建发起小程序充值所需的签名载荷。 */
  async createRechargeSignature(
    credits: number,
    orderId?: string,
  ): Promise<Result<RechargeSignResult>> {
    return this.recharge(credits, orderId)
  }

  /** 获取并缓存应用访问令牌，直到令牌即将过期。 */
  private async accessToken(): Promise<Result<AccessTokenOnly>> {
    if (this.options.accessToken) {
      return { success: true, accessToken: this.options.accessToken }
    }
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now()) {
      return { success: true, accessToken: this.tokenCache.token }
    }
    const result = await getAccessToken(this.options)
    if (!result.success) {
      return result
    }
    this.tokenCache = {
      token: result.accessToken,
      expiresAt: Date.now() + Math.max(0, result.expiresIn - 30) * 1000,
    }
    return { success: true, accessToken: result.accessToken }
  }

  /** 返回当前环境对应的支付密钥。 */
  private selectedAppKey(): string {
    return this.options.isSandbox ? this.options.appSandboxKey : this.options.appKey
  }

  /** 通过带签名的 xpay 接口查询余额。 */
  private async xpayBalance(): Promise<Result<BalanceResult>> {
    const result = await this.xpay(BALANCE_PATH, {
      env: envOf(this.options.isSandbox),
      openid: this.options.openid,
      user_ip: this.options.userIp ?? DEFAULT_USER_IP,
    })
    if (!result.success) {
      return result
    }
    if (typeof result.data.errcode === 'number' && result.data.errcode !== 0) {
      return wechatFailure(result.data.errcode, stringOrDefault(result.data.errmsg))
    }
    if (typeof result.data.balance === 'number') {
      return { success: true, balance: result.data.balance }
    }
    return failure('protocol', -2, 'WeChat returned an invalid balance response')
  }

  /** 执行带签名的 xpay 变更操作，并应用协议规定的幂等规则。 */
  private async mutate(
    path: string,
    amount: number,
    orderId: string,
    successCodes: readonly number[],
    payOrderId?: string,
  ): Promise<Result<MutationResult>> {
    if (!validOrderId(orderId) || (payOrderId !== undefined && !validOrderId(payOrderId))) {
      return failure('validation', -3, 'order identifiers must be 8-32 uppercase letters or digits')
    }
    const payload = {
        env: envOf(this.options.isSandbox),
        openid: this.options.openid,
        amount,
        order_id: orderId,
        ...(payOrderId === undefined ? {} : { pay_order_id: payOrderId }),
        user_ip: this.options.userIp ?? DEFAULT_USER_IP,
      },
      result = await this.xpay(path, payload)
    if (!result.success) {
      return result
    }
    const code = typeof result.data.errcode === 'number' ? result.data.errcode : 0
    if (!successCodes.includes(code)) {
      return wechatFailure(code, stringOrDefault(result.data.errmsg))
    }
    return { success: true, response: result.data }
  }

  /** 向 xpay 接口发起一次带签名的请求。 */
  private async xpay(path: string, payload: Record<string, unknown>): Promise<Result<XpayResult>> {
    const token = await this.accessToken()
    if (!token.success) {
      return token
    }
    const body = JSON.stringify(payload),
      url = apiUrl(this.options.apiOrigin ?? WECHAT_API_ORIGIN, path, {
        access_token: token.accessToken,
        pay_sig: paymentSignature(this.selectedAppKey(), path, body),
        signature: sessionSignature(this.options.sessionKey, body),
      }),
      response = await fetchJson(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      })
    if (!response.ok) {
      return response.result
    }
    if (!isRecord(response.data)) {
      return failure('protocol', -2, 'WeChat returned an invalid response')
    }
    if (response.status < 200 || response.status >= 300) {
      return failure('http', response.status, `HTTP ${response.status}`)
    }
    return { success: true, data: response.data }
  }
}

/** 检查一个值是否为 JSON 对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 将可选的错误信息转换为稳定的字符串。 */
function stringOrDefault(value: unknown): string {
  return typeof value === 'string' ? value : 'WeChat returned an error'
}

/** 规范化位置参数和对象形式的订单参数。 */
function normalizeOrderInput(
  inputOrAmount: OrderInput | number,
  orderId?: string,
): OrderInput | undefined {
  const input =
    typeof inputOrAmount === 'number' ? { amount: inputOrAmount, orderId } : inputOrAmount
  return validAmount(input.amount) ? input : undefined
}

/** 规范化位置参数和对象形式的退款参数。 */
function normalizeRefundInput(
  inputOrAmount: RefundInput | number,
  orderId?: string,
  refundOrderId?: string,
): RefundInput | undefined {
  const input =
    typeof inputOrAmount === 'number'
      ? { amount: inputOrAmount, orderId: orderId ?? '', refundOrderId }
      : inputOrAmount
  return validAmount(input.amount) && validOrderId(input.orderId) ? input : undefined
}

/** 将余额变更响应转换为包含订单号和剩余余额的结果。 */
function mutationOrderResult(
  orderId: string,
  response: Record<string, unknown>,
): Result<OrderResult> {
  if (typeof response.balance !== 'number') {
    return failure('protocol', -2, 'WeChat returned an invalid mutation response')
  }
  return { success: true, orderId, balance: response.balance }
}

export {
  apiUrl,
  createOrderId,
  envOf,
  hmacSha256,
  paymentSignature,
  rechargeSignData,
  sessionSignature,
}
