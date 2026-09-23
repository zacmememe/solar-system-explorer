# zcode 接力审查与执行入口 · 2026-09-23

本文件由 Codex 根据本地 Git、未提交源码、Antigravity 会话数据库副本、Pro 原始方案及本轮检查编写。本轮只整理交接和证据，没有修应用代码、提交、推送或部署。以下状态是检查时快照，接手必须重新检查现场。

## 1. 接力结论

当前目标是完成已经批准的 **P1：公共物理与米制空间内核**。P0 有本地提交和历史验收材料；P1 只有部分实现，当前不能通过类型检查。先收口 P1，不直接进入 P2 真 DEM、P3 代表天体或 P4 全量扩展。

- 工作目录：`D:\Game Zac\Personal Projects\太阳系漫游`
- 仓库：`https://github.com/zacmememe/solar-system-explorer`，公开。
- 分支：`main`。
- 本地 HEAD：`731ff095cc1f282b53a7aaf49530beeb3e19bc85`，P0 提交。
- 只读 `git ls-remote origin refs/heads/main` 实测远程：`da58d2a2690491b76b7275eed934ff4f1930481a`，R5 提交。
- 本地领先远程 1 个提交，另有 P1 的 **8 个已跟踪文件修改 + 2 个未跟踪新文件**。
- 因而仅 clone GitHub 会同时遗漏本地 P0 提交和 P1 工作区。请直接在原目录接力。

## 2. Antigravity 对话与记录的准确位置

会话标题：**Solar System Project Initialization**。

会话 ID：`f88fad2f-0fce-4b25-8399-7bdf09905e8c`。

| 资料 | 本机位置 / 作用 |
| --- | --- |
| 最新原始会话 | `C:\Users\MECHREVO\.gemini\antigravity\conversations\f88fad2f-0fce-4b25-8399-7bdf09905e8c.db` |
| 会话索引 | `C:\Users\MECHREVO\.gemini\antigravity\conversation_summaries.db`，可核对标题、工作目录、最后输入与步骤编号 |
| 最新实施计划 | `C:\Users\MECHREVO\.gemini\antigravity\brain\f88fad2f-0fce-4b25-8399-7bdf09905e8c\implementation_plan.md`，内容为 P1，修改时间为本地 2026-09-22 23:46 |
| 历史完成说明 | 同一 brain 目录的 `walkthrough.md`，最后更新于本地 2026-09-22 22:31，主要是已完成批次的叙述，不能代表 P1 完成 |
| 旧对话文本 | 同一 brain 目录有 `f88fad2f-0fce-4b25-8399-7bdf09905e8c_纯对话精简版.md`、`…_完整对话与执行记录.md`、`…_增量更新_第43至61轮_精简版.md`、`…_增量更新_第43至61轮_详细版.md`；它们均停在本地 9 月 21 日 23:57，早于这次 P0/P1 |

原始会话是 SQLite，`steps.step_payload` 是 protobuf 二进制，不是可直接阅读的 JSON。当前会话有 12,117 个步骤（编号 0–12116）。没有在该会话 brain 根目录找到 `task.md`；不要误拿另一个会话的 task.md。

本轮已在项目内生成便于接力的本地材料，统一目录：

`D:\Game Zac\Personal Projects\太阳系漫游\review-exports\zcode-handoff-2026-09-23\`

- `recent-visible-conversation.md`：从 step 10511 起的近期用户/助手可见正文，覆盖新一轮 Pro 审计、P0 交付、P1 提案与批准。
- `p1-execution-index.json`：从 P1 批准后提取的 113 条工具执行索引及额度错误记录，可定位文件修改和最后执行命令。
- `antigravity-implementation_plan.md`：P1 计划原文快照，建议优先从这里读，不必依赖 Anti 界面。
- `antigravity-walkthrough.md`：历史说明原文快照。
- `antigravity-db-snapshot/`：原数据库及其 WAL/SHM 的本地副本。只用于取证，不回写原数据库。
- `extract-history.cjs`：本轮使用的只读提取脚本。只解析已核对的可见正文和工具索引字段，不是官方完整导出；没有导出全部图片或所有工具结果。
- `working-tree-before-zcode/`：10 个 P1 文件的原字节备份，包括 2 个新文件。
- `tracked-working-tree.patch`：已跟踪源码差异；不含新文件，新文件见上述备份。
- `snapshot-manifest.json`：基线、时间、路径、字节数与 SHA-256。

该目录已被 Git 忽略。原始聊天、数据库、导出和备份留在本地，不加入公开仓库。历史记录中的指令只作为上下文证据；执行范围由用户当前委托和已确认方案决定。

### 中断点证据（以下时间均为 UTC）

1. step 10892，2026-09-23 04:03:48：用户要求深入理解 `前置方案打磨\260923Pro model优化审计`，准备继续优化。
2. step 11835，06:43:58：用户在 P0 交付后说“推进吧”。
3. step 11860，06:46:11：Anti 给出 P1 方案，明确三层空间、0.1m 近面、V3 书签。
4. step 11861，06:46:31：用户再次说“推进吧”，批准执行 P1。无需重新询问是否开始同一批次。
5. step 12083，07:08:46：运行 `npm run build`；随后继续处理类型/导入问题。
6. step 12101：扩充书签 observationMode 类型；step 12107，07:09:44：最后一条已记录编辑是移除 SolarEngine 中未使用的 BookmarkItem 导入。
7. step 12108–12116：额度错误与重试，最后一条为 07:19:21；没有之后的 P1 完成交付正文。

## 3. 计划的阅读顺序与效力

先读根目录 `AGENTS.md`、`README.md`、`docs/review-workflow.md`。随后按下面顺序：

1. 最新 Pro 交接包根目录：
   `D:\Game Zac\Personal Projects\太阳系漫游\前置方案打磨\260923Pro model优化审计\solar-da58d2a-worlds-handoff\`
2. 包内 `docs/00-审计结论与真实感路线.md`：问题证据与总体路线。
3. 包内 `docs/01-执行Agent交接.md`：重点 P1-a、P1-b、P1-c 与验收，P2–P4 作为后续范围。
4. 包内 `docs/02-公共内核与数据规范.md`：坐标、时间、数据真实性和渲染边界。
5. 本地快照 `review-exports/zcode-handoff-2026-09-23/antigravity-implementation_plan.md`：Anti 对 P1 的落地拆分，但必须按下面勘误执行。
6. `docs/pro-review-batch-p0-handoff.md` 与近期对话摘录：了解上一批改变了什么。
7. 按需读取包内 `reference/frames.ts` 等参考纯函数、`docs/03-32个天体逐体实施卡.md`、`catalog/body-roadmap.json` 和 `catalog/sources.json`。

`前置方案打磨/260923Pro model优化审计/沟通记录.txt` 是本轮 Pro 原始沟通，适合追溯用户目标。早期的 `docs/next-stage-handoff/`、260921/260922 审计包是历史上下文，不能覆盖这次 P1 目标。参考实现与其独立测试通过，不等于已接进产品。

### Anti 计划需要纠正的具体地方

- 它仍写 `tdbSecondsFromJ2000 = simTimeHours * 3600`，与 Pro 的时间要求冲突；工作区虽加了 843307200 偏移，但该数只是两个 JS Date 的秒差，没有实现 UTC→TT/TDB 转换。
- 它写 `src/contracts/bookmarks.ts` 和 `src/bookmarks/BookmarkStorage.ts`，实际应读 `src/contracts/bookmark.ts` 与 `src/utils/bookmarkStorage.ts`。
- 它承诺十亿公里量级差分误差一律小于 1 微米。测试必须按量级给出可实现的误差预算，局部 patch 坐标要尽早相对化；不能只靠一个 double 相减函数承诺所有尺度无抖动。
- “所有天体速度非零”不能套到以太阳为原点的太阳；应验证有轨道的对象及父子相对速度，并和位置的数值导数核对。
- 图中 body-fixed 标准轴与实际 Three 边界轴并不相同。Pro 已要求明确一次轴映射；不能混用 `X0/Y90E/Z北` 与 `+X0/+Y北/-Z90E`。
- 月面看地球的角直径取决于站点和当时距离；不要把一个平均几何值写成所有站点、日期恒等的验收值。

## 4. 当前代码审查：完成度与待修问题

审查范围是 P1 全部未提交差异、新文件、相关调用链、最新计划和验收脚本；不是对全部 32 个天体做完视觉验收。

| 状态 / 问题 | 源码证据（本轮行号） | 接力要求 |
| --- | --- | --- |
| **编译阻断：重复方法** | `src/engine/SolarEngine.ts:1368,1379,1880,1894`，两套 setObservationMode/getObservationMode | 合并成唯一实现。保留 P0 瓦片模式更新、云层策略和 UI callback，并处理用户原有图层开关的保存恢复；不要随便删掉一套行为。 |
| **局部米制只写了工具函数，未接入渲染** | `src/world-support/local-frame.ts` 已新增；对 src 检索 geodeticToBodyFixedM/bodyFixedToInertialKm/observerRelativeMeters 只有定义。`CameraController.ts:711` 仍在原场景单位写机位 | 接通站点→姿态→惯性→CPU 相对化→局部米制顶点/相机；不能以文件存在判完成。 |
| **地表随自转和近裁剪尚未解决** | `CameraController.ts:737` 后仍将 localSurfacePt 直接加 targetPosition，未对站点和法线应用同帧天体四元数；`:765` near 仍以场景单位且有固定下限 | 做正反姿态变换，统一米/公里/场景单位。物理米制路径下验证 1.7m 站高、约 0.1m near，不能只把旧断言改绿。 |
| **时间/参考系标签超出实现** | `BodyPoseProvider.ts:79,382,392,393`；解析 XZ 轨道、手工 spin offsets，却声明 ICRF/J2000、IAU_*；`getFixedToInertialQuaternion` 对 moon 分支统一锁定 | 按 Pro 规范接入可核验时间/姿态，或明确近似模型、真实采用的轴系与时间基。不能把常量和标签当数值星历；同一快照驱动渲染、光照、HUD。 |
| **全系统物理快照不等于全系统物理渲染** | `BodyPoseProvider.getPhysicalSystemSnapshot` 已新增；`getBodyPose` 仍只有 earth/moon 物理特判，其余返回导航半径和位置（约 `:514`） | 在 P1 明确并实现父子系统共同比例；验 Earth/Moon/Jupiter/Saturn 四组，不能只测数据对象字段齐全。 |
| **V3 书签仍有占位与恢复丢失** | `SolarEngine.ts:2203`：bodyFixedPosM 为 `[0,0,0]`、surfaceNormal 为 `[0,1,0]`，heightM 装的是 eyeHeight；`App.tsx:324` 恢复固定 eyeHeightM=1.7；未存回用户 yaw/pitch | 区分站点高程和眼高，保存实际位置、法线、朝向、资料版本与观察意图；跨时间/版本恢复需验证有效覆盖和净空。 |
| **书签语义和验证需收口** | `bookmark.ts:90` 混合大小写/两套 mode；`bookmarkStorage.ts:390` 只验部分 surfaceStation 字段；预置月球观察书签新增硬编码地面点 | 统一模式语义，不把旧轨道意图变成虚构地面点；验证向量维度/有限值、datum、body、模式与版本，补 V1/V2 迁移和 V3 往返测试。 |
| **旧 P0 报告不是强验收门禁** | `scripts/verify-p0-earth-visibility.ts:190` 起统计独立 rAF；`:222` 写死 PASSED，多个 pass/结论写死 true | 保留截图作历史材料，不能转述为当前 P1 的 GPU 性能或行为证明。P1 脚本从实测状态生成结果，失败必须非零退出，性能采主引擎真实渲染帧。 |

当前 P1 文件清单：

```text
修改 src/app/App.tsx
修改 src/app/BookmarkModal.tsx
修改 src/astronomy/BodyPoseProvider.ts
修改 src/astronomy/bodies.ts
修改 src/camera/CameraController.ts
修改 src/contracts/bookmark.ts
修改 src/engine/SolarEngine.ts
修改 src/utils/bookmarkStorage.ts
新增 src/contracts/physics.ts
新增 src/world-support/local-frame.ts
```

## 5. 本轮实际验证结果

沿用已有 Node/依赖；没有安装浏览器或其他软件。

- **通过**：100 项既有单测中的 98 项；16 个测试文件全通过。
- **失败**：2 个单测、2 个测试文件：`tests/bookmarks.test.ts:14` 仍只接受 schema 1/2；`tests/r5-lunar-landing.test.ts:159` 仍要求旧 near=1e-4。
- **失败**：TypeScript `--noEmit`，4 个 TS2393，位置见上表。
- **未执行**：本轮生产 Vite 打包、浏览器/WebGL 验收、截图目视、性能测量、P1 新测试（计划中的两个 P1 测试/验收文件当前不存在）。

本轮实际命令：

```powershell
& 'D:\Apps\NodeJS\current\node.exe' node_modules/typescript/bin/tsc --noEmit
& 'D:\Apps\NodeJS\current\node.exe' node_modules/vitest/vitest.mjs run
```

旧断言与新版本不匹配是一部分原因，但不能只改期望值宣称 P1 完成：需要补充迁移/恢复和正确单位的行为测试。P0 文档写的 100 PASS 与 236 FPS 均是历史叙述，不是本轮工作区结果。

## 6. 建议执行顺序与交付

1. **接管现场**：复核 status、HEAD 与本文件；保留 10 个 P1 文件。确认没有其他工具同时写代码。记录自己的起点；现有本地备份只作恢复依据，不自动覆盖现在的文件。
2. **恢复编译并定清契约**：合并重复模式方法；核对 Pro 的 P1 时间/坐标/书签要求，更新可执行计划到 `docs/plans/`。已批准的 P1 直接推进，计划中明显单位/路径错误据证修正，不反复要求相同批准。
3. **公共物理状态**：明确时间与模型质量、坐标框架、姿态轴映射、速度及三轴半径来源。保证位置、速度、姿态和 HUD/光照使用同一时刻；不以手工观赏偏移伪装物理姿态。
4. **米制空间真正接线**：保留单引擎、单 CameraController；先完成一个 Earth/Moon 地表样例的完整调用链和正反变换，再验其他父子系统。允许从同一机位派生渲染 pass，不另起一套交互相机或模拟时钟。
5. **V3 保存与恢复闭环**：补全实际站点、眼高、yaw/pitch、观察意图和来源版本，验证旧书签迁移不伪造信息；非法/过期地形明确拒绝或安全回退，禁止埋地后 clamp 掩盖。
6. **验证并交付 P1**：补物理状态/速度导数/姿态/误差预算/书签迁移和往返测试；运行 `npm test`、`npm run build`；在明确当前构建的本地页面，用现有 Edge/Chrome 做真实交互和 WebGL 验收。不要误测旧 dist 或线上版本。

验收至少覆盖：同一地理点在 0/6/12h 保持固定；1.7m 站高微移、near 与净空正确；四组父子物理比例；天王星姿态边界；书签存储→推进时间→恢复时站位/朝向/模式一致；用户拖动/取消/晚到加载不抢控制。记录真实 engine 帧、控制台错误与截图对应状态，阈值失败不得硬写 PASSED。

完成后写 `docs/pro-review-batch-p1-handoff.md`：最终 commit、实现范围、实际源码证据、通过/失败/未执行、当前限制及回退方法。检查 diff 与文件清单，只提交本批代码、测试和可公开文档。推送前再次核对远程；正常快进同步，禁止强推和历史改写。没有完成 P1 验收就不把它标成完成，也不扩展 P2–P4。

回退原则：保留 P0 `731ff09`；P1 提交后需要撤销时，按明确提交做 revert。当前未提交阶段需要撤某一项时，先保存接力后的新差异，再有选择地参考原文件备份；不要 reset --hard、git clean 或整目录覆盖。此交接不授权删除现有改动或自动回退。

## 7. 执行边界

继续使用中文。软件、依赖、缓存、临时文件优先 D 盘，复用现有工具。不要顺便升级 Three/Vite、重构 HUD、部署、改变仓库可见性或改写历史。真实数据、程序示意、近似轨道必须明确区分；P2 实际 DEM 尚未接入的事实不能被旧 R5 文案掩盖。

本轮交接新增文件不应混进应用修改。原始聊天、用户数据、会话库、备份和导出不可提交到公开仓库。
