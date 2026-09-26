# 重置后从这里接手

用户已明确让 Codex 暂时承担主力开发，zcode 本轮已停止。不必重新询问是否可接手；先核对唯一动态队列中的活跃作者，避免与后来的会话撞写。

工作目录 `D:\Game Zac\Personal Projects\太阳系漫游`；分支 `codex/restore-observation-experience`。日常唯一启动入口为根目录 `启动太阳系漫游.bat`，每次构建当前本地源码成功后才打开页面。

最小阅读顺序：

1. `AGENTS.md` 和 `review-exports/coordination/queue.md`：后者是本机唯一动态状态，不复制新看板。
2. [最新远景、石块与土卫三报告](mars-materials-body-assets-report.md)：产品03b6220、343测试、49图证据与剩余粗糙处；再读 [极简HUD与盖尔报告](minimal-hud-gale-report.md)：大屏98px薄条、完整信息进菜单，盖尔512m核心恢复2m源网格及独立净空。此前 [阶段HUD报告](phase-aware-hud-report.md)保留相机/书签/遥测语义；[盖尔旧方案](plans/gale-display-ground-refinement.md)为实施前诊断。前轮 [火星与天体真实感报告](surface-atmosphere-realism-report.md)包含火星大气/地面/夜间遮光、3张新观测卫星图和30体后续清单。导航上下文见 [导航与视觉报告](navigation-experience-report.md)：跨星避障、相机连续性、卫星母星构图、土星环影。地形上下文保留于 [月面连续性报告](lunar-boundary-continuity-report.md)，更早系统修复见 [系统报告](codex-system-polish-report.md)。
3. [体验基础契约](experience-foundations.md)：物理空间/相机/时间/存档约束与真实 UI 验证方法。

最新产品候选为 `03b6220f2161301c9207f9a110a5b1c38ba5fd54`（base b22c76b），生产包 `index-DFTktD8V.js` / CSS `index-CH4BTTPh.css`。53文件343测试通过；冻结包盖尔同机位诊断、耶泽罗昼夜与静海旅程、土卫三贴图及503回退共49张主要证据。精确哈希、作者已看图范围和未验项目见最新报告。后续仅文档/验证脚本提交不构成产品漂移；src、资产或配置变化要绑定新候选。所有既有HUD、地形、导航修复仍在历史中。核对git status，其他作者原有未跟踪文件不能删除或一并提交。

关键纠错：旧报告的“地表秒级卡顿”和“5.5ms/帧”已撤回。前者来自探针未定义变量导致采样 Promise 悬挂，后者把 render pass 数当作显示帧数。性能使用 `scripts/lib/browser-performance.ts` 的有界 RAF 采样，并同时看引擎帧数；所有性能测量只跑一个浏览器负载。

已修复静海外过渡圈贴理想球而非实际网格造成的几何错接，以及 GPU 世界坐标相减产生的贴地假明暗块。后者在 ground-isolation 的同机位实验中，仅改变视线算法就消失，不能继续按“纹理本身坏了”处理。这个浮点缺陷与具体世界坐标有关：final-shader-ab 的稍晚模拟时刻回切旧算法未呈现同样明显的断裂，不把它写成反向复现成功。双精度法线也已修复，但单独改法线并未消除该明暗块，报告有明确区分。

盖尔单站512m核心已实现，浏览器落点净空约1.22→1.71m；不要再领取为“尚未实施”。源DEM/相机/书签保持原语义，石块使用实际显示网格；HUD眼高与任意地点的可见网格净空仍不自动等价。本轮远景材质低通与局部原点石块已实现；下一步处理远坡几何层次、近地折面、接地感和更好的区域影像，不重复修已证实的Float32实例问题，不批量加密其他五站。天体素材接力先读 [火卫一成套模型调查](plans/phobos-observed-shape.md)：已核对形状/坐标/首面反照率，许可与全CSV仍待确认，未入库。其余按前轮清单推进天卫五/天卫一/伽利略卫星的程序图；不扩张站点。木卫一、土卫一、土卫二、土卫三已接官方图，勿重复替换或把增强色称作自然色。月面剩余问题继续区分抽稀折面、NAC↔全球图色调差与2–5m影像上限。每条边先明确双方网格/材质和实际机位；严禁移动天体、抬高地形、关深度掩盖问题。新过渡圈只用于静海，Taurus WAC仍有offset/repeat语义，不能直接批量套用。

土星输出链/环影抗锯齿与巨行星球缘已在导航候选修复，接受范围见新报告。竖屏母星构图已调整；真实手机 GPU/触屏仍未验证。真实影像分辨率 2–5m 的上限要保留；网格细化不能被描述为影像升级。不要扩到更多站点或天体。

复现验证：先 `npm run build`，用本机已有 Edge 和本地 preview。`TEST_URL` 指向实际端口；`EVIDENCE_DIR` 指向 `D:\solar-evidence\<任务>`。

- `npm test`：完整单元/契约门禁。
- `node scripts/verify-mars-materials.mjs`：盖尔正常UI及明确标记诊断对照；COMPARE_LEGACY=1开启同机位旧材质/旧石块坐标对照，ISOLATE=0关闭逐层隔离。返轨必须等相机停稳。
- `node scripts/verify-tethys-asset.mjs`：土卫三观测贴图、母星背景、拖动、快速切换与503故障回退。
- `npm run verify:hud`：默认耶泽罗；`SITE_ID=tranquility-base`改查静海，包含全景书签、取消、大屏占高、横竖屏菜单、收起/恢复焦点、菜单跨阶段关闭、实际视向和返回。`06-preparing`可能在截图时已进入下降，不能按文件名虚构准备期视觉验收。
- `node --import tsx scripts/verify-gale-refinement.mjs`：正常UI到达实际低空HOLD/触地/环顾，随后明确标记的同机位粗细几何A/B与层隔离；不把这些诊断替代正常UI回归。
- `npm run verify:realism`：默认耶泽罗下降/悬停/环顾/仰望/返轨；`SITE_IDS`选站，`SKY_CYCLE=1`加耶泽罗昼夜与大气开关，`REALISM_CASE=bodies`改查32体。验证期间不得重建dist。
- `npm run verify:navigation`：普通 UI 32 条路径；`NAV_CASE=visual` 可单查土星多角度和竖屏。只读几何通过不替代看图。
- `npm run verify:foundations`：六站完整旅程、控制、书签、载具、故障退出；约十余分钟，不要在等待中重复起浏览器。
- `VERIFY_SURFACES=0` 后 `npm run verify:observation`：已做六站流程时单独查观星；报告应注明缩小范围。
- `SLOW_TEXTURE=1`、可选 `VERIFY_VEHICLE=1` 后 `node --import tsx scripts/verify-system-polish.mjs`：静海正常 UI、稳定 HOLD、地表/返轨帧率、材质加载顺序、手机折叠详情。

这是本轮接手索引，不替代队列。作者自验、独立批准与用户体验接受分别记录；允许推任务分支，不自动合 main 或部署。回退应 revert 对应产品提交，勿改写历史。
