#!/usr/bin/env node
/**
 * 交互式生成 ~/.dsh-phone-notify.json。
 * 不引入任何依赖，只用 node:readline。
 */
import { createInterface } from 'node:readline/promises'
import { writeFileSync, chmodSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { detectFromHermes } from '../lib/config.js'

const rl = createInterface({ input: process.stdin, output: process.stdout })
const detected = detectFromHermes()

console.log('dsh-phone-notify 配置向导')
console.log('（直接回车 = 用方括号里的值）\n')

const url = (await rl.question(`推送地址 url${detected.url ? ` [${detected.url}]` : ''}: `)).trim() || detected.url || ''
const secret = (await rl.question('签名密钥 secret（留空则不签名）: ')).trim()
const quiet = (await rl.question('免打扰时段，例 23:00-08:00（留空 = 不限）: ')).trim()
const title = (await rl.question('通知里带会话标题？y/N: ')).trim().toLowerCase()

const cfg = {
  url,
  secret,
  quietHours: quiet || null,
  includeTitle: title === 'y' || title === 'yes',
  retries: 2,
  timeoutMs: 8000,
  maxPerMinute: 10,
}
rl.close()

if (!url) {
  console.error('\n没有地址就没法推。先把接收端跑起来再回来。')
  process.exit(1)
}

const p = join(homedir(), '.dsh-phone-notify.json')
writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 })
try { chmodSync(p, 0o600) } catch {}
console.log(`\n已写入 ${p}（权限 600，只有你自己能读）`)
console.log('测试一下：node bin/test-push.mjs')
