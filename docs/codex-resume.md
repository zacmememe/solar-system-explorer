# 重置后从这里接手

用户已明确让 Codex 暂时承担主力开发，zcode 本轮已停止。不必重新询问是否可接手；先核对唯一动态队列中的活跃作者，避免与后来的会话撞写。

工作目录 `D:\Game Zac\Personal Projects\太阳系漫游`；分支 `codex/restore-observation-experience`。日常唯一启动入口为根目录 `启动太阳系漫游.bat`，每次构建当前本地源码成功后才打开页面。

最小阅读顺序：

1. `AGENTS.md` 和 `review-exports/coordination/queue.md`：后者是本机唯一动态状态，不复制新看板。
2. [本轮报告](codex-system-polish-report.md)：base、产品候选、实际测试、误判勘误与遗留问题。
3. [体验基础契约](experience-foundations.md)：物理空间/相机/时间/存档约束与真实 UI 验证方法。

本轮产品候选为 `f6ade0df25a8fcef94db9da9b2a1941df23c0bd9`（base `adae9e9f8c4212838454833057dd7d8ff830dd40`）。如 HEAD 之后只有证据与文档提交，不要误称产品漂移；如 src、资产、配置变动，则按新候选重验。核对 `git status`，其他作者原有未跟踪文件不能删除或一并提交。

关键纠错：旧报告的“地表秒级卡顿”和“5.5ms/帧”已撤回。前者来自探针未定义变量导致采样 Promise 悬挂，后者把 render pass 数当作显示帧数。性能使用 `scripts/lib/browser-performance.ts` 的有界 RAF 采样，并同时看引擎帧数；所有性能测量只跑一个浏览器负载。

下一步最值得投入的是**静海剩余直边及网格折面**。先复核本轮代表图，再正常 UI 进入静海，在 HOLD 稳定机位记录相机/时间/高度，明确边界双方是全球球、L1、裙边还是 NAC 窗。当前已统一静海着色并做地理固定混合，不能再重复做同一轮“换材质”。需要继续检查法线/几何连续性和源影像低频色调；严禁移动天体、抬高真实地形、关深度掩盖问题。Taurus WAC 贴图有 offset/repeat 语义，不能不核对就批量套用静海 shader。

土星阴影锯齿、真实手机横屏/触屏仍未完成。真实影像分辨率 2–5m 的上限要保留；网格细化不能被描述为影像升级。不要扩到更多站点或天体。

复现验证：先 `npm run build`，用本机已有 Edge 和本地 preview。`TEST_URL` 指向实际端口；`EVIDENCE_DIR` 指向 `D:\solar-evidence\<任务>`。

- `npm test`：完整单元/契约门禁。
- `npm run verify:foundations`：六站完整旅程、控制、书签、载具、故障退出；约十余分钟，不要在等待中重复起浏览器。
- `VERIFY_SURFACES=0` 后 `npm run verify:observation`：已做六站流程时单独查观星；报告应注明缩小范围。
- `SLOW_TEXTURE=1`、可选 `VERIFY_VEHICLE=1` 后 `node --import tsx scripts/verify-system-polish.mjs`：静海正常 UI、稳定 HOLD、地表/返轨帧率、材质加载顺序、手机折叠详情。

这是本轮接手索引，不替代队列。作者自验、独立批准与用户体验接受分别记录；允许推任务分支，不自动合 main 或部署。回退应 revert 对应产品提交，勿改写历史。
