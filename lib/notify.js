/**
 * dsh-phone-notify — 推送核心。
 *
 * 这一层不认识 DSH，也不认识任何具体的接收端：给它一个事件，它按配置推出去。
 * 单独拿出来是为了能被测试，也为了别人可以把这个文件抄进自己的插件里。
 *
 * 设计上的几条硬约束（改之前先读 docs/SAFETY.md）：
 *   1. 默认只推「发生了什么」，不推「说了什么」——标题截断、正文一个字节都不带。
 *   2. 会话 ID 只留尾 6 位，别人捡到日志也拼不出完整会话。
 *   3. 密钥只在签名时用，绝不进日志、不进错误信息。
 *   4. 目标地址只接受 http/https，其余一律拒。
 */
import { createHmac, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'

// 版本号只写在一处：package.json。UA 里写死 0.1 的结果是
// 抓日志时看不出对面跑的是哪一版，排查全靠猜。
const VERSION = (() => {
  try {
    return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
  } catch {
    return '0.0.0'
  }
})()

export const DEFAULTS = {
  timeoutMs: 8000,
  retries: 2,
  retryBaseMs: 400,
  maxPerMinute: 10,
  includeTitle: true,
  includeSessionTail: true,
  quietHours: null,          // 例："23:00-08:00"
  quietAllow: ['task_failed'],
  titleMaxChars: 60,
  includeDetail: false,      // 默认不推细节：错误信息里可能有路径和提示词
  detailMaxChars: 200,
}

const seen = new Map()       // 幂等：key -> 时间戳
const DEDUPE_TTL_MS = 60_000
const sentAt = []            // 滑动窗口限流

function nowMs(now) {
  return now ? new Date(now).getTime() : Date.now()
}

export function maskSession(id, tail = 6) {
  if (!id) return null
  const s = String(id)
  return s.length <= tail ? s : '…' + s.slice(-tail)
}

export function cleanTitle(title, max = DEFAULTS.titleMaxChars) {
  if (!title) return null
  const flat = String(title).replace(/\s+/g, ' ').trim()
  if (!flat) return null
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat
}

/** 组装要发出去的 JSON。故意很小——推的是状态，不是内容。 */
export function buildPayload(event, meta = {}, cfg = {}) {
  const c = { ...DEFAULTS, ...cfg }
  // event_type 是给接收端路由用的（Hermes 从 payload.event_type 取事件名，
  // 否则一律记成 unknown 被忽略）；event 留给人看。
  const body = { event, event_type: event, at: new Date(nowMs(meta.now)).toISOString() }
  if (c.includeTitle) {
    const t = cleanTitle(meta.title, c.titleMaxChars)
    if (t) body.title = t
  }
  if (c.includeSessionTail && meta.sessionId) {
    body.session = maskSession(meta.sessionId)
  }
  if (meta.turnId) body.turn = String(meta.turnId).slice(-8)
  // plugin_error 例外：装载失败时用户手里没有日志可翻，这条 detail 就是唯一线索
  if (meta.detail && (c.includeDetail || event === 'plugin_error')) {
    const d = String(meta.detail).replace(/\s+/g, ' ').trim()
    if (d) body.detail = d.length > c.detailMaxChars ? d.slice(0, c.detailMaxChars - 1) + '…' : d
  }
  return body
}

/** HMAC-SHA256 over "<ts>.<body>"，跟 Hermes webhook 的验签口径一致。 */
export function sign(secret, ts, bodyStr) {
  return createHmac('sha256', secret).update(`${ts}.${bodyStr}`).digest('hex')
}

export function inQuietHours(hhmm, cfg = {}, now) {
  const range = hhmm ?? cfg.quietHours ?? DEFAULTS.quietHours
  if (!range) return false
  const m = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/.exec(range.trim())
  if (!m) return false
  const d = new Date(nowMs(now))
  const cur = d.getHours() * 60 + d.getMinutes()
  const from = Number(m[1]) * 60 + Number(m[2])
  const to = Number(m[3]) * 60 + Number(m[4])
  return from <= to ? cur >= from && cur < to : cur >= from || cur < to
}

function throttled(cfg, now) {
  const cap = cfg.maxPerMinute ?? DEFAULTS.maxPerMinute
  const t = nowMs(now)
  while (sentAt.length && t - sentAt[0] > 60_000) sentAt.shift()
  if (sentAt.length >= cap) return true
  sentAt.push(t)
  return false
}

/**
 * 测试用：清掉幂等记录和限流窗口。
 * 模块级状态活在进程里，一个测试文件跑十几个用例很容易撞上限流，
 * 撞了之后表现是"该推的没推"，跟业务 bug 长得一模一样，会白查半天。
 */
export function __resetForTests() {
  seen.clear()
  sentAt.length = 0
}

function isDup(key) {
  if (!key) return false
  const t = Date.now()
  for (const [k, ts] of seen) if (t - ts > DEDUPE_TTL_MS) seen.delete(k)
  if (seen.has(key)) return true
  seen.set(key, t)
  return false
}

/**
 * 推一条事件。
 * @returns {Promise<{ok:boolean, skipped?:string, status?:number, attempts:number}>}
 */
export async function push(cfg, event, meta = {}, opts = {}) {
  const c = { ...DEFAULTS, ...cfg }
  const log = opts.logger ?? (() => {})
  const url = c.url
  if (!url) return { ok: false, skipped: 'no-url', attempts: 0 }
  if (!/^https?:\/\//i.test(url)) return { ok: false, skipped: 'bad-url', attempts: 0 }

  if (isDup(meta.key ?? (meta.sessionId && meta.turnId ? `${event}:${meta.sessionId}:${meta.turnId}` : null))) {
    return { ok: false, skipped: 'dup', attempts: 0 }
  }

  const allow = (c.quietAllow ?? DEFAULTS.quietAllow).includes(event)
  if (!allow && inQuietHours(c.quietHours, c, meta.now)) {
    return { ok: false, skipped: 'quiet', attempts: 0 }
  }
  if (throttled(c, meta.now)) return { ok: false, skipped: 'throttled', attempts: 0 }

  const body = buildPayload(event, meta, c)
  const bodyStr = JSON.stringify(body)
  const ts = String(Math.floor(nowMs(meta.now) / 1000))
  const headers = {
    'content-type': 'application/json',
    'user-agent': `dsh-phone-notify/${VERSION}`,
    'x-dsh-event': event,
    'x-dsh-id': randomUUID(),
  }
  // 签名头用 X-Webhook-Signature-V2 + X-Webhook-Timestamp：
  // 这是 Hermes webhook 平台的通用 V2 口径，也是 Standard Webhooks 的近似形状，
  // 比自定义头名更容易被别的接收端认出来（自带时间戳，拒绝重放）。
  if (c.secret) {
    headers['x-webhook-timestamp'] = ts
    headers['x-webhook-signature-v2'] = sign(c.secret, ts, bodyStr)
  }

  const doFetch = opts.fetchImpl ?? globalThis.fetch
  if (typeof doFetch !== 'function') return { ok: false, skipped: 'no-fetch', attempts: 0 }

  let attempt = 0
  const max = Math.max(0, c.retries ?? DEFAULTS.retries)
  while (attempt <= max) {
    attempt++
    try {
      const res = await doFetch(url, {
        method: 'POST',
        headers,
        body: bodyStr,
        signal: AbortSignal.timeout(c.timeoutMs ?? DEFAULTS.timeoutMs),
      })
      if (res.ok) return { ok: true, status: res.status, attempts: attempt }
      // 4xx 是地址或密钥的问题，重试没意义
      if (res.status >= 400 && res.status < 500) {
        log(`推送被拒：HTTP ${res.status}（不重试）`)
        return { ok: false, status: res.status, attempts: attempt }
      }
      log(`推送失败：HTTP ${res.status}，第 ${attempt} 次`)
    } catch (err) {
      // 只打错误类别，不打 url / secret
      log(`推送异常：${err?.name || 'Error'}，第 ${attempt} 次`)
    }
    if (attempt > max) break
    const wait = (c.retryBaseMs ?? DEFAULTS.retryBaseMs) * 2 ** (attempt - 1)
    await new Promise(r => setTimeout(r, wait + Math.random() * 200))
  }
  return { ok: false, attempts: attempt }
}
