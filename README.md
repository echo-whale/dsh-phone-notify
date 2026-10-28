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
| 44 项测试 | ✅ 全过 |
| 真机联调（装进 Windows 上的 DSH，推 QQ） | ✅ 已跑通：`plugin_mounted` / `task_done` 全程 200 |

## 适配版本

| 组件 | 版本 | 说明 |
|---|---|---|
| DSH（DeepSeek Harness） | `0.2.1-rc.3` | 真机验证的版本。事件名与字段从它的 npm 类型定义读出来，不是猜的 |
| Cordis | `4.0.5` | DSH 的插件宿主；`export function apply(ctx, config)` + `ctx.on(...)` |
| Node.js | `>= 20`（实测 22.x） | 只用 ESM、`globalThis.fetch`、`AbortSignal.timeout`，没有原生编译 |

DSH 的 rc 通道改字段比想像中频繁。升级 DSH 后如果突然收不到推送，第一步是重跑
`npm test` 里的事件回放用例（`test/fixtures/` 存的是真实会话日志），红了就是上游改了字段。

事件名和字段来自 DSH 自己发布的 npm 包，可以自己核对：

```bash
npm pack @deepseek-ai/dsh-session@0.2.1-rc.3
tar -xzf dsh-session-*.tgz
grep -n "'turn/end'" -A 4 package/lib/types/types.d.ts
```

## 使用方法

三步，五分钟。**判据是手机收到一条"已挂载"**——收不到就不用往下猜了，先看「注意事项」的第 1、2 条。

### 第 1 步：放包

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

### 第 2 步：改 `cordis.patch.yml`

`insert:` 那一层不能省。这个文件里裸写的 `- id: xxx` 是**覆盖已有行**的语义，
不是新增——`@deepseek-ai/dsh-plugin-manager` 会把「有 id 但没有 insert、且这个 id
不在任何 bundle 的声明里」的条目归到 `overrides`，然后什么也不发生。
插件不加载、不报错、日志里什么都没有。这是个会吃掉你半小时的坑。

### 第 3 步：完全退出 DSH，再启动

**关窗口不算重启。** DSH 常驻托盘，得托盘右键退出——Node 已经把插件读进内存了，
只关窗口再打开，跑的还是旧代码。挂上之后手机会立刻收到一条：

```
🔌 已挂载｜dsh-phone-notify v0.2.4
```

标题里那个版本号就是**当前进程真正在跑的版本**，比看磁盘上的文件可靠。
之后每跑完一轮就有一条 `✅ 做完了｜<会话标题>`。

开发时也可以不装，直接跑测试看它能不能起来：

```bash
npm install   # 只装一个 devDependency（schemastery，DSH 本来就有）
npm test      # 44 项，1.5 秒
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
user-agent: dsh-phone-notify/0.2.4
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
npm test                        # 44 项单元测试 + 挂载测试 + 真实日志回放
node bin/test-push.mjs          # 往你配的地址发一条假事件
```

`test/plugin.test.mjs` 用一个假的 Cordis ctx 把插件真挂一遍，验的是：
钩子注册上了没有、没配地址时会不会假装在工作、一轮结束有没有真的发出 POST、
`next()` 有没有被漏调。这部分不需要装 DSH。

第二条不碰 DSH、不读你的任何会话，只验"我这头到接收端"这段路。

## 表情包（可选，推荐）

文字是信息，表情是情绪。同一个「✅ 做完了」看十遍，你会开始跳过它；配一张图，你会先看那一眼。

插件只发文字，图在接收端加——这样插件保持零依赖零素材，接收端想配什么配什么。

**推荐素材**：一套叫**大肥鱼**的表情包，322 张动图、25 个情绪分类（开心/疑惑/无语/垮掉/安慰……），
作者 B 站 [可以叫我云大人](https://space.bilibili.com/103739)、[kiriyuki.com](https://kiriyuki.com) 制作，
CC-BY-NC-4.0（非商用、保留署名）。

### 装完之后怎么挂进来

接收端拿到的是 `event_type` + 一句 `label`，所以只要一张「事件 → 图」的表：

```python
# 接收端（webhook handler）里加这么一段就够了
STICKER = {
    "task_done":        "whale_ok.gif",       # 得意，举牌 ✅
    "task_failed":      "whale_fail.gif",     # 趴地上，举牌 ❌
    "waiting_approval": "whale_hmm.gif",      # 歪头，等你点头
    "waiting_input":    "whale_pat.gif",      # 拍拍，等你回话
}

def on_event(event_type: str, label: str, title: str) -> None:
    send_text(f"{label}｜{title}")
    if gif := STICKER.get(event_type):
        send_image(gif)                        # 文字在上、表情在下，像人发完补一张
```

配好之后手机上长这样：

```
✅ 做完了｜给推荐卡加一个墙
[一张举着 ✓ 的鲸鱼娘]
```

Hermes 用户可以用 webhook 路由的 `sticker_map`（手工键，CLI 不暴露）配同一张表；
其它接收端同理——Bark / 企业微信 / 飞书机器人 都支持图文两条消息。

选图的诀窍是**别选"正确"的，选"有反应"的**：`task_done` 配个打勾图标正确但无聊，配一张拉炮，你会笑一下。

素材版权归作者，随这个仓库分发不合适，所以包里没有任何图片。

## 注意事项

1. **`insert:` 不能省**（见第 2 步）。漏了不会报错，只会静默不加载——这是这个项目最费时间的一个坑。
2. **"重启"是退出进程，不是关窗口。** 装完/改完没有真的重启，表现是「文件是新的、功能是旧的、一条错误都没有」。
3. **接收端要认 `event_type`。** 很多 webhook 网关按这个字段取事件名，缺了就归到 `unknown` 静默丢弃，返回 200 却什么都不推。
4. **`secret` 两边必须一致**，且签名是 `HMAC_SHA256(secret, timestamp + "." + body)` 的 hex，不是 base64；头名是 `X-Webhook-Signature-V2`，自定义头名会被当成"没带签名"。
5. **免打扰时段里 `task_failed` 照样推**——失败了总该知道，其余事件静默。
6. **推送不含对话正文**，只有会话标题和 id 尾号。接收端被别人看到也拼不回内容。

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
