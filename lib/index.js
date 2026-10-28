/**
 * dsh-phone-notify — DSH 宿主半边。
 *
 * 状态：v0.1 先落地「推得出去」这件事，事件挂钩留在 TODO。
 * 原因写在 docs/PUBLISH.md 里：DSH 的事件 API 会变，我按真实会话行字段读，
 * 不想凭猜测写死一个字段名——有个同类插件就是用了不存在的 parentSessionId，
 * 自检一直绿，过滤却从来没生效过。
 *
 * 接线点（真机验证后补）：
 *   一轮结束   -> push(cfg, 'task_done',     { sessionId, title, turnId })
 *   一轮报错   -> push(cfg, 'task_failed',   { sessionId, title, turnId })
 *   等你确认   -> push(cfg, 'waiting_input', { sessionId, title, turnId })
 */
import { resolveConfig } from './config.js'
import { push } from './notify.js'

export const name = 'dsh-phone-notify'

export function apply(ctx, options = {}) {
  const { cfg, warnings } = resolveConfig(options)
  const log = (m) => (ctx?.logger?.info ?? console.log)(`[phone-notify] ${m}`)
  for (const w of warnings) log('⚠ ' + w)
  if (!cfg.url) {
    log('没有推送地址，插件处于静默状态。运行 npx dsh-phone-notify 生成配置。')
    return
  }

  const fire = (event) => (meta = {}) =>
    push(cfg, event, meta, { logger: log }).catch(err => log(`推送异常：${err?.name}`))

  // TODO(v0.1.1): 换成 DSH 真实事件。下面这三个是预留的出口，先不注册。
  const handlers = {
    task_done: fire('task_done'),
    task_failed: fire('task_failed'),
    waiting_input: fire('waiting_input'),
  }

  return { handlers, config: cfg }
}
