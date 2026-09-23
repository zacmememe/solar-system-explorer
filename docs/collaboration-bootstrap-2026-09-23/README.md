# 协作启动包：本轮结束后启用

状态：**PREPARED_NOT_ACTIVE**。2026-09-23 由 Codex 准备；当前 zcode 继续原任务。本目录不是正在生效的第二套项目规则，也没有自动启动其他 Agent。

## 结论与落地选择

近期 zcode 是唯一业务代码作者，Anti 因额度暂停，Codex 不做日常重度实现或调度。zcode 先收口正在做的单元，再按短任务持续实现和取证。跨工具/架构/视觉批准缺失时保留待审成果，不把另一个 zcode 会话或像素非黑检测包装成独立视觉通过。

长期恢复成 zcode 工程与数据、Anti 视觉与体验两条主力。日常由短时值班角色串行集成，Pro 做阶段深审，Codex 只处理精确候选的关键争议。用户只在大体验节点做方向取舍，不逐张卡转发消息或批准实现细节。

采用**本机单一队列文件**，暂不创建 GitHub Issue 看板、自动调度服务或常驻会话：

`D:\Game Zac\Personal Projects\太阳系漫游\review-exports\coordination\queue.md`

理由：当前只有一个业务作者，未发现现成动态队列；文件足以让当前会话续作，也避免为还未恢复的角色维护外部系统。所有 worktree 都读这一绝对路径，由指定值班会话串行维护，禁止把各 worktree 的副本当作新队列。它是本机运行状态，不进入 Git；公开阶段摘要继续放 `docs/`。将来确需跨机器再一次性迁移到 Issues，关闭旧状态源。

## 本轮已核对现场（不是持续更新的看板）

检查时间：2026-09-23 04:07 PDT 左右。

| 项目 | 事实与边界 |
| --- | --- |
| 目录 / 作者 | 原目录 `D:\Game Zac\Personal Projects\太阳系漫游`；zcode 正在工作，由用户明确说明；session ID 未取得 |
| 分支 / HEAD | `main` / `7de3a68313f219afb1e45eb983510341c88326c9`，P1 提交；本地 origin/main 同步显示无 ahead/behind，本轮没有查询远端来冒充实时服务器状态 |
| worktree | 只有原目录，尚未建立工程/视觉/review worktree |
| 当前改动 | `.gitignore`、SolarEngine、LandingController、TerrainHeightProvider；新 Apollo17 获取脚本、RasterTerrainSource、descentCurve、public/data 等，说明在做 P2 月表/下降范围；具体任务名与本轮终点由 zcode 检查点确认 |
| 已有 P1 交付 | `docs/pro-review-batch-p1-handoff.md`、`docs/plans/2026-09-23-p1-physics-metric-core.md`；作者报告 111 单测、9 个浏览器检查通过。本次未重跑，不视作独立批准 |
| 现有缺口 | P1 交接仍列出光照显示比例、其他卫星姿态等限制；本次仅把它们转成候选复核问题，不替 zcode 重做 P1 |
| 进程 / 端口 | Win32_Process 读取未取得清单；本轮未启动或停止业务进程，端口未确认。不能把空输出写成“没有进程” |
| 下一动作 | 当前作者完成正在验证的单元→保存 checkpoint→启用此包→继续现有任务或领取预分配支持任务 |

上一份 `docs/zcode-handoff-2026-09-23.md` 是早先 P1 未完成时的快照，不能用它把现已提交的工作退回起点。本包没有认定 P2 已完成，收到 prompt 时应读取最新状态。

## 安全检查点后的启用步骤（由 zcode 执行一次）

1. **接住当前轮**：完成当前验证单元，写 checkpoint：真实任务/HEAD/分支、未提交及未跟踪数据、测试及未测项、PID/端口/cwd、下一步。不得为“工作区干净”丢弃文件或全局杀进程；当前轮已有的用户授权和交付不被倒推撤销。
2. **合并流程文档**：将 `workflow-insertion.md` 的内容并入现有 `docs/review-workflow.md`，替换“日常一轮”和标题等过时角色描述，保留公开源码审查、导出、GitHub CLI 等仍有效章节。不要整文件覆盖。
3. **合并短规则**：按 `agents-amendment.md` 修改根 AGENTS，仅替换过时角色条款并增补入口。此步生效前业务流程不突变。
4. **选定唯一状态**：先检查是否已新建了有效队列；若已有则复用并修改本包路径说明。若没有，把 `queue.seed.md` 初始化到上述本机路径，已有文件则读取合并，绝不覆盖。登记真实会话 ID、当前所有者、时间及候选状态；不能把模板 READY 当事实。用提供的短模板写 checkpoint/review。
5. **确定本轮分支**：当前任务已经结束则保留其提交；尚有待审生产实现则由当前作者在本目录保存到短任务分支。核对每个文件与忽略的大数据，不能 `git add .`。不移动活跃目录，不替另一会话 stash/checkout。新任务以任务命名，如 `task/P2-moon-surface`，不可与已有分支冲突。Codex 自己新建分支时仍用 `codex/`。
6. **开始运行**：只读当前任务卡和相关代码，按 `roles.md` 的 zcode 段工作；当前任务已做的项转为验收。每完成一个单元更新队列和证据，继续预分配且依赖满足的任务。
7. **记录启用**：队列写明 `workflow_version=solar-coordination-v1`、启用时间/人、规则来源提交。常驻规则变更单独列在交接，不和产品成功结论混淆。`tools/check-packet.mjs` 的 CONSISTENT 不是项目验收。

后续有效规则只有根 AGENTS + `docs/review-workflow.md`；本目录保留为启动资料。动态状态只有本机队列；任务卡、检查点与报告是它引用的记录，不各自维护互相矛盾的总看板。

## 何时真正创建 worktree

当前单人可以在原目录继续短任务，**不为形式立即复制依赖或搬工程**。需要并行第二作者、独立运行审查、准备组合候选时才建隔离目录。建议兄弟根：`D:\Game Zac\Personal Projects\solar-worktrees`，先检查已有路径/权限。原作者自然停写、冻结准确提交后再建立；新 worktree 不包含原目录未提交内容。

任务 worktree 一任务一分支一作者；review detached 固定 SHA；integration 一次一个候选；体验入口指向最后验收版本，不等同活跃开发目录。端口 5174/5175/5176、稳定预览 4173 仅为候选，先确认空闲，用 `--strictPort`。浏览器 profile、输出、node_modules 独立；D 盘缓存复用，原始资产按 hash 只读共享；GPU 性能测量串行。

具体 Git 手册仍见原 Pro 包 `03-Worktree安全运行手册.md`，按需读。不要让每个会话加载整包。没有配置跨工具唤醒渠道，恢复时由用户启动一次对应工具；运行中的 Agent 直接读队列。

## 提供了什么与验证边界

- 可直接发给 zcode：`zcode-next-round-prompt.md`。
- 待并入现有文档的规则：`workflow-insertion.md`、`agents-amendment.md`。
- 唯一队列种子：`queue.seed.md`；短岗位入口：`roles.md`；任务/review/checkpoint/里程碑模板：`templates/`。
- Pro 原只读检查器：`tools/check-packet.mjs`；政策样例：`examples/`；机制测试：`tests/`。
- 原始来源与复制哈希：`provenance.json`；本机测试和未实施事项见 `validation.md`。

未修改业务源码、既有常驻规则、当前 Git 分支和索引；未建立真实协作 worktree/PR/Issue/自动调度，未重跑产品测试、构建和 GPU。待审记录、模板和离线机制测试不等于完成了一次真实作者→独立审查→合并流程。
