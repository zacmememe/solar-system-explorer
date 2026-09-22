# Pro 审查与 Antigravity 执行

仓库：https://github.com/zacmememe/solar-system-explorer 。本地 `main` 跟踪 `origin/main`。

## 日常一轮

1. Antigravity 完成一个边界明确的改动后，检查 `git status` 和 diff，运行相关测试。只提交这一轮需要的文件。
2. `git push` 推送到远程仓库。用 `git rev-parse HEAD` 取得完整 commit；用 `git status --short` 确认还有哪些内容仅在本地。
3. 在 ChatGPT 网页选择平时使用的 Pro 模型，用 `docs/review-prompt.md` 发起审查，填写仓库、commit、目标和本轮测试结果。
4. 检查其实际读取的文件和引用。不能确认目标版本、无法读取的模块，应补充原文或使用导出包，不要把推测当作审查结果。
5. 讨论并确认方案后，按 `docs/implementation-plan-template.md` 保存到 `docs/plans/日期-主题.md`，交给 Antigravity 执行。
6. Antigravity 按批次实现和验证，记录与方案的偏差。下一轮审查给出新 commit 和上一轮 commit。

提交保存的是本地版本；推送才会更新 GitHub。未提交文件和未推送提交不会通过 GitHub 连接出现在 ChatGPT 中。审查期间如继续开发，必须保持审查的 commit 不变，避免双方讨论不同版本。

## 通过公开链接审查

仓库公开后，优先将仓库网址和完整 commit 发给 Pro。公开网页访问无需私有仓库连接授权，也不要求为此启用 GitHub 插件。

公开的是 Git 已跟踪并推送的内容，不包括本地未提交、未推送或被忽略的文件。它也不会自动把全仓库载入模型上下文。要求模型实际读取源码、报告覆盖范围；工具无法读取的文件应明确列出。

如果模型具备下载解包能力，可让它读取固定提交的完整 GitHub 源码归档：`https://github.com/zacmememe/solar-system-explorer/archive/<完整commit>.zip`。该归档包含此提交的所有已跟踪文件，与本地精简审查包的选择范围不同。无法下载或解包时，改为逐文件读取并报告缺口。

## 可选：连接 GitHub 插件

如仍需要插件检索，在 ChatGPT 网页的 Apps / Plugins 中选择 GitHub，登录目标个人账户，只授权本项目。GitHub CLI 登录用于本机推送，ChatGPT 的授权在网页独立完成；若页面要求 MFA 且不希望开启，使用公开链接审查。

选择平时使用的 Pro 模型后，要求它：

> 读取仓库的 README.md、package.json 和 src/app/hud/store.ts。引用 review:export 的实际命令，解释 HUD 状态由谁发布、谁订阅；列出文件来源，并说明能否确认所读 commit。请使用仓库工具实际读取，不依据此前聊天猜测。

如果该模式没有 GitHub 工具，或者无法核实目标版本，使用下面的审查材料导出。不要把支持 GitHub 的其他模式等同于已验证 Pro 模式。官方能力与界面可能调整：

- https://help.openai.com/en/articles/11145903-connecting-github-to-chatgpt
- https://help.openai.com/en/articles/11487775-connectors-in-chatgpt

官方 GitHub 连接按需读取仓库，不代表已完整阅读所有代码。审查必须报告覆盖范围。私人账户的应用数据使用还取决于 ChatGPT 的“Improve the model for everyone”设置；如不希望用于改进模型，可在 Data Controls 中关闭。

## 一键生成材料

Windows 可直接双击项目根目录的 `导出Pro审查材料.bat`；它导出 HEAD 并附带已有的预选截图。若要包含尚未提交的修改，使用下面的 `--working-tree` 命令。

双击入口会寻找已有的 Node.js；导出脚本会寻找已有的 Git，包括本机 Codex 自带的 Git，不修改系统 PATH。成功时显示 `SUCCESS:` 和新 ZIP 的完整路径；`review-exports/LATEST.txt` 始终指向最近一次成功导出的文件，失败不会更新它。目录里的旧包会保留，因此看到文件不等于本次执行成功。

```powershell
# 推荐：导出刚提交、推送的 HEAD
npm run review:export

# 比较两轮：输出指定基线到 HEAD 的文本差异
npm run review:export -- --base 上一轮commit

# 加入已有画面证据；导出不会运行浏览器或重新截图
npm run review:export -- --with-images

# 临时讨论尚未提交的实现，材料会明确标为工作区快照
npm run review:export -- --working-tree
```

输出在项目 D 盘目录下的 `review-exports/`，不会纳入 Git。Windows 还会生成同名 ZIP。可上传 ZIP；也可上传 `REVIEW.md` 和全部 `source-context-*.md`。包内保留按原路径存放的源码及 SHA-256 清单，便于定位。

默认包括当前 `src/`、`tests/`、`scripts/`、`docs/`、`sources/` 和核心配置；不包括依赖、构建产物、原始聊天、历史交接包、凭据和大体积纹理二进制。纹理文件另有路径/哈希清单。`--with-images` 仅加入预选的少量已有 PNG，文件时间不等同于拍摄时对应 commit，需自行确认。

工作区导出可能包含新增文件。脚本会检查常见凭据特征并拒绝明显敏感文件名，但不能替代人工检查。导出期间请暂停编辑；脚本检测到选中文件在读取过程中变化时会中止。

导出不运行测试，也不将过去的测试报告标成当前通过。将本轮真实执行的命令、结果及画面问题补充给 Pro。

## 本机 GitHub CLI

已有 CLI 位于 `D:\Apps\GitHubCLI\2.101.0\bin\gh.exe`，配置目录为 `D:\Apps\GitHubCLI\config`。需要使用 CLI 时：

```powershell
$env:GH_CONFIG_DIR = 'D:\Apps\GitHubCLI\config'
& 'D:\Apps\GitHubCLI\2.101.0\bin\gh.exe' auth status
```

不要将 CLI 登录令牌复制到项目、提示词或审查材料中。

本机已在这个仓库的本地 Git 配置中指定上述 CLI 和 D 盘配置目录，因此 Antigravity 的普通 `git push` / `git pull` 不需要手动设置 `GH_CONFIG_DIR`。该配置不含令牌，也不影响其他项目；若将来移动或移除该版本的 GitHub CLI，应相应更新本仓库的 credential helper。
