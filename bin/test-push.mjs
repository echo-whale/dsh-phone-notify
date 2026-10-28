#!/usr/bin/env node
/** 发一条假事件，验证接收端通不通。不接触 DSH，也不读你的任何会话。 */
import { resolveConfig } from '../lib/config.js'
import { push } from '../lib/notify.js'

const { cfg, warnings, source } = resolveConfig()
for (const w of warnings) console.warn('⚠ ' + w)
console.log(`配置来源：${source}｜地址：${cfg.url ? cfg.url.replace(/\/[^/]*$/, '/…') : '(未配置)'}`)

const r = await push(cfg, 'task_done', {
  title: '这是一条测试通知',
  sessionId: '20261028_selfcheck',
  turnId: 't0',
  key: 'selftest-' + Date.now(),
}, { logger: m => console.log('· ' + m) })

console.log(r.ok ? `✓ 送达（HTTP ${r.status}，第 ${r.attempts} 次）` : `✗ 失败：${r.skipped || 'HTTP ' + r.status}`)
process.exit(r.ok ? 0 : 1)
