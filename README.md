# @jiakun-zhao/wechat-xpay-currency

![NPM Version](https://img.shields.io/npm/v/@jiakun-zhao/wechat-xpay-currency?labelColor=%23000&color=%23954)
![NPM License](https://img.shields.io/npm/l/@jiakun-zhao/wechat-xpay-currency?labelColor=%23000&color=%23954)

一个面向服务端的微信代币（虚拟支付）轻量 TypeScript 客户端。它封装了微信访问令牌、小程序登录会话、余额查询、扣币、赠币、退款和充值签名，并统一返回可判别的 `Result` 结果。

## 特性

- 零运行时第三方依赖，使用原生 `fetch` 和 `node:crypto`。
- 支持生产环境和沙箱环境，`isSandbox` 会同时决定请求中的 `env` 和支付密钥。
- 统一处理网络错误、JSON 错误、HTTP 错误、微信业务错误和协议错误。
- 微信响应缺少 `errcode` 或 `errcode` 为 `0` 时按成功路径处理；非零 `errcode` 优先作为微信错误处理，成功结果仍会校验必需字段。
- `charge` 和 `present` 直接使用对应接口响应中的剩余 `balance`，每次只请求一次；`refund` 成功后会额外查询余额。
- 空的 `accessToken` 会自动获取稳定访问令牌，并在同一实例中缓存到令牌即将过期前。
- 支持显式订单号，便于调用方进行幂等重试。

## 安装

```bash
pnpm add @jiakun-zhao/wechat-xpay-currency
```

## 运行环境与安全要求

> ⚠️ **必须仅在受信任的服务端运行。** 所有微信密钥、会话密钥和访问令牌都不可下发到浏览器、小程序或其他不受信任的客户端。

本包是 ESM 包，运行环境需要提供全局 `fetch`，并支持 `node:crypto`。它面向服务端运行，不能把微信 `appSecret`、`appKey`、`appSandboxKey`、`sessionKey` 或访问令牌下发到浏览器、小程序或其他不受信任的客户端。

建议由自己的服务端接收业务请求，在服务端创建 `WeChatXpayCurrency` 并调用本包；客户端只接收经过业务授权和校验后的结果。`recharge` 生成的签名载荷可以按微信支付流程返回给小程序使用，但必须由服务端按业务规则生成，客户端不能自行替换金额、订单号或用户身份。

## 快速开始

下面的示例展示余额查询、扣币和充值签名。示例只使用服务端环境变量保存敏感配置：

```ts
import { WeChatXpayCurrency, type Options } from '@jiakun-zhao/wechat-xpay-currency'

const options: Options = {
  openid: '用户的 openid',
  sessionKey: process.env.WECHAT_SESSION_KEY ?? '',
  // 传入非空值时直接使用；传入空字符串时由实例自动获取并缓存。
  accessToken: '',
  appId: process.env.WECHAT_APP_ID ?? '',
  appSecret: process.env.WECHAT_APP_SECRET ?? '',
  offerId: process.env.WECHAT_OFFER_ID ?? '',
  isSandbox: true,
  appKey: process.env.WECHAT_APP_KEY ?? '',
  appSandboxKey: process.env.WECHAT_APP_SANDBOX_KEY ?? '',
}

const xpay = new WeChatXpayCurrency(options)

const balance = await xpay.queryBalance()
if (!balance.success) {
  console.error(balance.error.category, balance.error.message)
} else {
  console.log('当前余额:', balance.balance)
}

const charge = await xpay.charge({
  amount: 10,
  orderId: 'CHARGEORDER1',
})
if (charge.success) {
  console.log('扣币成功，剩余余额:', charge.balance)
}

const recharge = await xpay.createRechargeSignature(100, 'RECHARGE1')
if (recharge.success) {
  // 将签名结果交给后续微信支付流程；客户端不可自行修改或重算。
  console.log(recharge.signData, recharge.paySig, recharge.signature)
}
```

## 统一结果与错误

所有公开的异步操作都返回 `Promise<Result<T>>`。通过 `success` 进行类型收窄：

```ts
const result = await xpay.getBalance()

if (result.success) {
  result.balance
} else {
  result.error.category
  result.error.code
  result.error.message
}
```

### `Result<T>`

成功结果的形状是 `{ success: true, ...data }`，失败结果的形状是 `{ success: false, error }`。

### `ErrorBody`

| 字段            | 类型                  | 说明                           |
| --------------- | --------------------- | ------------------------------ |
| `category`      | `ErrorCategory`       | 统一错误类别                   |
| `code`          | `number`              | 本地错误码或微信错误码         |
| `message`       | `string`              | 可读的错误信息                 |
| `wechatCode`    | `number \| undefined` | 微信返回的 `errcode`（如果有） |
| `wechatMessage` | `string \| undefined` | 微信返回的 `errmsg`（如果有）  |

### `ErrorCategory`

| 类别                   | 含义                                 |
| ---------------------- | ------------------------------------ |
| `validation`           | 输入参数不符合本包要求               |
| `network`              | `fetch` 网络请求失败                 |
| `json`                 | 响应无法解析为 JSON                  |
| `http`                 | HTTP 状态码不在成功范围              |
| `wechat`               | 微信返回的其他非零业务错误           |
| `insufficient_balance` | 微信错误码 `268490006`，余额不足     |
| `session_expired`      | 微信错误码 `268490009`，会话已过期   |
| `protocol`             | 响应缺少成功所需字段或格式不符合预期 |

微信接口可能不返回 `errcode` 和 `errmsg`。本包将缺少 `errcode` 与 `errcode === 0` 都视为成功候选；如果存在非零 `errcode`，会先返回微信错误。即使错误码为空或为 `0`，仍会继续校验该接口要求的成功字段，例如访问令牌、会话信息或 `balance`。

## `getAccessToken`

```ts
getAccessToken(options: AppCredentials): Promise<Result<AccessTokenResult>>
```

调用微信 `POST /cgi-bin/stable_token`，使用 `appId` 和 `appSecret` 获取稳定访问令牌。

成功结果：

```ts
{
  success: true,
  accessToken: string,
  expiresIn: number,
}
```

参数：

```ts
interface AppCredentials {
  appId: string
  appSecret: string
  apiOrigin?: string
}
```

`apiOrigin` 用于测试或自定义服务地址；默认值是 `WECHAT_API_ORIGIN`（`https://api.weixin.qq.com`）。

## `getSessionKey` / `jscode2session`

```ts
getSessionKey(options: SessionOptions): Promise<Result<SessionKeyResult>>
jscode2session(options: SessionOptions): Promise<Result<SessionKeyResult>>
```

两者是同一个操作，调用微信 `GET /sns/jscode2session`，用小程序登录码换取 `openid` 和 `sessionKey`。

```ts
interface SessionOptions extends AppCredentials {
  code: string
}

interface SessionKeyResult {
  openid: string
  sessionKey: string
}
```

## `Options` 配置

`WeChatXpayCurrency` 构造函数接收以下配置：

```ts
interface Options {
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
```

| 字段            | 说明                                                  |
| --------------- | ----------------------------------------------------- |
| `openid`        | 当前用户的微信 `openid`                               |
| `sessionKey`    | 当前用户会话密钥，用于生成会话签名                    |
| `accessToken`   | 现有访问令牌；传入空字符串时自动调用 `getAccessToken` |
| `appId`         | 小程序或应用 `appid`                                  |
| `appSecret`     | 服务端应用密钥                                        |
| `offerId`       | 充值使用的代币商品 `offerId`                          |
| `isSandbox`     | 是否使用沙箱环境                                      |
| `appKey`        | 生产环境支付密钥                                      |
| `appSandboxKey` | 沙箱环境支付密钥                                      |
| `apiOrigin`     | 可选的自定义接口地址，默认使用 `WECHAT_API_ORIGIN`    |
| `userIp`        | 可选的用户 IP；未提供时使用 `127.0.0.1`               |

### 访问令牌获取与缓存

只有 `accessToken === ''` 时，实例才会自动调用 `getAccessToken`。自动获取的令牌缓存在当前 `WeChatXpayCurrency` 实例中，并在微信返回的有效期提前 30 秒时视为需要重新获取。非空 `accessToken` 会直接使用，不会由实例替换或缓存。

### 沙箱映射

| 配置        | 生产环境 | 沙箱环境        |
| ----------- | -------- | --------------- |
| `isSandbox` | `false`  | `true`          |
| 请求 `env`  | `0`      | `1`             |
| 支付密钥    | `appKey` | `appSandboxKey` |

该映射由 `envOf(isSandbox)` 完成，并用于余额、扣币、赠币、退款请求以及充值签名载荷。

## `queryBalance` / `getBalance`

```ts
queryBalance(): Promise<Result<BalanceResult>>
getBalance(): Promise<Result<BalanceResult>>
```

两者是等价的余额查询方法，调用微信 `POST /xpay/query_user_balance`，成功结果为：

```ts
interface BalanceResult {
  balance: number
}
```

请求会携带 `env`、`openid`、`user_ip`，并使用访问令牌、支付签名和会话签名。响应缺少 `errcode` 或 `errcode === 0` 后，仍必须包含数字类型的 `balance`；否则返回 `protocol` 错误。

## `charge`

```ts
charge(input: OrderInput): Promise<Result<OrderResult>>
charge(amount: number, orderId?: string): Promise<Result<OrderResult>>
```

调用微信 `POST /xpay/currency_pay` 扣除用户代币。

```ts
interface OrderInput {
  amount: number
  orderId?: string
}

interface OrderResult {
  orderId: string
  balance: number
}
```

`amount` 必须是正的安全整数。`orderId` 可省略，省略时由 `createOrderId('CHG')` 自动生成；显式传入时必须是 8–32 位大写字母或数字。

成功判定支持 `errcode` 缺少或为 `0`。接口响应中的数字类型 `balance` 会直接作为结果返回，**不会再次调用余额查询接口，整个操作只发送一次请求**。缺少有效 `balance` 时返回 `protocol` 错误。

## `present`

```ts
present(input: OrderInput): Promise<Result<OrderResult>>
present(amount: number, orderId?: string): Promise<Result<OrderResult>>
```

调用微信 `POST /xpay/present_currency` 赠送代币，参数和返回值与 `charge` 相同。

微信错误码 `268490004` 表示该赠币操作已经处理，本包将它作为幂等成功处理。响应中的数字类型 `balance` 会直接返回，**不会再次查询余额，整个操作只发送一次请求**。其他非零 `errcode` 会优先作为失败返回；即使 `errcode` 缺少或为 `0`，也仍会校验 `balance`。

## `refund`

```ts
refund(input: RefundInput): Promise<Result<RefundResult>>
refund(amount: number, orderId: string, refundOrderId?: string): Promise<Result<RefundResult>>
```

调用微信 `POST /xpay/cancel_currency_pay` 退还之前扣除的代币。

```ts
interface RefundInput {
  amount: number
  orderId: string
  refundOrderId?: string
}

interface RefundResult {
  refundOrderId: string
  orderId: string
  balance: number
}
```

其中 `orderId` 是原扣币订单号，必须提供；`refundOrderId` 是退款订单号，可省略，省略时由 `createOrderId('RFD')` 自动生成。两个订单号都必须是 8–32 位大写字母或数字。

退款接口的 `errcode` 缺少或为 `0` 时视为成功；`268490004`、`268490005` 和 `268490014` 也按微信协议作为幂等成功处理。退款接口成功后，本包会**额外请求一次** `/xpay/query_user_balance` 获取最新余额，因此一次 `refund` 成功流程包含退款请求和余额查询请求。

## `recharge` / `createRechargeSignature`

```ts
recharge(credits: number, orderId?: string): Promise<Result<RechargeSignResult>>
recharge(input: RechargeInput): Promise<Result<RechargeSignResult>>
createRechargeSignature(
  credits: number,
  orderId?: string,
): Promise<Result<RechargeSignResult>>
```

这两个方法只生成小程序充值所需的签名载荷，不向微信发起网络请求。`createRechargeSignature` 是位置参数形式的便捷方法，内部调用 `recharge`。

```ts
interface RechargeInput {
  credits: number
  orderId?: string
}

interface RechargeSignResult {
  orderId: string
  signData: string
  paySig: string
  signature: string
}
```

`credits` 必须是正的安全整数。`orderId` 可省略，省略时由 `createOrderId('RCG')` 自动生成；显式订单号必须是 8–32 位大写字母或数字。

`signData` 是以下字段按固定顺序序列化的 JSON 字符串：

```json
{
  "attach": "credits:100",
  "buyQuantity": 100,
  "currencyType": "CNY",
  "env": 1,
  "offerId": "offer-test",
  "outTradeNo": "RCGORDER1"
}
```

- `paySig`：使用当前环境支付密钥，对 `requestVirtualPayment&${signData}` 计算 HMAC-SHA256。
- `signature`：使用 `sessionKey`，对 `signData` 计算 HMAC-SHA256。
- `env` 和支付密钥遵循 [沙箱映射](#沙箱映射)。

服务端返回 `RechargeSignResult` 后，小程序端只需把签名结果原样交给微信。`signData` 在运行时必须继续使用服务端返回的原始字符串，不能 `JSON.parse` 后再序列化；`appKey`、`appSandboxKey`、`sessionKey` 和其他密钥仍然不能下发到小程序：

```ts
// payment 是服务端返回的 RechargeSignResult。
// signData 必须是服务端返回的原始 JSON 字符串，不能重新序列化。
declare const payment: {
  signData: string
  paySig: string
  signature: string
}

wx.requestVirtualPayment({
  mode: 'short_series_coin',
  paySig: payment.paySig,
  // 当前部分小程序类型声明可能把 signData 写成对象；按实际声明做类型适配。
  signData: payment.signData as unknown as WechatMiniprogram.SignData,
  signature: payment.signature,
  success() {
    // 支付成功后按业务流程刷新服务端状态或查询余额。
  },
  fail(error) {
    console.error('虚拟支付失败', error)
  },
})
```

## 订单号、幂等与重试

订单号是微信接口的重要幂等标识。虽然 `charge`、`present`、`refund` 和 `recharge` 都支持自动生成订单号，但需要重试同一业务操作时，建议调用方先生成并持久化一个符合规则的订单号，再在每次重试中传入同一个订单号：

```ts
const orderId = 'CHARGEORDER1'
const firstAttempt = await xpay.charge(10, orderId)

// 网络错误或调用方无法确认结果时，使用同一个订单号重试。
const retry = await xpay.charge(10, orderId)
```

不要在一次未知结果的操作上直接生成新的订单号，否则无法利用微信接口的幂等语义。调用方仍应根据自己的业务记录、网络状态和返回的 `ErrorCategory` 决定是否重试。

赠币会把微信错误码 `268490004` 作为幂等成功；退款会把 `268490004`、`268490005`、`268490014` 作为幂等成功。扣币只把缺少 `errcode` 或 `errcode === 0` 作为成功。

## 包根入口公开的工具函数

以下函数由 `src/index.ts` 重新导出，可从包根入口使用：

```ts
import {
  WECHAT_API_ORIGIN,
  apiUrl,
  createOrderId,
  envOf,
  hmacSha256,
  paymentSignature,
  rechargeSignData,
  sessionSignature,
} from '@jiakun-zhao/wechat-xpay-currency'
```

| API                 | 签名                                         | 说明                         |
| ------------------- | -------------------------------------------- | ---------------------------- |
| `WECHAT_API_ORIGIN` | `string`                                     | 默认微信接口地址             |
| `apiUrl`            | `(origin, path, query?) => string`           | 创建带可选查询参数的接口地址 |
| `createOrderId`     | `(prefix?: string) => string`                | 创建 8–32 位范围内的订单号   |
| `envOf`             | `(isSandbox: boolean) => 0 \| 1`             | 将沙箱标志转换为协议环境编号 |
| `hmacSha256`        | `(key: string, value: string) => string`     | 计算十六进制 HMAC-SHA256     |
| `paymentSignature`  | `(appKey, path, body) => string`             | 计算代币支付侧签名           |
| `rechargeSignData`  | `(credits, env, offerId, orderId) => string` | 创建充值签名载荷             |
| `sessionSignature`  | `(sessionKey, body) => string`               | 计算用户会话签名             |

## 常用类型

除上述类型外，包根入口还导出以下类型：

```ts
import type {
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
  RechargeInput,
  RechargeSignResult,
  RefundInput,
  RefundResult,
  Result,
  SessionKeyResult,
  SessionOptions,
  XpayResult,
} from '@jiakun-zhao/wechat-xpay-currency'
```

其中 `AccessTokenCache`、`AccessTokenOnly`、`MutationResult` 和 `XpayResult` 主要用于描述内部流程的结果结构；普通调用通常只需要 `Options`、`Result`、`ErrorCategory` 以及各个业务方法对应的输入和返回类型。

## 本地开发

```bash
pnpm install
pnpm test --run
pnpm exec tsc --noEmit
pnpm exec oxfmt --check README.md src
pnpm exec oxlint src
pnpm build
```

项目使用 `pnpm` 管理依赖，构建产物输出到 `dist/`。本 README 只记录当前源码和包根入口的 API，不包含部署或远端资源操作说明。
