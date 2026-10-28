import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { buildPayload, cleanTitle, inQuietHours, maskSession, push, sign } from '../lib/notify.js'

const base = { maxPerMinute: 999, retries: 0, key: undefined }

test('会话 ID 只留尾 6 位', () => {
  assert.equal(maskSession('20261028_144520_c4df9177'), '…df9177')
  assert.equal(maskSession('abc'), 'abc')
  assert.equal(maskSession(null), null)
})

test('标题压平换行并截断', () => {
  assert.equal(cleanTitle('  修 bug\n\n第二轮  '), '修 bug 第二轮')
  const long = cleanTitle('长'.repeat(200), 10)
  assert.equal(long.length, 10)
  assert.ok(long.endsWith('…'))
})

test('payload 只有状态，没有正文', () => {
  const p = buildPayload('task_done', {
    title: '给墙加一个入口',
    sessionId: '20261028_abc123456',
    turnId: 'turn_987654321',
    content: 'SECRET 对话正文不该出现',
  })
  assert.equal(p.event, 'task_done')
  assert.equal(p.event_type, 'task_done', '接收端按 event_type 路由')
  assert.equal(p.title, '给墙加一个入口')
  assert.equal(p.session, '…123456')
  assert.equal(JSON.stringify(p).includes('SECRET'), false)
})

test('closeTitle=false 时标题彻底不出现', () => {
  const p = buildPayload('task_done', { title: '机密项目' }, { includeTitle: false })
  assert.equal('title' in p, false)
})

test('免打扰时段支持跨零点', () => {
  const at = (h, m) => new Date(2026, 9, 28, h, m, 0)
  assert.equal(inQuietHours('23:00-08:00', {}, at(23, 30)), true)
  assert.equal(inQuietHours('23:00-08:00', {}, at(3, 0)), true)
  assert.equal(inQuietHours('23:00-08:00', {}, at(12, 0)), false)
})

test('签名口径 = HMAC(ts.body)', () => {
  const expect = createHmac('sha256', 'k').update('1700000000.{"a":1}').digest('hex')
  assert.equal(sign('k', '1700000000', '{"a":1}'), expect)
})

test('成功推送带上签名头', async () => {
  let seen = null
  const fetchImpl = async (url, init) => {
    seen = init
    return { ok: true, status: 200 }
  }
  const r = await push({ ...base, url: 'https://x.test/h', secret: 's3cret' }, 'task_done',
    { title: 't', sessionId: 'sid-abcdef', turnId: 'turn1' }, { fetchImpl })
  assert.equal(r.ok, true)
  assert.equal(seen.headers['x-dsh-event'], 'task_done')
  assert.match(seen.headers['x-webhook-signature-v2'], /^[0-9a-f]{64}$/)
  assert.ok(seen.headers['x-webhook-timestamp'], 'V2 必须带时间戳，否则降级成可重放的 V1')
  assert.equal(seen.body.includes('s3cret'), false, '密钥不能出现在请求体里')
})

test('5xx 会重试，4xx 不重试', async () => {
  let n = 0
  const flaky = async () => (++n < 2 ? { ok: false, status: 503 } : { ok: true, status: 200 })
  const r1 = await push({ ...base, retries: 2, url: 'https://x.test/h', retryBaseMs: 1 }, 'task_done', { key: 'a1' }, { fetchImpl: flaky })
  assert.equal(r1.ok, true)
  assert.equal(r1.attempts, 2)

  let m = 0
  const rejected = async () => { m++; return { ok: false, status: 401 } }
  const r2 = await push({ ...base, retries: 3, url: 'https://x.test/h' }, 'task_done', { key: 'a2' }, { fetchImpl: rejected })
  assert.equal(r2.ok, false)
  assert.equal(r2.attempts, 1, '4xx 不该重试')
})

test('非 http 地址直接拒', async () => {
  const r = await push({ url: 'file:///etc/passwd' }, 'task_done', {})
  assert.equal(r.skipped, 'bad-url')
})

test('同一轮重复事件只推一次', async () => {
  let hits = 0
  const f = async () => { hits++; return { ok: true, status: 200 } }
  const cfg = { ...base, url: 'https://x.test/h' }
  const meta = { sessionId: 's-dup', turnId: 't-dup' }
  await push(cfg, 'task_done', meta, { fetchImpl: f })
  const second = await push(cfg, 'task_done', meta, { fetchImpl: f })
  assert.equal(second.skipped, 'dup')
  assert.equal(hits, 1)
})

test('免打扰里失败事件仍然放行', async () => {
  let hits = 0
  const f = async () => { hits++; return { ok: true, status: 200 } }
  const cfg = { ...base, url: 'https://x.test/h', quietHours: '00:00-23:59' }
  const r = await push(cfg, 'task_failed', { key: 'q1' }, { fetchImpl: f })
  assert.equal(r.ok, true)
  assert.equal(hits, 1)
})
