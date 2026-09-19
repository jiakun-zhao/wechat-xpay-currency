/* oxlint-disable eslint/one-var, eslint/max-params, eslint/no-nested-ternary, unicorn/numeric-separators-style */

import { createHash, createHmac, randomBytes } from 'node:crypto'
import type { ErrorBody, ErrorCategory, FetchJsonResult, Result } from './types'

/** 生成符合微信代币支付规范的订单号。 */
export function createOrderId(prefix = 'ORD'): string {
  const normalizedPrefix = prefix.replace(/[^A-Za-z0-9]/g, '').toUpperCase() || 'ORD',
    timestamp = Date.now().toString(36).toUpperCase(),
    random = randomBytes(5).toString('hex').toUpperCase()
  return `${normalizedPrefix}${timestamp}${random}`.slice(0, 32)
}

/** 根据沙箱标志返回协议要求的环境编号。 */
export function envOf(isSandbox: boolean): 0 | 1 {
  return isSandbox ? 1 : 0
}

/** 计算十六进制格式的 HMAC-SHA256 摘要。 */
export function hmacSha256(key: string, value: string): string {
  return createHmac('sha256', key).update(value).digest('hex')
}

/** 计算代币支付接口使用的支付侧签名。 */
export function paymentSignature(appKey: string, path: string, body: string): string {
  return hmacSha256(appKey, `${path}&${body}`)
}

/** 计算代币支付请求使用的用户会话签名。 */
export function sessionSignature(sessionKey: string, body: string): string {
  return hmacSha256(sessionKey, body)
}

/** 创建稳定的接口地址，同时保留可选的自定义测试服务地址。 */
export function apiUrl(origin: string, path: string, query?: Record<string, string>): string {
  const url = new URL(path, origin)
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value)
    }
  }
  return url.toString()
}

/** 创建具有统一错误结构的校验失败结果。 */
export function validationError(message: string): Result<never> {
  return failure('validation', -3, message)
}

/** 为一次操作创建带类型的失败结果。 */
export function failure(category: ErrorCategory, code: number, message: string): Result<never> {
  const error: ErrorBody = { category, code, message }
  return { success: false, error }
}

/** 创建保留微信错误码和错误信息的失败结果。 */
export function wechatFailure(code: number, message: string): Result<never> {
  const category: ErrorCategory =
    code === 268_490_006
      ? 'insufficient_balance'
      : code === 268490009
        ? 'session_expired'
        : 'wechat'
  const error: ErrorBody = {
    category,
    code,
    message,
    wechatCode: code,
    wechatMessage: message,
  }
  return { success: false, error }
}

/** 校验代币支付接口接受的金额。 */
export function validAmount(amount: unknown): amount is number {
  return typeof amount === 'number' && Number.isSafeInteger(amount) && amount > 0
}

/** 校验符合协议要求的订单号。 */
export function validOrderId(orderId: unknown): orderId is string {
  return typeof orderId === 'string' && /^[A-Z0-9]{8,32}$/.test(orderId)
}

/** 将未知的抛出值转换为可读的错误信息。 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 解析上游接口返回的 JSON，并对异常响应进行分类。 */
export async function fetchJson(url: string, init: RequestInit): Promise<FetchJsonResult> {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch (error) {
    return { ok: false, result: failure('network', -1, errorMessage(error)) }
  }

  let data: unknown
  try {
    data = await response.json()
  } catch (error) {
    return { ok: false, result: failure('json', -2, errorMessage(error)) }
  }
  return { ok: true, status: response.status, data }
}

/** 计算小程序充值使用的规范化签名载荷。 */
export function rechargeSignData(
  credits: number,
  env: 0 | 1,
  offerId: string,
  orderId: string,
): string {
  return JSON.stringify({
    attach: `credits:${credits}`,
    buyQuantity: credits,
    currencyType: 'CNY',
    env,
    offerId,
    outTradeNo: orderId,
  })
}

/** 根据任意文本创建确定性的短标识符。 */
export function hashOrderId(prefix: string, value: string): string {
  return `${prefix}${createHash('sha256').update(value).digest('hex').slice(0, 26).toUpperCase()}`
}
