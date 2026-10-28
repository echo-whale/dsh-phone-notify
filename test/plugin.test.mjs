import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { __resetForTests } from '../lib/notify.js'

// 每个用例都从干净状态开始：不清的话上一个用例的限流窗口会把这一条吃掉
beforeEach(() => __resetForTests())

/**
 * 这个文件验的是「真把插件挂上去会不会炸」：
 * 用一个假 ctx 模拟 Cordis（.on 收监听器、.logger 收日志），
 * 用假 fetch 代替网络，然后按 DSH 真实的调用形状发事件。
 * 不验的业务逻辑在 dsh.test.mjs 里。
 */

function fakeCtx() {
  const handlers = new Map()
  const logs = []
  return {
    handlers,
    logs,
    on(name, fn) {
      handlers.set(name, fn)
      return () => handlers.delete(name)
    },
    logger(level, msg) {
      logs.push(`${level}:${msg}`)
    },
  }
}

test('挂载：三个钩子都注册上了', async () => {
  const { apply } = await import('../index.js')
  const ctx = fakeCtx()
  apply(ctx, { url: 'https://example.test/hook' })
  for (const h of ['session/event', 'approval/request', 'user-questions/request']) {
    assert.equal(typeof ctx.handlers.get(h), 'function', h)
  }
})

test('没有 url 就不挂钩子，并说清楚原因', async () => {
  // 换一个空的 HOME：这台机器上真有 ~/.hermes/state/dsh-notify.json，
  // 不隔离的话自动识别会顶上，测不到"什么都没有"的分支。
  const os = await import('node:os')
  const fs = await import('node:fs')
  const tmp = fs.mkdtempSync('/tmp/nohome-')
  const saved = { HOME: process.env.HOME, DSH_PHONE_WEBHOOK_URL: process.env.DSH_PHONE_WEBHOOK_URL }
  process.env.HOME = tmp
  delete process.env.DSH_PHONE_WEBHOOK_URL
  try {
    const { apply } = await import('../index.js')
    const ctx = fakeCtx()
    apply(ctx, {})
    assert.equal(ctx.handlers.size, 0, '不该假装在工作')
    assert.ok(ctx.logs.some((l) => l.includes('没有推送地址')), ctx.logs.join(' | '))
  } finally {
    process.env.HOME = saved.HOME
    if (saved.DSH_PHONE_WEBHOOK_URL !== undefined) process.env.DSH_PHONE_WEBHOOK_URL = saved.DSH_PHONE_WEBHOOK_URL
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('本机装过 Hermes 时自动认出地址（不用手填）', async () => {
  const fs = await import('node:fs')
  const tmp = fs.mkdtempSync('/tmp/auto-')
  fs.mkdirSync(`${tmp}/.hermes/state`, { recursive: true })
  fs.writeFileSync(`${tmp}/.hermes/state/dsh-notify.json`, JSON.stringify({ public_url: 'https://auto.test/hook' }))
  const saved = { HOME: process.env.HOME, DSH_PHONE_WEBHOOK_URL: process.env.DSH_PHONE_WEBHOOK_URL }
  process.env.HOME = tmp
  delete process.env.DSH_PHONE_WEBHOOK_URL
  const calls = []
  globalThis.fetch = async (url) => {
    calls.push(url)
    return { ok: true, status: 200 }
  }
  try {
    const { apply } = await import('../index.js')
    const ctx = fakeCtx()
    apply(ctx, { minIntervalMs: 0 })
    assert.equal(ctx.handlers.size, 3, '认出地址后应当正常挂上')
    assert.ok(ctx.logs.some((l) => l.includes('auto.test')), '日志只露域名，不露完整地址')
    ctx.handlers.get('session/event')({ id: 'auto-1' }, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
    await new Promise((r) => setTimeout(r, 30))
    assert.ok(calls.length >= 2, '挂载自报 + 任务完成')
    assert.ok(calls.every((u) => u === 'https://auto.test/hook'))
  } finally {
    process.env.HOME = saved.HOME
    if (saved.DSH_PHONE_WEBHOOK_URL !== undefined) process.env.DSH_PHONE_WEBHOOK_URL = saved.DSH_PHONE_WEBHOOK_URL
    fs.rmSync(tmp, { recursive: true, force: true })
  }
})

test('一轮结束 -> 真发出去一条 POST，body 带 event_type', async () => {
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init })
    return { ok: true, status: 200 }
  }
  const { apply } = await import('../index.js')
  const ctx = fakeCtx()
  apply(ctx, { url: 'https://example.test/hook', secret: 's3cret', minIntervalMs: 0 })

  // 先给会话一个标题（DSH 的 session/title 事件）
  ctx.handlers.get('session/event')({ id: 'sess-xyz-123456' }, { type: 'session/title', data: { title: '修那个接口' } })
  // 再结束这一轮
  ctx.handlers.get('session/event')({ id: 'sess-xyz-123456' }, { type: 'turn/end', data: { turn: 3, reason: { kind: 'completed' } } })

  await new Promise((r) => setTimeout(r, 30))
  const posts = calls.filter((c) => JSON.parse(c.init.body).event !== 'plugin_mounted')
  assert.equal(posts.length, 1, '应当只推一条任务事件（挂载自报不算）')
  const body = JSON.parse(posts[0].init.body)
  assert.equal(body.event, 'task_done')
  assert.equal(body.event_type, 'task_done')
  assert.equal(body.title, '修那个接口')
  assert.equal(body.session, '…123456')
  assert.equal(posts[0].init.headers['x-webhook-signature-v2'].length, 64)
})

test('批准请求：观察完必须把 next 调下去，否则 DSH 卡住', async () => {
  globalThis.fetch = async () => ({ ok: true, status: 200 })
  const { apply } = await import('../index.js')
  const ctx = fakeCtx()
  apply(ctx, { url: 'https://example.test/hook', minIntervalMs: 0 })

  let nextCalled = 0
  const ret = ctx.handlers.get('approval/request')({ toolName: 'bash', callId: 'c1' }, () => {
    nextCalled++
    return Promise.resolve({ outcome: 'ask' })
  })
  assert.equal(nextCalled, 1, 'next 必须被调用')
  assert.ok(ret instanceof Promise, '返回值必须是 next() 的 promise，让 DSH 继续等答案')
  await ret
})

test('提问请求同样不拦截', async () => {
  globalThis.fetch = async () => ({ ok: true, status: 200 })
  const { apply } = await import('../index.js')
  const ctx = fakeCtx()
  apply(ctx, { url: 'https://example.test/hook', minIntervalMs: 0 })

  let nextCalled = 0
  await ctx.handlers.get('user-questions/request')({ questions: [{ question: '先跑哪个？' }] }, () => {
    nextCalled++
    return Promise.resolve({ answers: [] })
  })
  assert.equal(nextCalled, 1)
})

test('挂载成功会自报一声 plugin_mounted（装没装上靠这个判）', async () => {
  globalThis.fetch = async () => ({ ok: true, status: 200 })
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push(JSON.parse(init.body))
    return { ok: true, status: 200 }
  }
  const { apply } = await import('../index.js')
  apply(fakeCtx(), { url: 'https://example.test/hook', minIntervalMs: 0 })
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(calls.length, 1)
  assert.equal(calls[0].event, 'plugin_mounted')
  assert.equal(calls[0].event_type, 'plugin_mounted')
  assert.match(calls[0].title, /^dsh-phone-notify v\d/)
  assert.equal(calls[0].label, '🔌 已挂载', 'label 是给人看的那句话')
})

test('挂载阶段炸了，用同一条链路把死因推出来', async () => {
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push(JSON.parse(init.body))
    return { ok: true, status: 200 }
  }
  const { apply } = await import('../index.js')
  const ctx = fakeCtx()
  ctx.on = () => {
    throw new Error('cordis context is disposed')
  }
  assert.throws(() => apply(ctx, { url: 'https://example.test/hook', minIntervalMs: 0 }))
  await new Promise((r) => setTimeout(r, 30))
  const err = calls.find((c) => c.event === 'plugin_error')
  assert.ok(err, '应当推一条 plugin_error')
  assert.match(err.detail, /disposed/)
})

test('推送失败不会把事件处理打断（返回 undefined 不抛）', async () => {
  globalThis.fetch = async () => {
    throw new Error('ECONNREFUSED')
  }
  const { apply } = await import('../index.js')
  const ctx = fakeCtx()
  apply(ctx, { url: 'https://example.test/hook', minIntervalMs: 0 })
  assert.doesNotThrow(() =>
    ctx.handlers.get('session/event')({ id: 's2' }, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }),
  )
  await new Promise((r) => setTimeout(r, 1200))
})
