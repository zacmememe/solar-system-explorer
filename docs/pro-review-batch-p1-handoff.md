# P1「公共物理与米制空间内核」执行交接（zcode，2026-09-23）

基线：本地 main `731ff09`（P0）。计划：`docs/plans/2026-09-23-p1-physics-metric-core.md`（用户已批准）。
本批次由 zcode 接替额度耗尽的 Antigravity 完成 T1–T7 全部任务，过程中额外修复两个阻塞真实画面验收的渲染缺陷（见 §3）。

## 1. 提交

- Commit：见 `git log -1`（本文件随同一提交入库；commit message 前缀 `feat(...)`，尾标 `(P1)`）。
- 范围：下述源码/测试/脚本/文档/验收工件；不含依赖、构建产物（dist）、浏览器配置、备份与导出材料。

## 2. 变更范围与源码证据

| 文件 | 任务 | 内容 |
|---|---|---|
| `src/engine/SolarEngine.ts` | T1/T6a | 删除重复 `setObservationMode/getObservationMode`；新增 `syncEarthCloudVisibility()` 统一云层一致性；谷地材质 `DoubleSide→FrontSide`；潮汐锁定相位 π 勘误（§3.2） |
| `src/astronomy/BodyPoseProvider.ts` | T2 | `tdbSecondsFromJ2000 = utcSeconds + 69.184`（注释写明闰秒/TT≈TDB 假设）；`positionFrameId: ECLIPTIC-ANALYTIC-APPROX`、`cartographicFrameId: BODY-FIXED-RENDER-X0-YN-Z90E`、`quality: analytic-approximation`；`setPhysicalReferenceBody` 泛化参考系统（Earth/Moon、Jupiter/Io、Saturn/Titan） |
| `src/camera/CameraController.ts` | T3 | SURFACE_LOOK 用天体四元数把 body-local 站点与 (u,e,n) 基变换到世界系（站点随自转）；`local-frame.ts geodeticToBodyFixedM` 真实接入；near = 0.1m × metricScale（移除 1e-4 下限）；暴露 `getSurfaceStationPose()` |
| `src/contracts/bookmark.ts`、`src/utils/bookmarkStorage.ts`、`src/app/App.tsx` | T4 | V3 书签真实闭环：`eyeHeightM`/`orientationDeg` 契约；校验补全（向量有限/datum 合法/|lat|≤90/eyeHeightM>0）；V1/V2→V3 迁移不伪造站点；预置书签去污染；恢复用保存的朝向 + 非法回退球坐标恢复 |
| `src/surface/TerrainHeightProvider.ts` | T6a | 谷地高度场网格绕序翻转（外向法线，§3.1） |
| `tests/bookmarks.test.ts`、`tests/r5-lunar-landing.test.ts` | T5 | 接受 schema 1/2/3；near 断言改 0.1m 米制等效；补"站点随四元数旋转"断言 |
| `tests/p1-physics-metric-core.test.ts` | T5 | 新增：快照完整性/物理比例角直径/天王星极轴/坐标往返/0-24h 站点变换/书签迁移与拒绝 |
| `scripts/verify-p1-physics-core.ts` | T6 | 实机验收脚本（9 项检查，见 §4） |
| `docs/plans/2026-09-23-p1-physics-metric-core.md` | — | 批次计划（含与 Anti 计划的 7 处勘误） |
| `artifacts/pro-review/70/71/72-*.png`、`batch-p1-physics-core-report.json`、`diag-p1-black.png`、`diag-p1-sunlit.png`、`diag-p1-canvas-check.png`、`diag-p1-earth-crop.png` | T6 | 验收截图、报告与调查证据 |

## 3. 过程中修复的两个渲染缺陷（黑屏调查结论）

### 3.1 谷地网格绕序（法线全部内向）
- 现象：SURFACE_LOOK 下帧缓冲纯黑（8 次绘制调用全部发出、DOM 无遮挡、near≥1e-6 全亮、独立 canvas 最小复现正常）。
- 根因：`TerrainHeightProvider` 三角形顶点顺序使 `computeVertexNormals` 生成的法线指向天体中心；配合旧 `DoubleSide` 面仍可见但 Lambert 光照恒 0（这正是 R5 截图 62"均匀暗灰无细节"的成因之一）。
- 修复：绕序改为 `(a,d,b)/(b,d,c)`（lat 增 × lon 增 叉积指向球面外侧），材质改 `FrontSide`。

### 3.2 潮汐锁定相位 180° 勘误（仅月球）
- 现象：相机矩阵实测（引擎自身放置链，pitch=0 水平帧）站点地球仰角 −54.8°，而近侧 Taurus-Littrow 解析真值 +53.7°，恰 180° 镜像；R5 时期 HUD 标注"+53.7° 仰角"与渲染实际（地平线下）自相矛盾——R5 截图 62 "HUD 说地球在上、画面却无地球"由此而来。
- 定量证据：由 0–656h 采样反解，子地球点位于 body lon ≈183.4°（约定应为 0°）；渲染经度方向与声明的 `+X=0°经、−Z=90°E` 约定吻合（站点 body 方位 −30.78° 实测验证）。
- 附带发现（结构性，非本批次修改）：物理观察模式下月球显示轨道半径 = 地球示意显示半径 × (384400/6371) ≈ 81.5，大于日地显示距离 ≈32；太阳方向从月球看以轨道速率共旋。修正前站点在所有时刻处于永夜侧（实测整月太阳高度角 ∈ [−67°,−36°]，无任何时刻过零）；修正后近侧站点恒在日照侧（实测 t=0 时 +48.6°）。
- 修复：`SolarEngine.updateEphemerisPoses` 中 `mesh.rotation.y = -moonOrbitAngle + (id==='moon' ? Math.PI : 0) + spinOffset`。`PLANET_SPIN_OFFSETS.moon = 0` 的注释意图（"正面正对进场黄金视角"）由此才真正成立。
- 影响面：单测 111/111 无回归；实机验收 9/9；截图 71/72 中地球圆盘首次真实出现在月面上空瞄准点（裁剪放大目检：青蓝色圆盘带云层亮斑，直径 ~60px @1440×900）。

### 3.3 调查方法备注（供后续批次复用）
- 同任务内 `renderer.render + gl.readPixels` 是可靠帧缓冲真值采样；跨帧直接 readPixels 会读到呈现后失效缓冲（全 0），不能作为"引擎帧"证据。
- tsx/esbuild 会向 `page.evaluate` 注入 `__name`，探针须用纯 JS 字符串 IIFE。
- `setSimTimeHours` 后位姿下一 rAF 帧才更新，同步循环扫描会读到陈旧姿态，必须带帧等待。
- 图像模型对整页截图的描述可能误判（本批次曾把 90% 亮的地形截图描述为"纯黑"）；像素统计（视口分区采样）是更可靠的底稿，目检用于内容语义确认。

## 4. 验收结果

### 实机端到端（`scripts/verify-p1-physics-core.ts`，本地 preview + Edge headless，9/9 通过，0 控制台错误）
| 检查 | 结果 | 关键数据 |
|---|---|---|
| P1-WEB-01 物理快照全量有效 | ✅ | 32 天体全有限值、frameId/quality 诚实标识、近似 TDB 偏差 <1e-6 |
| P1-WEB-02 站点描述符真实 | ✅ | heightM −2246（谷底）、datum MOON_PA453、bodyFixedPosM 非零 |
| P1-WEB-03 near = 0.1m 米制等效 | ✅ | 2.119e-8 = 0.1 × 2.119e-7 |
| P1-WEB-03b 画面非黑（防回归） | ✅ | readPixels 采样 246/336 = 73.2%，maxLum 157 |
| P1-WEB-04 站点随自转 | ✅ | 6h 世界机位移动 4.45、local 方向差 <1e-14、AGL 恒 1.7m |
| P1-WEB-05 V3 书签结构 | ✅ | 产品校验函数通过、schemaVersion=3、字段齐全 |
| P1-WEB-06 推进 12h 恢复书签 | ✅ | 站点/眼高/朝向一致、AGL 1.700m 未埋地 |
| P1-WEB-07 观察模式合并行为 | ✅ | terrain 隐云、physical 恢复、用户手动关云保留 |
| P1-WEB-08 主引擎帧率 | ✅ | 206 fps（渲染循环计数，5s 实测） |

### 画面目检（用户要求"必须目检画面"）
- `70-p1-moon-surface-look-t0.png`：视口分区像素统计 90% 非黑（308/341，maxLum 157）；同状态目检（diag-p1-canvas-check.png）确认灰色月面地形、山体轮廓与坡面明暗、黑色星空、HUD 完整。截图 70 本体的一次图像模型描述为"纯黑"系误判，以像素统计为准（§3.3）。
- `71/72-*.png`：lookAtSkyTarget 后天空为主；画面正中央 (710,462) 青白色亮斑 RGB(205,255,255)，裁剪放大目检为蓝色地球圆盘（云层亮斑、冰盖高光），正对瞄准点。
- `diag-p1-sunlit.png`：日照时刻地形全景（诊断期证据）。

### 单元测试与构建
- 单测：111/111 通过（19 个测试文件）。
- 构建：`npm run build` 通过（诊断脚本已全部删除后复验）。
- 未执行：无（本批次计划内项目全部执行）。

## 5. 已知问题与限制（移交后续批次）
1. **其余卫星潮汐锁定相位**：io/europa/ganymede/callisto/titan 等仍用旧相位（子母星点在 lon 180），其 `PLANET_SPIN_OFFSETS` 观赏偏置按旧相位整体调定；若统一翻转需逐个重调观赏构图（建议 P2+ 处理）。
2. **物理观察模式显示比例下的光照几何**：月球显示轨道半径（81.5）大于日地显示距离（32）非物理比例；近侧站点因此恒处于日照侧、无月夜循环。属显示比例折衷，待比例体系重构时一并处理。
3. 月面高度场为解析高斯示意（非真实 DTM 数据），已在代码注释与 README 口径中如实标注。
4. `preserveDrawingBuffer` 下跨帧 readPixels 读失效缓冲（§3.3），验收脚本已用同任务渲染采样规避。

## 6. 执行顺序与回退
- 执行顺序：T1 合并 → T2 姿态/标识 → T3 相机接线 → T4 书签 → T5 测试 → 构建 → 实机验收 → 黑屏调查（§3）→ 复验 9/9 → 单测复验 → 交接文档 → 提交。
- 回退：本批次为单一提交，`git revert <commit>` 可整体回退；两处渲染修复（绕序、π 相位）相互独立，若仅需回退 π 相位，撤销 `SolarEngine.updateEphemerisPoses` 中 `lockPhase` 相关 6 行即可（后果：月面近侧站点回到永夜、地球回到地平线下，HUD 地球仰角标注与画面重新矛盾）。
