# 重置后从这里接手

用户已明确让 Codex 暂时承担主力开发，zcode 本轮已停止。不必重新询问是否可接手；先核对唯一动态队列中的活跃作者，避免与后来的会话撞写。

工作目录 `D:\Game Zac\Personal Projects\太阳系漫游`；分支 `codex/restore-observation-experience`。日常唯一启动入口为根目录 `启动太阳系漫游.bat`，每次构建当前本地源码成功后才打开页面。

最小阅读顺序：

1. `AGENTS.md` 和 `review-exports/coordination/queue.md`：后者是本机唯一动态状态，不复制新看板。
2. [最新火星与天体真实感报告](surface-atmosphere-realism-report.md)：火星大气/地面/夜间遮光、3张新观测卫星图和30体后续清单。导航上下文见 [导航与视觉报告](navigation-experience-report.md)：跨星避障、相机连续性、卫星母星构图、土星环影。地形上下文保留于 [月面连续性报告](lunar-boundary-continuity-report.md)，更早系统修复见 [系统报告](codex-system-polish-report.md)。
3. [体验基础契约](experience-foundations.md)：物理空间/相机/时间/存档约束与真实 UI 验证方法。

最新产品候选为 `1353cf5f3cfc616872f11b991daa204734491f59`（base `069526e4034a7fbac656aad660aa801642f58ae6`）。生产包 `index-0Mgg-RVp.js`；SHA-256、验证边界与后续任务见最新报告。前轮月面产品提交 `741637b` 已包含在历史中。如 HEAD 之后只有证据与文档提交，不要误称产品漂移；如 src、资产、配置变动，则按新候选重验。核对 `git status`，其他作者原有未跟踪文件不能删除或一并提交。

关键纠错：旧报告的“地表秒级卡顿”和“5.5ms/帧”已撤回。前者来自探针未定义变量导致采样 Promise 悬挂，后者把 render pass 数当作显示帧数。性能使用 `scripts/lib/browser-performance.ts` 的有界 RAF 采样，并同时看引擎帧数；所有性能测量只跑一个浏览器负载。

已修复静海外过渡圈贴理想球而非实际网格造成的几何错接，以及 GPU 世界坐标相减产生的贴地假明暗块。后者在 ground-isolation 的同机位实验中，仅改变视线算法就消失，不能继续按“纹理本身坏了”处理。这个浮点缺陷与具体世界坐标有关：final-shader-ab 的稍晚模拟时刻回切旧算法未呈现同样明显的断裂，不把它写成反向复现成功。双精度法线也已修复，但单独改法线并未消除该明暗块，报告有明确区分。

最新优先事项是复玩火星三站的下降/环顾/昼夜，再按报告清单替换火卫一、土卫七的明显程序形状，以及天卫五/天卫一/其余伽利略卫星的程序图；先做资产/许可/坐标与缺测调查，不扩张站点。木卫一、土卫一、土卫二已接官方图，勿重复替换或把增强色称作自然色。月面剩余问题继续区分实际网格抽稀折面、NAC↔全球图的低频色调差与 2–5m 影像上限。每条边先明确双方的网格/材质和实际机位，勿重复换材质或泛调透明度。严禁移动天体、抬高真实地形、关深度掩盖问题。新过渡圈只用于静海，Taurus WAC 仍有 offset/repeat 语义，不能未经核对批量套用。

土星输出链/环影抗锯齿与巨行星球缘已在导航候选修复，接受范围见新报告。竖屏母星构图已调整；真实手机 GPU/触屏仍未验证。真实影像分辨率 2–5m 的上限要保留；网格细化不能被描述为影像升级。不要扩到更多站点或天体。

复现验证：先 `npm run build`，用本机已有 Edge 和本地 preview。`TEST_URL` 指向实际端口；`EVIDENCE_DIR` 指向 `D:\solar-evidence\<任务>`。

- `npm test`：完整单元/契约门禁。
- `npm run verify:realism`：默认耶泽罗下降/悬停/环顾/仰望/返轨；`SITE_IDS`选站，`SKY_CYCLE=1`加耶泽罗昼夜与大气开关，`REALISM_CASE=bodies`改查32体。验证期间不得重建dist。
- `npm run verify:navigation`：普通 UI 32 条路径；`NAV_CASE=visual` 可单查土星多角度和竖屏。只读几何通过不替代看图。
- `npm run verify:foundations`：六站完整旅程、控制、书签、载具、故障退出；约十余分钟，不要在等待中重复起浏览器。
- `VERIFY_SURFACES=0` 后 `npm run verify:observation`：已做六站流程时单独查观星；报告应注明缩小范围。
- `SLOW_TEXTURE=1`、可选 `VERIFY_VEHICLE=1` 后 `node --import tsx scripts/verify-system-polish.mjs`：静海正常 UI、稳定 HOLD、地表/返轨帧率、材质加载顺序、手机折叠详情。

这是本轮接手索引，不替代队列。作者自验、独立批准与用户体验接受分别记录；允许推任务分支，不自动合 main 或部署。回退应 revert 对应产品提交，勿改写历史。
