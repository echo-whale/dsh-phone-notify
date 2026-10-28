/**
 * dsh-phone-notify — DSH 适配层。
 *
 * 这一层只做一件事：把 Cordis 事件翻译成推送事件名。不认识 HTTP，也不读配置。
 *
 * 字段名全部来自 `@deepseek-ai/dsh-session@0.2.1-rc.3` 的类型定义
 * （SessionEventMap），不是猜的：
 *
 *   'session/event'(session, { type, seq, time, data })
 *   'turn/end' -> data: { turn, reason: { kind, ... } }
 *   reason.kind ∈ completed | aborted | blocked | error | max-tokens | interrupted | forked
 *
 * 其中 interrupted / forked 是「事后补写」的收尾标记（崩溃恢复、fork 边界），
 * 不是实时事件，推给手机会是假警报，所以映射成 null 直接丢掉。
 */

export const TURN_END_MAP = {
  completed: 'task_done',
  error: 'task_failed',
  blocked: 'task_blocked',
  'max-tokens': 'task_truncated',
  aborted: 'task_aborted',
  interrupted: null,
  forked: null,
}

/**
 * 把一条 session 事件映射成推送事件。
 * @returns {{event:string, turn?:number, detail?:string}|null}
 */
export function mapTurnEnd(event) {
  if (!event || event.type !== 'turn/end') return null
  const data = event.data ?? {}
  const reason = data.reason ?? {}
  const kind = reason.kind
  if (!Object.prototype.hasOwnProperty.call(TURN_END_MAP, kind)) return null
  const name = TURN_END_MAP[kind]
  if (!name) return null
  const out = { event: name }
  if (typeof data.turn === 'number') out.turn = data.turn
  const msg = reason.error?.message ?? reason.reason
  if (typeof msg === 'string' && msg.trim()) out.detail = msg.trim().slice(0, 80)
  return out
}

/** 事件名 -> 是否值得叫醒人。失败永远叫，取消默认不叫。 */
export function shouldNotify(event, cfg = {}) {
  if (event === 'task_aborted') return cfg.notifyOnAbort === true
  return true
}

/**
 * 去抖：同一个会话的同一个事件，minIntervalMs 内只推一条。
 * 存在的理由：DSH 一轮结束可能先 error 再 completed（重试后成功），
 * 每条都推的话手机会连着震两次。
 */
export function createDebounce(minIntervalMs = 3000) {
  const last = new Map()
  return function accept(key, now = Date.now()) {
    if (!key) return true
    const prev = last.get(key)
    if (prev !== undefined && now - prev < minIntervalMs) return false
    last.set(key, now)
    if (last.size > 500) {
      for (const [k, t] of last) if (now - t > minIntervalMs * 10) last.delete(k)
    }
    return true
  }
}

/**
 * 把监听器的三个入口包成可直接挂到 ctx.on 上的函数。
 * 所有异常都在这里吃掉：通知失败绝不能让 DSH 的一轮对话失败。
 */
export function createNotifier({ send, getTitle, logger = () => {}, minIntervalMs = 3000, cfg = {} }) {
  const accept = createDebounce(minIntervalMs)
  // 传整个 session：标题服务需要 session 对象去读日志，
  // 只给 id 的话，插件挂载前就存在的旧会话永远拿不到标题。
  const titleOf = (session) => {
    try {
      return getTitle ? getTitle(session?.id, session) : undefined
    } catch {
      return undefined
    }
  }
  const fire = (event, meta) => {
    try {
      const r = send(event, meta)
      if (r && typeof r.catch === 'function') r.catch((e) => logger(`推送失败：${e?.name || 'Error'}`))
    } catch (e) {
      logger(`推送异常：${e?.name || 'Error'}`)
    }
  }

  return {
    /** ctx.on('session/event', (session, event) => ...) */
    onSessionEvent(session, event) {
      const mapped = mapTurnEnd(event)
      if (!mapped || !shouldNotify(mapped.event, cfg)) return
      const id = session?.id ?? ''
      if (!accept(`${id}:${mapped.event}`)) return
      fire(mapped.event, {
        sessionId: id,
        turnId: mapped.turn,
        title: titleOf(session),
        detail: mapped.detail,
        key: `${mapped.event}:${id}:${mapped.turn ?? ''}`,
      })
    },

    /** ctx.on('approval/request', (req, next) => ...) —— 只观察，不拦截 */
    onApproval(req) {
      if (cfg.notifyOnApproval === false) return
      const tool = req?.toolName ?? '未知工具'
      fire('waiting_approval', {
        sessionId: '',
        title: `要你批准：${tool}`,
        detail: req?.reason,
        key: `approval:${req?.callId ?? tool}`,
      })
    },

    /** ctx.on('user-questions/request', (req, next) => ...) —— 只观察，不拦截 */
    onQuestion(req) {
      if (cfg.notifyOnQuestion === false) return
      const qs = Array.isArray(req?.questions) ? req.questions : []
      const first = qs[0]?.question ?? qs[0]?.text ?? ''
      fire('waiting_input', {
        sessionId: '',
        title: 'DSH 在等你回答',
        detail: typeof first === 'string' ? first : undefined,
        key: `question:${req?.wait?.callId ?? qs.length}`,
      })
    },
  }
}
