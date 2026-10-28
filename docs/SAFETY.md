# 安全自查

分两栏：装这个插件的人会遇到什么，我们自己会遇到什么。
写成可勾选的清单，发版前逐条过一遍。

---

## A. 对其他用户

| # | 风险 | 处理 | 验证方式 |
|---|---|---|---|
| A1 | 会话标题被推到第三方服务 | 默认只推事件+标题，正文零字节；`includeTitle:false` 可全关 | `test: payload 只有状态，没有正文` |
| A2 | 会话 ID 泄露成完整指纹 | 只留尾 6 位 | `test: 会话 ID 只留尾 6 位` |
| A3 | 密钥或地址被写进 git | 代码里只有占位符；`.gitignore` 排除本地配置 | `grep -rn "<你的域名>\|你的QQ号\|token" . --exclude-dir=.git` 应为空 |
| A4 | 明文 http 把密钥送出去 | `resolveConfig` 对非本机 http 出 warning；README 明示 | 手工跑一次 resolveConfig |
| A5 | 被当成 SSRF 跳板 | 只接受 http/https，只 POST，不跟随重定向，不读响应体 | `test: 非 http 地址直接拒` |
| A6 | 刷屏 / 被当成拒绝服务工具 | 默认 10 条/分钟 + 同轮 60 秒幂等 | `test: 同一轮重复事件只推一次` |
| A7 | npm 供应链投毒 | `dependencies: {}`，只用 `node:` 内置模块 | `npm ls --prod` 只有自己 |
| A8 | 插件偷偷读文件/跑命令 | 只读 `~/.dsh-phone-notify.json` 与 `~/.hermes/state/dsh-notify.json` | 代码审 `readFileSync` 出现处 |
| A9 | 密钥被打进错误日志 | 日志只输出 `err.name` 与状态码；`test` 断言请求体不含 secret | `test: 成功推送带上签名头` |
| A10 | 接收端被伪造请求打 | 提供 HMAC + timestamp，README 给验签代码 | 手工：错签名 POST 应 401 |

## B. 对我们自己

| # | 风险 | 处理 | 状态 |
|---|---|---|---|
| B1 | 我们的域名/QQ 号/secret 进公开仓库 | 代码与文档全用 `<you>` / `your-host` 占位符 | ✅ 已全库扫过 |
| B2 | 有人拿我们的端点乱推 | 端点带 per-subscription secret，必须验签 | ⏳ 等网关重启后测错签名 |
| B3 | 我们的会话标题推到手机 | 已在订阅模板里；是否保留标题由主人拍 | 待定（A/B 选项） |
| B4 | 发布用的 GitHub token 泄露 | 最小权限 `public_repo`，用后立刻撤销 | 待执行 |
| B5 | 读别人 issue/PR 时被钓鱼 | 只读 diff 不执行；任何"给我 token/地址"一律不理 | 长期规则 |
| B6 | 仓库里混进聊天记录/内网 IP | 提交前 grep：内网 IP 前缀、自有域名、会话 ID 前缀 | 每次提交前跑 |
| B7 | License 与实际依赖冲突 | MIT + 零依赖，无冲突 | ✅ |

## C. 发版前必跑

```bash
cd dsh-phone-notify
npm test
npm ls --prod                      # 应该只有自己
grep -rniE "(你的域名|内网ip|session_id|token|secret=|cookies)" . --exclude-dir=.git
git status --short                 # 不能有 .dsh-phone-notify.json
```

四条全干净才推。
