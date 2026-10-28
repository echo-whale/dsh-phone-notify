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
| 推送核心 `lib/notify.js` | ✅ 可用，11 项测试全过 |
| 配置解析 / 自动识别 / 向导 | ✅ 可用 |
| DSH 事件接线 `lib/index.js` | ⏳ **v0.1.1**，等真机验证事件字段 |

现在发的是 `0.1.0-alpha`：能拿来做接收端联调，还不能真的替你在 DSH 里弹通知。
原因写在 [docs/PUBLISH.md](docs/PUBLISH.md) 最后一节：宁可空着，也不猜一个字段名上去。

## 安装

```bash
git clone https://github.com/<you>/dsh-phone-notify
cd dsh-phone-notify
npm test          # 11 项，秒级
```

没有依赖。`dependencies` 是空的——不是你信我，是这一行本身可验证。

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
  "at": "2026-10-28T14:02:23.000Z",
  "title": "给推荐卡加一个墙",
  "session": "…f9177",
  "turn": "654321"
}
```

- `title` 截断到 60 字、换行压平，可用 `includeTitle: false` 整个关掉
- `session` 只保留**尾 6 位**，日志被人看到也拼不回完整会话
- `turn` 同理，尾部 8 位
- 正文、附件、文件路径：**一个字节都不带**

## 请求头

```
content-type: application/json
x-dsh-event: task_done
x-dsh-timestamp: 1793000000
x-dsh-id: <uuid>
x-dsh-signature: sha256=<hex>      # 配了 secret 才有
```

验签口径和 Hermes 的 webhook 平台一致：

```js
HMAC_SHA256(secret, `${timestamp}.${rawBody}`)
```

配合 `x-dsh-timestamp` 做时间窗校验（建议 300 秒），过期即拒。

## 其他行为

- **幂等**：同一 `session + turn` 60 秒内只推一次，断网重连不会刷屏
- **重试**：5xx / 网络异常退避重试（默认 2 次）；4xx 直接放弃——那是地址或密钥错了，重试没意义
- **限流**：默认 10 条/分钟，超了丢掉并记日志
- **免打扰**：`quietHours` 内除 `task_failed` 外全静默
- **不打印密钥**：日志里只有错误类别和 HTTP 状态码

## 测试

```bash
npm test                        # 单元测试
node bin/test-push.mjs          # 往你配的地址发一条假事件
```

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
