/* oxlint-disable eslint/one-var, eslint/no-undefined, eslint/curly, unicorn/numeric-separators-style, typescript/array-type, unicorn/prefer-response-static-json, typescript/explicit-function-return-type, typescript/no-base-to-string, vitest/max-expects, vitest/require-top-level-describe, vitest/no-hooks, vitest/prefer-to-be-falsy, vitest/no-conditional-expect, vitest/prefer-to-be-truthy, vitest/prefer-strict-boolean-matchers */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  WeChatXpayCurrency,
  getAccessToken,
  getSessionKey,
  paymentSignature,
  sessionSignature,
} from './index'

interface RecordedRequest {
  body?: string
  init?: RequestInit
  url: URL
}

const originalFetch = globalThis.fetch
let requests: RecordedRequest[]
let responses: Array<{ body: unknown; status?: number }>

/** 为 fetch 模拟创建响应体。 */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** 创建协议测试使用的客户端配置。 */
function options(overrides: Partial<ConstructorParameters<typeof WeChatXpayCurrency>[0]> = {}) {
  return {
    openid: 'openid-test',
    sessionKey: 'session-key',
    accessToken: 'access-token',
    appId: 'appid-test',
    appSecret: 'secret-test',
    offerId: 'offer-test',
    isSandbox: false,
    appKey: 'production-key',
    appSandboxKey: 'sandbox-key',
    ...overrides,
  }
}

/** 读取并移除 fetch 模拟中配置的下一条响应。 */
function nextResponse(): Response {
  const next = responses.shift() ?? { body: {} }
  return jsonResponse(next.body, next.status)
}

beforeEach(() => {
  requests = []
  responses = []
  globalThis.fetch = async (input, init) => {
    requests.push({
      body: typeof init?.body === 'string' ? init.body : undefined,
      init,
      url: new URL(input.toString()),
    })
    return nextResponse()
  }
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('独立微信接口', () => {
  it('获取 stable_token 并保留响应字段', async () => {
    expect.hasAssertions()
    responses.push({ body: { access_token: 'token', expires_in: 7200 } })
    const result = await getAccessToken({ appId: 'app', appSecret: 'secret' })
    expect(result).toStrictEqual({ success: true, accessToken: 'token', expiresIn: 7200 })
    expect(requests[0]?.url.pathname).toBe('/cgi-bin/stable_token')
    expect(JSON.parse(requests[0]?.body ?? '{}')).toStrictEqual({
      appid: 'app',
      force_refresh: false,
      grant_type: 'client_credential',
      secret: 'secret',
    })
  })

  it('获取 jscode2session 并保留微信错误信息', async () => {
    expect.hasAssertions()
    responses.push({ body: { errcode: 40029, errmsg: 'invalid code' } })
    const result = await getSessionKey({ appId: 'app', appSecret: 'secret', code: 'bad' })
    expect(result).toStrictEqual({
      success: false,
      error: {
        category: 'wechat',
        code: 40029,
        message: 'invalid code',
        wechatCode: 40029,
        wechatMessage: 'invalid code',
      },
    })
    expect(requests[0]?.url.searchParams.get('js_code')).toBe('bad')
  })

  it('非 JSON 的 HTTP 错误归类为 http 并保留状态码', async () => {
    expect.hasAssertions()
    globalThis.fetch = async () =>
      new Response('<html>502 Bad Gateway</html>', {
        status: 502,
        headers: { 'content-type': 'text/html' },
      })
    const result = await getAccessToken({ appId: 'app', appSecret: 'secret' })
    expect(result).toMatchObject({ success: false, error: { category: 'http', code: 502 } })
  })

  it('http 状态码优先于微信错误码判断', async () => {
    expect.hasAssertions()
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ errcode: 40013, errmsg: 'invalid appid' }), { status: 400 })
    const result = await getAccessToken({ appId: 'app', appSecret: 'secret' })
    expect(result).toMatchObject({ success: false, error: { category: 'http', code: 400 } })
  })

  it('访问令牌响应缺少必需字段时返回协议错误', async () => {
    expect.hasAssertions()
    responses.push({ body: { expires_in: 7200 } })
    const result = await getAccessToken({ appId: 'app', appSecret: 'secret' })
    expect(result).toMatchObject({ success: false, error: { category: 'protocol', code: -2 } })
  })
})

describe('带签名的虚拟支付操作', () => {
  it('匹配文档中固定的 HMAC-SHA256 测试向量', () => {
    expect.hasAssertions()
    const path = '/xpay/currency_pay'
    const body = '{"env":1,"openid":"oTest","amount":50,"order_id":"TKC1"}'
    expect(paymentSignature('test-app-key', path, body)).toBe(
      '060ea68ff5fa4a1af5d483688f473dcb6f6f02e8af939e8ceb4db6829d2ed352',
    )
    expect(sessionSignature('test-session-key', body)).toBe(
      '51c04421150d21e396c20aea834cc67b23fac16fc34f343352cb0391c96a65b8',
    )
  })

  it('默认生成符合协议要求的订单号', async () => {
    expect.hasAssertions()
    responses.push({ body: { balance: 7 } })
    const result = await new WeChatXpayCurrency(options()).charge(1)
    expect(result.success).toBeTruthy()
    expect(result.success ? result.orderId : undefined).toMatch(/^[A-Z0-9]{8,32}$/)
    expect(requests).toHaveLength(1)
  })

  it('查询余额时使用 env 0 和生产密钥', async () => {
    expect.hasAssertions()
    responses.push({ body: { balance: 42, errcode: 0 } })
    const result = await new WeChatXpayCurrency(options()).queryBalance()
    expect(result).toStrictEqual({ success: true, balance: 42 })
    const request = requests[0]
    expect(request?.url.pathname).toBe('/xpay/query_user_balance')
    expect(request?.url.searchParams.get('access_token')).toBe('access-token')
    expect(request?.url.searchParams.get('pay_sig')).toBe(
      paymentSignature('production-key', '/xpay/query_user_balance', request?.body ?? ''),
    )
    expect(request?.url.searchParams.get('signature')).toBe(
      sessionSignature('session-key', request?.body ?? ''),
    )
    expect(JSON.parse(request?.body ?? '{}')).toStrictEqual({
      env: 0,
      openid: 'openid-test',
      user_ip: '127.0.0.1',
    })
  })

  it('缺少 errcode 时按余额查询成功处理', async () => {
    expect.hasAssertions()
    responses.push({ body: { balance: 12 } })
    const result = await new WeChatXpayCurrency(options()).queryBalance()
    expect(result).toStrictEqual({ success: true, balance: 12 })
  })

  it('余额响应同时包含非零 errcode 时优先保留微信错误', async () => {
    expect.hasAssertions()
    responses.push({ body: { balance: 10, errcode: 268_490_006, errmsg: 'not enough' } })
    const result = await new WeChatXpayCurrency(options()).queryBalance()
    expect(result).toStrictEqual({
      success: false,
      error: {
        category: 'insufficient_balance',
        code: 268_490_006,
        message: 'not enough',
        wechatCode: 268_490_006,
        wechatMessage: 'not enough',
      },
    })
  })

  it('使用 env 1 和沙箱密钥，并返回订单号与余额', async () => {
    expect.hasAssertions()
    responses.push({ body: { errcode: 0, balance: 8 } })
    const result = await new WeChatXpayCurrency(options({ isSandbox: true })).charge(3, 'CHGORDER1')
    expect(result).toStrictEqual({ success: true, orderId: 'CHGORDER1', balance: 8 })
    expect(requests).toHaveLength(1)
    const charge = requests[0]
    expect(charge?.url.searchParams.get('pay_sig')).toBe(
      paymentSignature('sandbox-key', '/xpay/currency_pay', charge?.body ?? ''),
    )
    expect(JSON.parse(charge?.body ?? '{}')).toStrictEqual({
      amount: 3,
      env: 1,
      openid: 'openid-test',
      order_id: 'CHGORDER1',
      user_ip: '127.0.0.1',
    })
  })

  it('将余额查询中的会话过期归类为微信会话错误', async () => {
    expect.hasAssertions()
    responses.push({ body: { errcode: 268_490_009, errmsg: 'session expired' } })
    const result = await new WeChatXpayCurrency(options()).queryBalance()
    expect(result).toStrictEqual({
      success: false,
      error: {
        category: 'session_expired',
        code: 268_490_009,
        message: 'session expired',
        wechatCode: 268_490_009,
        wechatMessage: 'session expired',
      },
    })
  })

  it('退款需要原始订单号，并同时发送两个订单号', async () => {
    expect.hasAssertions()
    const result = await new WeChatXpayCurrency(options()).refund({
      amount: 2,
      orderId: '',
      refundOrderId: 'RFDORDER1',
    })
    expect(result.success).toBe(false)
    expect(requests).toHaveLength(0)
    responses.push({ body: { errcode: 0 } })
    const success = await new WeChatXpayCurrency(options()).refund(2, 'CHGORDER1', 'RFDORDER1')
    expect(success).toStrictEqual({
      success: true,
      refundOrderId: 'RFDORDER1',
      orderId: 'CHGORDER1',
    })
    expect(requests).toHaveLength(1)
    expect(JSON.parse(requests[0]?.body ?? '{}')).toStrictEqual({
      amount: 2,
      env: 0,
      openid: 'openid-test',
      order_id: 'RFDORDER1',
      pay_order_id: 'CHGORDER1',
      user_ip: '127.0.0.1',
    })
  })

  it('接受赠币和退款的幂等返回码', async () => {
    expect.hasAssertions()
    responses.push({ body: { errcode: 268_490_004, balance: 10 } })
    const result = await new WeChatXpayCurrency(options()).present(2, 'PRSORDER1')
    expect(result).toStrictEqual({ success: true, orderId: 'PRSORDER1', balance: 10 })
    expect(requests).toHaveLength(1)
  })

  it('扣币响应缺少余额时返回协议错误', async () => {
    expect.hasAssertions()
    responses.push({ body: { errcode: 0 } })
    const result = await new WeChatXpayCurrency(options()).charge(2, 'CHGORDER1')
    expect(result).toStrictEqual({
      success: false,
      error: {
        category: 'protocol',
        code: -2,
        message: 'WeChat returned an invalid mutation response',
      },
    })
    expect(requests).toHaveLength(1)
  })

  it('赠币响应缺少余额时返回协议错误', async () => {
    expect.hasAssertions()
    responses.push({ body: {} })
    const result = await new WeChatXpayCurrency(options()).present(2, 'PRSORDER1')
    expect(result).toStrictEqual({
      success: false,
      error: {
        category: 'protocol',
        code: -2,
        message: 'WeChat returned an invalid mutation response',
      },
    })
    expect(requests).toHaveLength(1)
  })

  it('订单已退款时按幂等成功处理', async () => {
    expect.hasAssertions()
    responses.push({ body: { errcode: 268_490_005, errmsg: 'already refunded' } })
    const result = await new WeChatXpayCurrency(options()).refund(1, 'CHGORDER1', 'RFDORDER1')
    expect(result).toStrictEqual({
      success: true,
      refundOrderId: 'RFDORDER1',
      orderId: 'CHGORDER1',
    })
    expect(requests).toHaveLength(1)
  })

  it('退款处理中不当作成功，保留微信错误', async () => {
    expect.hasAssertions()
    responses.push({ body: { errcode: 268_490_014, errmsg: 'refund in progress' } })
    const result = await new WeChatXpayCurrency(options()).refund(1, 'CHGORDER1', 'RFDORDER1')
    expect(result).toStrictEqual({
      success: false,
      error: {
        category: 'wechat',
        code: 268_490_014,
        message: 'refund in progress',
        wechatCode: 268_490_014,
        wechatMessage: 'refund in progress',
      },
    })
    expect(requests).toHaveLength(1)
  })

  it('退款不把重复操作码当作成功', async () => {
    expect.hasAssertions()
    responses.push({ body: { errcode: 268_490_004, errmsg: 'duplicate' } })
    const result = await new WeChatXpayCurrency(options()).refund(1, 'CHGORDER1', 'RFDORDER1')
    expect(result).toMatchObject({ success: false, error: { category: 'wechat' } })
  })

  it('扣币将重复操作作为幂等成功', async () => {
    expect.hasAssertions()
    responses.push({ body: { errcode: 268_490_004, balance: 5 } })
    const result = await new WeChatXpayCurrency(options()).charge(1, 'CHGORDER1')
    expect(result).toStrictEqual({ success: true, orderId: 'CHGORDER1', balance: 5 })
    expect(requests).toHaveLength(1)
  })

  it('非法金额和订单号返回校验错误', async () => {
    expect.hasAssertions()
    const client = new WeChatXpayCurrency(options())
    await expect(client.charge(0)).resolves.toMatchObject({
      success: false,
      error: { category: 'validation' },
    })
    await expect(client.charge(-1)).resolves.toMatchObject({
      success: false,
      error: { category: 'validation' },
    })
    await expect(client.charge(1.5)).resolves.toMatchObject({
      success: false,
      error: { category: 'validation' },
    })
    await expect(client.charge({ amount: 1, orderId: 'SHORT' })).resolves.toMatchObject({
      success: false,
      error: { category: 'validation' },
    })
    expect(requests).toHaveLength(0)
  })

  it('保留微信错误码并将余额不足归类为对应错误', async () => {
    expect.hasAssertions()
    responses.push({ body: { errcode: 268_490_006, errmsg: 'not enough' } })
    const result = await new WeChatXpayCurrency(options()).charge(2, 'CHGORDER1')
    expect(result).toStrictEqual({
      success: false,
      error: {
        category: 'insufficient_balance',
        code: 268_490_006,
        message: 'not enough',
        wechatCode: 268_490_006,
        wechatMessage: 'not enough',
      },
    })
  })
})

describe('充值签名与传输失败', () => {
  it('生成准确的小程序充值签名', async () => {
    expect.hasAssertions()
    const result = await new WeChatXpayCurrency(options({ isSandbox: true })).recharge(
      100,
      'RCGORDER1',
    )
    expect(result).toStrictEqual({
      success: true,
      orderId: 'RCGORDER1',
      signData:
        '{"attach":"credits:100","buyQuantity":100,"currencyType":"CNY","env":1,"offerId":"offer-test","outTradeNo":"RCGORDER1"}',
      paySig: paymentSignature(
        'sandbox-key',
        'requestVirtualPayment',
        '{"attach":"credits:100","buyQuantity":100,"currencyType":"CNY","env":1,"offerId":"offer-test","outTradeNo":"RCGORDER1"}',
      ),
      signature: sessionSignature(
        'session-key',
        '{"attach":"credits:100","buyQuantity":100,"currencyType":"CNY","env":1,"offerId":"offer-test","outTradeNo":"RCGORDER1"}',
      ),
    })
    expect(requests).toHaveLength(0)
  })

  it('recharge 支持对象形式并校验订单号', async () => {
    expect.hasAssertions()
    const result = await new WeChatXpayCurrency(options()).recharge({
      credits: 50,
      orderId: 'RCGORDER2',
    })
    expect(result.success).toBe(true)
    expect(result.success ? result.orderId : undefined).toBe('RCGORDER2')
    await expect(new WeChatXpayCurrency(options()).recharge({ credits: 0 })).resolves.toMatchObject(
      { success: false, error: { category: 'validation' } },
    )
    expect(requests).toHaveLength(0)
  })

  it('将网络错误和 JSON 解析错误分类处理', async () => {
    expect.hasAssertions()
    globalThis.fetch = async () => {
      throw new Error('offline')
    }
    const network = await new WeChatXpayCurrency(options()).queryBalance()
    expect(network).toStrictEqual({
      success: false,
      error: { category: 'network', code: -1, message: 'offline' },
    })
    globalThis.fetch = async () => new Response('not-json')
    const json = await new WeChatXpayCurrency(options()).queryBalance()
    expect(json).toMatchObject({ success: false, error: { category: 'json' } })
  })
})

describe('访问令牌自动获取与缓存', () => {
  it('空 accessToken 时自动获取并复用缓存', async () => {
    expect.hasAssertions()
    const client = new WeChatXpayCurrency(options({ accessToken: '' }))
    responses.push(
      { body: { access_token: 'token-1', expires_in: 7200 } },
      { body: { balance: 5 } },
      { body: { balance: 5 } },
    )
    await expect(client.queryBalance()).resolves.toStrictEqual({ success: true, balance: 5 })
    await expect(client.queryBalance()).resolves.toStrictEqual({ success: true, balance: 5 })
    expect(requests.map((request) => request.url.pathname)).toStrictEqual([
      '/cgi-bin/stable_token',
      '/xpay/query_user_balance',
      '/xpay/query_user_balance',
    ])
  })

  it('令牌即将过期时重新获取', async () => {
    expect.hasAssertions()
    vi.useFakeTimers()
    try {
      const client = new WeChatXpayCurrency(options({ accessToken: '' }))
      responses.push(
        { body: { access_token: 'token-1', expires_in: 60 } },
        { body: { balance: 5 } },
        { body: { access_token: 'token-2', expires_in: 60 } },
        { body: { balance: 5 } },
        { body: { balance: 6 } },
      )
      await expect(client.queryBalance()).resolves.toStrictEqual({ success: true, balance: 5 })
      vi.advanceTimersByTime(31_000)
      await expect(client.queryBalance()).resolves.toStrictEqual({ success: true, balance: 5 })
      await expect(client.queryBalance()).resolves.toStrictEqual({ success: true, balance: 6 })
      expect(requests.filter((r) => r.url.pathname === '/cgi-bin/stable_token')).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
    expect(vi.isFakeTimers()).toBe(false)
  })
})

describe('构造函数参数校验', () => {
  it('缺少必填字段时抛错', () => {
    expect.hasAssertions()
    const base = options()
    expect(() => new WeChatXpayCurrency({ ...base, appKey: '' })).toThrow(/appKey/)
    expect(() => new WeChatXpayCurrency({ ...base, openid: '' })).toThrow(/openid/)
    expect(() => new WeChatXpayCurrency({ ...base, isSandbox: 'yes' as never })).toThrow(
      /isSandbox/,
    )
  })

  it('accessToken 允许为空字符串', () => {
    expect.hasAssertions()
    expect(() => new WeChatXpayCurrency(options({ accessToken: '' }))).not.toThrow()
  })
})
