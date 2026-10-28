# dsh-phone-notify

> 把 DSH（DeepSeek Harness）的任务状态推到**手机上**，而不是弹在没人看的桌面上。

跑一个四十分钟的任务，人去厨房、去地铁、去开会。任务跑完了、报错了、等你在对话框里确认——
现有的几个 DSH 通知插件都在给"坐在电脑前的人"弹 toast。这个插件假设你不在。

```
DSH 事件  →  HTTP POST（可选 HMAC 签名）  →  任意接收端  →  手机
```

接收端不限定：Hermes 的 webhook 平台、n8n、Bark、企业微信/飞书机器人、自己写的一个 20 行 Flask ——
只要它收 JSON，就能用。

---

## 状态（别被 README 骗了）

| 部分 | 状态 |
|---|---|
| 推送核心 `lib/notify.js` | ✅ 可用 |
| 配置解析 / 自动识别 | ✅ 可用 |
| DSH 事件接线 `index.js` + `lib/dsh.js` | ✅ 字段名对着 `@deepseek-ai/dsh-session@0.2.1-rc.3` 的类型定义写，不是猜的 |
| 32 项测试 | ✅ 全过 |
| 真机联调（装进别人的 DSH 跑一遍） | ⏳ 正在做 |

事件名和字段来自 DSH 自己发布的 npm 包，可以自己核对：

```bash
npm pack @deepseek-ai/dsh-session@0.2.1-rc.3
tar -xzf dsh-session-*.tgz
grep -n "'turn/end'" -A 4 package/lib/types/types.d.ts
```

## 安装

它是一个普通的 Cordis 插件包，装进 DSH 的 profile 就行。

```bash
cd ~/.dsh/profiles/desktop          # Windows: %USERPROFILE%\.dsh\profiles\desktop
pnpm add /path/to/dsh-phone-notify  # 或 npm pack 出来的 tgz，或 GitHub 地址
```

然后在同一个目录的 `cordis.patch.yml` 里加一行（这个文件是 DSH 自己的配置层，它上面所有 bundle 之后应用）：

```yaml
- insert:
    - id: phone-notify
      name: dsh-phone-notify
      config:
        url: https://your-host/webhooks/dsh-notify
        secret: 你的密钥
        includeTitle: true
```

`insert:` 那一层不能省。这个文件里裸写的 `- id: xxx` 是**覆盖已有行**的语义，
不是新增——`@deepseek-ai/dsh-plugin-manager` 会把「有 id 但没有 insert、且这个 id
不在任何 bundle 的声明里」的条目归到 `overrides`，然后什么也不发生。
插件不加载、不报错、日志里什么都没有。这是个会吃掉你半小时的坑。

重启 DSH（或在 YAML 里开着 HMR 时它自己会重载）。日志里出现这一行就算挂上了：

```
[phone-notify] 已挂载，推送到 https://your-host/…
```

开发时也可以不装，直接跑测试看它能不能起来：

```bash
npm install   # 只装一个 devDependency（schemastery，DSH 本来就有）
npm test      # 32 项，1.4 秒
```

## 配置

第一次用跑向导，会写 `~/.dsh-phone-notify.json`（权限 600）：

```bash
node bin/init.mjs
```

也可以直接用环境变量，覆盖一切：

```bash
export DSH_PHONE_WEBHOOK_URL="https://your-host/webhooks/dsh-notify"
export DSH_PHONE_SECRET="你的密钥"
```

### 哪些字段需要你自己填

代码包里没有任何人的地址、密钥、路径。三个本地值全部外部化：

| 字段 | 环境变量 | 说明 |
|---|---|---|
| `url` | `DSH_PHONE_WEBHOOK_URL` | 接收端地址，必须 http/https |
| `secret` | `DSH_PHONE_SECRET` | HMAC 密钥，留空则不签名 |
| `quietHours` | `DSH_PHONE_QUIET` | 例 `23:00-08:00`，跨零点也支持 |

优先级：**环境变量 > 配置文件 > 本机自动识别 > 内置默认**。

"自动识别"是指：如果这台机器装过 Hermes 并且订阅过 `dsh-notify`，
插件会去 `~/.hermes/state/dsh-notify.json` 里把地址捡起来当默认值。
没有就退回默认值，不猜、不联网探测。

缺字段不会静默失败——`resolveConfig()` 会返回 warnings，插件启动时打日志：

```
[phone-notify] ⚠ 没有配置签名密钥（secret），接收端如果要求验签会拒收
```

## 这个插件会发什么

一条推送就这些，**没有对话正文**：

```json
{
  "event": "task_done",
  "event_type": "task_done",
  "at": "2026-10-28T14:02:23.000Z",
  "title": "给推荐卡加一个墙",
  "session": "…f9177",
  "turn": "3"
}
```

`event_type` 是给接收端路由用的（Hermes 从 `payload.event_type` 取事件名，没有就记成
`unknown` 静默丢掉——这个是踩过的坑，写在 [docs/SAFETY.md](docs/SAFETY.md) 里）。

### 事件对照表

| DSH 的 `turn/end` reason.kind | 推送的 event | 叫不叫醒你 |
|---|---|---|
| `completed` | `task_done` | 叫 |
| `error` | `task_failed` | **免打扰时段也照叫** |
| `blocked` | `task_blocked` | 叫 |
| `max-tokens` | `task_truncated` | 叫（被截断了，得你接手） |
| `aborted` | `task_aborted` | 默认不叫，`notifyOnAbort: true` 打开 |
| `interrupted` | — | 不推：崩溃恢复时补写的收尾，不是实时事件 |
| `forked` | — | 不推：fork 边界标记 |

另外两个来自 DSH 的中间件事件：

| DSH 事件 | 推送的 event | 说明 |
|---|---|---|
| `approval/request` | `waiting_approval` | 工具要你批准，标题带工具名 |
| `user-questions/request` | `waiting_input` | DSH 在等你回答 |

这两个**只观察，不拦截**：插件照样把 `next()` 调下去，决定权还在电脑前。
通知失败也只是通知失败，不会让 DSH 卡在等你。

- `title` 截断到 60 字、换行压平，可用 `includeTitle: false` 整个关掉
- `session` 只保留**尾 6 位**，日志被人看到也拼不回完整会话
- `turn` 同理，尾部 8 位
- 正文、附件、文件路径：**一个字节都不带**

## 请求头

```
content-type: application/json
user-agent: dsh-phone-notify/0.1
x-dsh-event: task_done
x-dsh-id: <uuid>
x-webhook-timestamp: 1793000000              # 配了 secret 才有
x-webhook-signature-v2: <hex>                # 配了 secret 才有
```

验签：

```js
HMAC_SHA256(secret, `${timestamp}.${rawBody}`)   // hex，不是 base64
```

头名用 `X-Webhook-Signature-V2` 是为了对得上 Hermes 的 webhook 平台和 Standard Webhooks
那一系的口径——自定义头名会被人家当成"没带签名"直接拒，而且不告诉你是头名的问题。
时间窗建议 300 秒，过期即拒。

## 其他行为

- **幂等**：同一 `session + turn` 60 秒内只推一次，断网重连不会刷屏
- **去抖**：同一会话同类事件 3 秒内只推第一条（`minIntervalMs` 可调），免得连着震两次
- **重试**：5xx / 网络异常退避重试（默认 2 次）；4xx 直接放弃——那是地址或密钥错了，重试没意义
- **限流**：默认 10 条/分钟，超了丢掉并记日志
- **免打扰**：`quietHours` 内除 `task_failed` 外全静默
- **不打印密钥**：日志里只有错误类别和 HTTP 状态码

## 测试

```bash
npm test                        # 32 项单元测试 + 挂载测试
node bin/test-push.mjs          # 往你配的地址发一条假事件
```

`test/plugin.test.mjs` 用一个假的 Cordis ctx 把插件真挂一遍，验的是：
钩子注册上了没有、没配地址时会不会假装在工作、一轮结束有没有真的发出 POST、
`next()` 有没有被漏调。这部分不需要装 DSH。

第二条不碰 DSH、不读你的任何会话，只验"我这头到接收端"这段路。

## 安全

读 [docs/SAFETY.md](docs/SAFETY.md)。要点：

- 零依赖，不执行任何 shell 命令，不读配置文件以外的文件
- 只 POST，不 GET（不吃 SSRF 那条线）
- 非 http/https 地址直接拒绝
- 密钥不落日志、不进请求体、不进 git

## 为什么不做桌面通知

因为已经有三家做了，而且做得挺细（静音、去重、点击回跳、托盘隐藏也拉得回来）。
再做一个第四家没有意义。我要补的是它们共同没覆盖的那一格：**人不在电脑前**。

## License

MIT
