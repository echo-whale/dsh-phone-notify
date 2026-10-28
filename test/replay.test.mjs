import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { mapTurnEnd } from '../lib/dsh.js'

/**
 * 用一份真实的 DSH 会话日志回放。
 * 来源：@deepseek-ai/dsh 0.2.1-rc.3 实际跑出来的一条 "1+1等于几" 的会话，
 * 只把 cwd 和用户原文替换掉了，事件类型和字段一字未改。
 *
 * 这个测试存在的意义：只要 DSH 改了事件名或字段层级，它会先红，
 * 而不是等你半夜收不到通知才发现。
 */
const fixture = readFileSync(
  fileURLToPath(new URL('./fixtures/dsh-session-sample.jsonl', import.meta.url)),
  'utf8',
)
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l))

test('真实日志：会话头带 id，插件用它做会话标识', () => {
  const head = fixture[0]
  assert.equal(head.type, 'session')
  assert.match(head.id, /^session-[0-9a-f-]{36}$/)
  assert.equal(head.version, 4)
})

test('真实日志：turn/end 的形状和映射表对得上', () => {
  const ends = fixture.filter((e) => e.type === 'turn/end')
  assert.equal(ends.length, 1, '这份日志只有一轮')
  const e = ends[0]
  assert.equal(typeof e.data.turn, 'number')
  assert.equal(e.data.reason.kind, 'completed')
  assert.equal(mapTurnEnd(e).event, 'task_done', '真跑一轮完成，应当推 task_done')
})

test('真实日志：标题先 fallback 后 provider，取最后一条', () => {
  const titles = fixture.filter((e) => e.type === 'session/title').map((e) => e.data.title)
  assert.ok(titles.length >= 2, '实际是 fallback 和 LLM 各发一条')
  assert.equal(titles.at(-1), '计算 1+1 等于几', '最终标题以 LLM 那条为准，插件缓存后写的覆盖先写的')
})

test('真实日志：除 turn/end 之外的事件都不该触发推送', () => {
  const pushed = fixture.map((e) => mapTurnEnd(e)).filter(Boolean)
  assert.equal(pushed.length, 1, '24 个事件里只有 1 个该推')
  assert.equal(pushed[0].event, 'task_done')
})

test('真实日志：一轮的开始和结束配对得上', () => {
  const starts = fixture.filter((e) => e.type === 'turn/start').map((e) => e.data.turn)
  const ends = fixture.filter((e) => e.type === 'turn/end').map((e) => e.data.turn)
  assert.deepEqual(starts, ends)
  const steps = fixture.filter((e) => e.type === 'step/start').length
  assert.equal(steps, fixture.filter((e) => e.type === 'step/end').length)
})
