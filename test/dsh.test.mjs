import test from 'node:test'
import assert from 'node:assert/strict'
import { mapTurnEnd, shouldNotify, createDebounce, createNotifier, TURN_END_MAP } from '../lib/dsh.js'

const ev = (type, data) => ({ type, seq: 1, time: Date.now(), data })

test('turn/end: 五种实时原因都认', () => {
  const cases = {
    completed: 'task_done',
    error: 'task_failed',
    blocked: 'task_blocked',
    'max-tokens': 'task_truncated',
    aborted: 'task_aborted',
  }
  for (const [kind, expected] of Object.entries(cases)) {
    const r = mapTurnEnd(ev('turn/end', { turn: 7, reason: { kind } }))
    assert.equal(r.event, expected, kind)
    assert.equal(r.turn, 7)
  }
})

test('interrupted / forked 不推——它们是事后补写的收尾，不是实时事件', () => {
  for (const kind of ['interrupted', 'forked']) {
    assert.equal(mapTurnEnd(ev('turn/end', { turn: 1, reason: { kind } })), null, kind)
  }
})

test('未知的 kind 不猜，直接丢', () => {
  assert.equal(mapTurnEnd(ev('turn/end', { turn: 1, reason: { kind: 'whatever' } })), null)
  assert.equal(mapTurnEnd(ev('turn/end', {})), null)
})

test('非 turn/end 的事件不映射', () => {
  assert.equal(mapTurnEnd(ev('tool/result', {})), null)
  assert.equal(mapTurnEnd(null), null)
})

test('失败带上错误摘要，但截断到 80 字', () => {
  const long = 'x'.repeat(300)
  const r = mapTurnEnd(ev('turn/end', { turn: 2, reason: { kind: 'error', error: { message: long } } }))
  assert.equal(r.event, 'task_failed')
  assert.equal(r.detail.length, 80)
})

test('aborted 默认不叫醒人，显式打开才叫', () => {
  assert.equal(shouldNotify('task_aborted', {}), false)
  assert.equal(shouldNotify('task_aborted', { notifyOnAbort: true }), true)
  assert.equal(shouldNotify('task_done', {}), true)
})

test('去抖：同 key 窗口内只过一条，窗口外放行', () => {
  const accept = createDebounce(3000)
  assert.equal(accept('a', 1000), true)
  assert.equal(accept('a', 2000), false)
  assert.equal(accept('a', 5000), true)
  assert.equal(accept('b', 5000), true, '不同 key 互不影响')
})

test('同一会话同一事件类型连发，只推第一条', () => {
  const sent = []
  const n = createNotifier({ send: (e) => sent.push(e), minIntervalMs: 3000 })
  const s = { id: 'sess-1' }
  n.onSessionEvent(s, ev('turn/end', { turn: 1, reason: { kind: 'completed' } }))
  n.onSessionEvent(s, ev('turn/end', { turn: 2, reason: { kind: 'completed' } }))
  assert.deepEqual(sent, ['task_done'], '3 秒内连推两条"完成"会连着震两次，去抖掉第二条')
})

test('不同事件类型都推——失败和完成是两条不同的消息，不能互相覆盖', () => {
  const sent = []
  const n = createNotifier({ send: (e) => sent.push(e), minIntervalMs: 3000 })
  const s = { id: 'sess-1' }
  n.onSessionEvent(s, ev('turn/end', { turn: 1, reason: { kind: 'error', error: { message: '429' } } }))
  n.onSessionEvent(s, ev('turn/end', { turn: 1, reason: { kind: 'completed' } }))
  assert.deepEqual(sent, ['task_failed', 'task_done'])
})

test('发送抛异常不会把 DSH 带崩', () => {
  const n = createNotifier({
    send: () => {
      throw new Error('boom')
    },
  })
  assert.doesNotThrow(() => n.onSessionEvent({ id: 's' }, ev('turn/end', { turn: 1, reason: { kind: 'completed' } })))
})

test('send 返回 rejected promise 也被吞掉', async () => {
  const logs = []
  const n = createNotifier({ send: () => Promise.reject(new Error('net')), logger: (m) => logs.push(m) })
  n.onSessionEvent({ id: 's' }, ev('turn/end', { turn: 1, reason: { kind: 'completed' } }))
  await new Promise((r) => setTimeout(r, 10))
  assert.ok(logs.some((m) => m.includes('推送失败')))
})

test('批准请求：带工具名，能关掉', () => {
  const sent = []
  const n = createNotifier({ send: (e, m) => sent.push([e, m.title]) })
  n.onApproval({ toolName: 'bash', callId: 'c1' })
  assert.deepEqual(sent[0], ['waiting_approval', '要你批准：bash'])
  const quiet = createNotifier({ send: (e) => sent.push(e), cfg: { notifyOnApproval: false } })
  quiet.onApproval({ toolName: 'bash' })
  assert.equal(sent.length, 1, '关掉后不再推')
})

test('提问：不阻塞，只观察', () => {
  const sent = []
  const n = createNotifier({ send: (e, m) => sent.push([e, m.title]) })
  const ret = n.onQuestion({ questions: [{ question: '选哪个？' }], wait: { callId: 'c9' } })
  assert.equal(ret, undefined, '返回值必须为空，调用方自己 return next()')
  assert.deepEqual(sent[0], ['waiting_input', 'DSH 在等你回答'])
})

test('映射表里没有 null 之外的意外值', () => {
  for (const [k, v] of Object.entries(TURN_END_MAP)) {
    assert.ok(v === null || /^task_/.test(v), `${k} -> ${v}`)
  }
})
