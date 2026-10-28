/**
 * dsh-phone-notify — DSH 插件入口（Cordis）。
 *
 * 挂三个钩子，都在 `@deepseek-ai/dsh-session@0.2.1-rc.3` 里真实存在：
 *
 *   session/event          (session, {type, seq, time, data})   一轮结束时推
 *   approval/request       (req, next)                          要你批准时推（只观察）
 *   user-questions/request (req, next)                          等你回答时推（只观察）
 *
 * 后两个是中间件：拿到 next 必须原样调下去，否则 DSH 会卡住等你——那不是通知，
 * 那是把工具变成枷锁。这一层只负责叫醒手机，决定权还在电脑前。
 */
import { push } from './lib/notify.js'
import { readFileSync } from 'node:fs'
import { resolveConfig } from './lib/config.js'
import { createNotifier } from './lib/dsh.js'

const VERSION = (() => {
  try {
    return JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version
  } catch {
    return '0.0.0'
  }
})()

export const name = 'dsh-phone-notify'

// schemastery 是 DSH 自带的（它自己的插件都用），但不是每个 profile 都把它摆在
// 我们能解析到的位置。拿不到就退化成「不做 schema 校验」，配置照样能跑——
// 不能因为一个锦上添花的依赖让整个插件加载失败。
let Config
try {
  const z = (await import('@deepseek-ai/schemastery')).default
  Config = ConfigSchema(z)
} catch {
  Config = undefined
}
export { Config }

function ConfigSchema(z) {
  return z.object({
    url: z.string().description('接收端 webhook 地址（http/https）'),
    secret: z.string().role('secret').description('HMAC 签名密钥，留空则不带签名'),
    includeTitle: z.boolean().default(true).description('推送里带会话标题'),
    notifyOnAbort: z.boolean().default(false).description('你按了停止也推一条'),
    notifyOnApproval: z.boolean().default(true).description('工具要批准时推'),
    notifyOnQuestion: z.boolean().default(true).description('等你回答时推'),
    quietHours: z.string().default('').description('免打扰时段，形如 23:00-08:00；空为关闭'),
    minIntervalMs: z.number().default(3000).description('同一会话同一事件的去抖窗口（毫秒）'),
  })
}

export function apply(ctx, config = {}) {
  try {
    applyPlugin(ctx, config)
  } catch (e) {
    // 挂载阶段炸了，日志你也看不到（DSH 的日志不在你方便翻的地方）。
    // 那就让它用同一条推送链路把死因说出来——能推出去，说明网络和签名都没问题。
    try {
      const { cfg } = resolveConfig(config)
      if (cfg.url) {
        push(cfg, 'plugin_error', {
          title: `插件挂载失败 v${VERSION}`,
          sessionId: 'mount',
          detail: `${e?.name || 'Error'}: ${String(e?.message || e).slice(0, 300)}`,
        })
      }
    } catch {
      /* 上报本身失败就算了，不能再抛 */
    }
    throw e
  }
}

function applyPlugin(ctx, config = {}) {
  const { cfg, warnings } = resolveConfig(config)
  const logger = (msg) => {
    try {
      ctx.logger?.('warn', `[dsh-phone-notify] ${msg}`)
    } catch {
      /* 日志本身不能成为故障源 */
    }
  }
  for (const w of warnings) logger(w)

  if (!cfg.url) {
    logger('没有推送地址，插件不工作（设置 url 或环境变量 DSH_PHONE_WEBHOOK_URL）')
    return
  }

  const titles = new Map()
  const send = (event, meta) => push(cfg, event, meta, { logger })

  // 自报一声。收到这条 = 插件确实被 DSH 加载了、签名和网络也通，
  // 后面收不到 task_done 就只可能是事件没挂上，排查范围立刻缩小一半。
  send('plugin_mounted', {
    title: `dsh-phone-notify v${VERSION} 已挂载`,
    sessionId: 'mount',
    detail: `node ${process.versions?.node || '?'} · ${process.platform} · 待命`,
  })
  const notify = createNotifier({
    send,
    getTitle: (id) => titles.get(id),
    logger,
    minIntervalMs: cfg.minIntervalMs ?? 3000,
    cfg,
  })

  ctx.on('session/event', (session, event) => {
    try {
      if (event?.type === 'session/title') {
        const t = event.data?.title
        if (typeof t === 'string' && t) titles.set(session?.id, t)
        return
      }
      notify.onSessionEvent(session, event)
    } catch (e) {
      logger(`处理会话事件失败：${e?.name || 'Error'}`)
    }
  })

  ctx.on('approval/request', (req, next) => {
    try {
      notify.onApproval(req)
    } catch (e) {
      logger(`处理批准请求失败：${e?.name || 'Error'}`)
    }
    return next()
  })

  ctx.on('user-questions/request', (req, next) => {
    try {
      notify.onQuestion(req)
    } catch (e) {
      logger(`处理提问失败：${e?.name || 'Error'}`)
    }
    return next()
  })

  logger(`已挂载，推送到 ${cfg.url.replace(/\/[^/]*$/, '/…')}`)
}
