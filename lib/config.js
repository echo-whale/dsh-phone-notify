/**
 * 配置解析：把所有"跟具体使用者有关"的值都挪到外面。
 *
 * 优先级（高 → 低）：
 *   1. 环境变量  DSH_PHONE_WEBHOOK_URL / DSH_PHONE_SECRET / DSH_PHONE_QUIET / DSH_PHONE_TITLE
 *   2. 配置文件  ~/.dsh-phone-notify.json
 *   3. 本机已有痕迹（自动识别 Hermes 侧的订阅记录）
 *   4. 内置默认值
 *
 * 这样代码包里一个私人的域名、密钥、机器路径都没有。别人 clone 下来不会拿到我们的地址，
 * 我们自己的地址也不会进 git。
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DEFAULTS } from './notify.js'

export const CONFIG_PATHS = [
  join(homedir(), '.dsh-phone-notify.json'),
  join(process.cwd(), 'dsh-phone-notify.json'),
]

function readJson(p) {
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

function envBool(v, fallback) {
  if (v === undefined) return fallback
  return /^(1|true|yes|on)$/i.test(String(v).trim())
}

/** 自动识别：如果这台机器装过 Hermes 且订阅过 dsh-notify，就把地址翻出来当默认值。 */
export function detectFromHermes() {
  const p = join(homedir(), '.hermes', 'state', 'dsh-notify.json')
  if (!existsSync(p)) return {}
  const d = readJson(p)
  if (!d?.public_url) return {}
  return { url: d.public_url, detected: 'hermes' }
}

export function resolveConfig(overrides = {}) {
  let file = {}
  let from = null
  for (const p of CONFIG_PATHS) {
    const d = readJson(p)
    if (d) {
      file = d
      from = p
      break
    }
  }
  const detected = file.url ? {} : detectFromHermes()
  const cfg = {
    ...DEFAULTS,
    ...detected,
    ...file,
    ...overrides,
  }
  if (process.env.DSH_PHONE_WEBHOOK_URL) cfg.url = process.env.DSH_PHONE_WEBHOOK_URL
  if (process.env.DSH_PHONE_SECRET) cfg.secret = process.env.DSH_PHONE_SECRET
  if (process.env.DSH_PHONE_QUIET !== undefined) cfg.quietHours = process.env.DSH_PHONE_QUIET || null
  cfg.includeTitle = envBool(process.env.DSH_PHONE_TITLE, cfg.includeTitle ?? DEFAULTS.includeTitle)

  // 缺哪一项、为什么缺，说清楚——不要静默用默认值把用户蒙在鼓里
  const warnings = []
  if (!cfg.url) warnings.push('没有配置推送地址（url），插件会静默不工作')
  if (!cfg.secret) warnings.push('没有配置签名密钥（secret），接收端如果要求验签会拒收')
  if (cfg.url && !/^https:\/\//i.test(cfg.url) && !/^http:\/\/(127\.0\.0\.1|localhost)/i.test(cfg.url)) {
    warnings.push('推送地址是明文 http 且不是本机，密钥会以明文过网')
  }
  return { cfg, warnings, source: from ?? (detected.detected ? 'auto-detect' : 'defaults') }
}

/** 给 README / init 用：哪些字段必须由使用者自己填。 */
export const REQUIRED_FIELDS = [
  { key: 'url', env: 'DSH_PHONE_WEBHOOK_URL', why: '你的接收端地址（Hermes / n8n / Bark / 企业微信机器人 都行）' },
  { key: 'secret', env: 'DSH_PHONE_SECRET', why: '接收端验签用的密钥，留空则不带签名' },
]
