# 发布到 GitHub —— 第一次也能照着走

假设你从没发过仓库。两种路，任选一种。

---

## 路线 A：网页点（最稳，不用装任何东西）

1. 登录 GitHub → 右上角 `+` → **New repository**
2. **Repository name** 填 `dsh-phone-notify`
3. **Description** 粘贴：
   > Push DeepSeek Harness task events (done / failed / waiting) to your phone via webhook — for when you're away from the computer.
4. 选 **Public**
5. **不要**勾 "Add a README / .gitignore / license"——本地已经有了，勾了会冲突
6. 点 **Create repository**
7. 新页面会出现一堆命令，照抄"…or push an existing repository from the command line"那一段：

```bash
cd dsh-phone-notify
git remote add origin https://github.com/<你的账号>/dsh-phone-notify.git
git branch -M main
git push -u origin main
```

8. 推完回到仓库页 → 右上 **⚙️ / Edit repository details**：
   - **Topics** 填：`dsh-plugin` `deepseek-harness` `notification` `webhook` `push-notification`
   - **Website** 可留空
9. 右侧 **About** 里的 Description 就是第 3 步那段，没填的话在这里补

> 身份验证：GitHub 现在不收密码。用 **Personal Access Token**（Settings → Developer settings →
> Personal access tokens → Tokens (classic) → Generate new token，勾 `repo`）当密码用，
> 或者走 `gh auth login`。

## 路线 B：命令行（gh CLI，之后升级方便）

```bash
# 安装
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
sudo chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
sudo apt update && sudo apt install gh -y

gh auth login          # 选 HTTPS + 浏览器一次性码，最省事

cd dsh-phone-notify
gh repo create dsh-phone-notify --public --source=. --push \
  --description "Push DeepSeek Harness task events to your phone via webhook"
gh repo edit --add-topic dsh-plugin --add-topic deepseek-harness --add-topic webhook
```

## 发完立刻做的三件事

1. **看首屏**：打开 `https://github.com/<你>/dsh-phone-notify`，
   README 第一屏能不能让人三秒内知道"这解决什么问题"。不能就改标题和第一段。
2. **给自己发一个 issue**：标题「v0.1.1 接通 DSH 事件」，正文写三条待接线的钩子。
   以后别人来看，知道这项目是活的。
3. **看 Insights → Traffic**：一周后有没有人点进来。0 也是数据。

## 之后每次更新

```bash
git add -A && git commit -m "fix: 重试不再吃掉 4xx"
git push
gh release create v0.1.0-alpha --title "0.1.0-alpha" --notes "- 推送核心\n- 配置向导\n- DSH 事件待接"
```

---

## 参考教程（挑能看的）

- GitHub 官方：<https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository>
- 官方 README 规范：<https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes>
- 官方 License 指引：<https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository>
- 官方仓库最佳实践：<https://docs.github.com/en/repositories/creating-and-managing-repositories/best-practices-for-repositories>
- README 模板（拿来改）：<https://github.com/othneildrew/Best-README-Template>
- README 写法要点：<https://github.com/jehna/readme-best-practices>
- npm 发布官方：<https://docs.npmjs.com/creating-and-publishing-unscoped-public-packages/>
- npm 发布实操：<https://dev.to/champcbg/how-to-publish-your-first-npm-package-a-step-by-step-guide-51ha>

## 关于 npm

**先别发 npm。** DSH 插件大多靠 git clone 装，npm 上多一个包只是多一份要维护的坑
（版本号、scope、2FA、撤包规则）。等真有 10 个人问"能不能 npm 装"再说。

---

## 最后一节：为什么 index.js 现在是空的

同类插件里有一个作者写了自检，用来过滤子智能体产生的通知。自检一直绿，
过滤从来没生效过——因为他用了一个**不存在的字段名**，判断恒为 false。

我不想复制这个错误。DSH 装好之后，我要做的第一件事是打印真实会话行，
看清 `displayTitle`、`origin`、`parentId`、`retainedBy` 到底有什么、什么时候变，
再写那三个钩子。

在那之前，`lib/index.js` 里挂三个 TODO 出口，README 标 `alpha`。
**宁可看起来不完整，也不要看起来完整但其实没跑。**
