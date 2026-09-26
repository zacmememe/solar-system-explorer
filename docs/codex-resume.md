# 重置后从这里接手

用户已明确让 Codex 暂时承担主力开发，zcode 本轮已停止。不必重新询问是否可接手；先核对唯一动态队列中的活跃作者，避免与后来的会话撞写。

工作目录 `D:\Game Zac\Personal Projects\太阳系漫游`；分支 `codex/restore-observation-experience`。日常唯一启动入口为根目录 `启动太阳系漫游.bat`，每次构建当前本地源码成功后才打开页面。

最新待用户选择：F-HUD-VISUAL-OPTIONS-03 已交付三方向独立样张，见[HUD视觉方向比较](hud-visual-directions.md)与`D:\solar-evidence\hud-directions\HUD方案对比.html`。A任务弧/B轨道透镜/C地平线罗盘，每套观星/下降/地面三状态；当前产品HUD未替换。先等用户选型，不自行把原型接入引擎。原型微图与数值为示例，接入须消费实际HudFrame。取景另见耶泽罗地平线细长断片，记录在报告，后续先复现，不把设计稿当修复证据。

最小阅读顺序：

1. `AGENTS.md` 和 `review-exports/coordination/queue.md`：后者是本机唯一动态状态，不复制新看板。
2. [最新下降返回与换落区报告](landing-continuity-report.md)：产品aa8d9d4、361测试、25张最终图；实际机位升空、结束不跳位、球外绕行、显式白昼选择与取消/倍速优先。再读 [远景、石块与土卫三报告](mars-materials-body-assets-report.md)：产品03b6220、343测试、49图证据与剩余粗糙处；[极简HUD与盖尔报告](minimal-hud-gale-report.md)：大屏98px薄条、完整信息进菜单，盖尔512m核心恢复2m源网格及独立净空。此前 [阶段HUD报告](phase-aware-hud-report.md)保留相机/书签/遥测语义；[盖尔旧方案](plans/gale-display-ground-refinement.md)为实施前诊断。前轮 [火星与天体真实感报告](surface-atmosphere-realism-report.md)包含火星大气/地面/夜间遮光、3张新观测卫星图和30体后续清单。导航上下文见 [导航与视觉报告](navigation-experience-report.md)：跨星避障、相机连续性、卫星母星构图、土星环影。地形上下文保留于 [月面连续性报告](lunar-boundary-continuity-report.md)，更早系统修复见 [系统报告](codex-system-polish-report.md)。
3. [体验基础契约](experience-foundations.md)：物理空间/相机/时间/存档约束与真实 UI 验证方法。

最新产品候选为 `aa8d9d4a2a3c7cc66a5b7dc2d58f7c7de5b08881`（base e38620d），生产包 `index-VtXa3VT5.js` / CSS `index-CH4BTTPh.css`。54文件361测试通过；冻结包月/火高空中止、低空悬停/触地返航、转头接管、落区绕行/取消以及白昼时间菜单与手动改速，共25张最终截图、两份0错误报告。精确哈希、作者已看图范围和未验项目见最新报告。后续仅文档/验证脚本提交不构成产品漂移；src、资产或配置变化要绑定新候选。所有既有HUD、地形、导航修复仍在历史中。核对git status，其他作者原有未跟踪文件不能删除或一并提交。

返航不再固定到50km，也不在结束时另起默认整球flyTo：从实际机位单调升空，终端轨迹保留到相机接手。用户在途中转头后，自由观察near必须受真实球面净空约束，不能只看自由支点距离；旧版曾切掉半块月球，反例保留在candidate/14。降落准备不再隐式选未来白昼；需要亮面时使用底部“··· → 时间倍率 → 切换到所选落区的白昼”。同天体换落区复用球外短弧，准备/绕行取消清理临时倍速，用户手动改速优先。盖尔高空区域影像矩形界线和低空远坡仍待改善，不把镜头连续性通过写成地形真实感通过。

关键纠错：旧报告的“地表秒级卡顿”和“5.5ms/帧”已撤回。前者来自探针未定义变量导致采样 Promise 悬挂，后者把 render pass 数当作显示帧数。性能使用 `scripts/lib/browser-performance.ts` 的有界 RAF 采样，并同时看引擎帧数；所有性能测量只跑一个浏览器负载。

已修复静海外过渡圈贴理想球而非实际网格造成的几何错接，以及 GPU 世界坐标相减产生的贴地假明暗块。后者在 ground-isolation 的同机位实验中，仅改变视线算法就消失，不能继续按“纹理本身坏了”处理。这个浮点缺陷与具体世界坐标有关：final-shader-ab 的稍晚模拟时刻回切旧算法未呈现同样明显的断裂，不把它写成反向复现成功。双精度法线也已修复，但单独改法线并未消除该明暗块，报告有明确区分。

盖尔单站512m核心已实现，浏览器落点净空约1.22→1.71m；不要再领取为“尚未实施”。源DEM/相机/书签保持原语义，石块使用实际显示网格；HUD眼高与任意地点的可见网格净空仍不自动等价。本轮远景材质低通与局部原点石块已实现；下一步处理远坡几何层次、近地折面、接地感和更好的区域影像，不重复修已证实的Float32实例问题，不批量加密其他五站。天体素材接力先读 [火卫一成套模型调查](plans/phobos-observed-shape.md)：已核对形状/坐标/首面反照率，许可与全CSV仍待确认，未入库。其余按前轮清单推进天卫五/天卫一/伽利略卫星的程序图；不扩张站点。木卫一、土卫一、土卫二、土卫三已接官方图，勿重复替换或把增强色称作自然色。月面剩余问题继续区分抽稀折面、NAC↔全球图色调差与2–5m影像上限。每条边先明确双方网格/材质和实际机位；严禁移动天体、抬高地形、关深度掩盖问题。新过渡圈只用于静海，Taurus WAC仍有offset/repeat语义，不能直接批量套用。

土星输出链/环影抗锯齿与巨行星球缘已在导航候选修复，接受范围见新报告。竖屏母星构图已调整；真实手机 GPU/触屏仍未验证。真实影像分辨率 2–5m 的上限要保留；网格细化不能被描述为影像升级。不要扩到更多站点或天体。

复现验证：先 `npm run build`，用本机已有 Edge 和本地 preview。`TEST_URL` 指向实际端口；`EVIDENCE_DIR` 指向 `D:\solar-evidence\<任务>`。

- `npm test`：完整单元/契约门禁。
- `CHECK_FIXED=1 node scripts/verify-landing-continuity.mjs`：月/火实际UI高低空返航、静海触地转头、换落区/取消与末端逐帧接续。Windows用`$env:CHECK_FIXED='1'`。
- `DAYLIGHT_ACTION=1 node scripts/verify-landing-continuity-controls.mjs`：先以正常时间菜单选白昼，再查盖尔低空返航、取消与手动改速。与上一浏览器串行运行，不在取证期间重建dist；本轮端口5207、证据landing-continuity/final与final-daylight-controls。
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
