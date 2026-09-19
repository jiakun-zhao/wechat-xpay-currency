/** 标识操作失败的类别。 */
export type ErrorCategory =
  | 'validation'
  | 'network'
  | 'json'
  | 'http'
  | 'wechat'
  | 'insufficient_balance'
  | 'session_expired'
  | 'protocol'

/** 描述失败的操作，并在可用时保留上游错误信息。 */
export interface ErrorBody {
  category: ErrorCategory
  code: number
  message: string
  wechatCode?: number
  wechatMessage?: string
}

/** 表示所有公开操作返回的结果。 */
export type Result<T extends object> =
  | ({ success: true } & T)
  | { success: false; error: ErrorBody }

/** 配置微信代币客户端。 */
export interface Options {
  openid: string
  sessionKey: string
  accessToken: string
  appId: string
  appSecret: string
  offerId: string
  isSandbox: boolean
  appKey: string
  appSandboxKey: string
  apiOrigin?: string
  userIp?: string
}

/** 配置应用凭证请求。 */
export interface AppCredentials {
  appId: string
  appSecret: string
  apiOrigin?: string
}

/** 配置小程序登录码换取请求。 */
export interface SessionOptions extends AppCredentials {
  code: string
}

/** 包含应用访问令牌及其有效期。 */
export interface AccessTokenResult {
  accessToken: string
  expiresIn: number
}

/** 包含登录码换取接口返回的身份信息。 */
export interface SessionKeyResult {
  openid: string
  sessionKey: string
}

/** 包含用户当前的微信代币余额。 */
export interface BalanceResult {
  balance: number
}

/** 包含扣币或赠币操作的结果。 */
export interface OrderResult {
  orderId: string
  balance: number
}

/** 包含退款操作的结果。 */
export interface RefundResult {
  refundOrderId: string
  orderId: string
  balance: number
}

/** 包含小程序支付接口所需的签名载荷。 */
export interface RechargeSignResult {
  orderId: string
  signData: string
  paySig: string
  signature: string
}

/** 描述金额和可选的幂等键。 */
export interface OrderInput {
  amount: number
  orderId?: string
}

/** 描述退款及其对应的原扣币订单。 */
export interface RefundInput {
  amount: number
  orderId: string
  refundOrderId?: string
}

/** 存储缓存的访问令牌，且不引入额外的运行时类型。 */
export interface AccessTokenCache {
  token: string
  expiresAt: number
}

/** 仅包含用于内部组装请求的访问令牌。 */
export interface AccessTokenOnly {
  accessToken: string
}

/** 表示 xpay 接口返回的 JSON 对象。 */
export type XpayResponse = Record<string, unknown>

/** 包含解析后的 xpay 响应，用于内部组装请求。 */
export interface XpayResult {
  data: XpayResponse
}

/** 包含余额变更操作成功时的内部结果。 */
export interface MutationResult {
  response: XpayResponse
}

/** 描述充值代币数量和可选的充值订单号。 */
export interface RechargeInput {
  credits: number
  orderId?: string
}

/** 表示成功解析的 HTTP JSON 响应。 */
export interface FetchJsonSuccess {
  ok: true
  status: number
  data: unknown
}

/** 表示解析失败的 HTTP JSON 响应。 */
export interface FetchJsonFailure {
  ok: false
  result: Result<never>
}

/** 表示成功或失败的 HTTP JSON 解析结果。 */
export type FetchJsonResult = FetchJsonSuccess | FetchJsonFailure
