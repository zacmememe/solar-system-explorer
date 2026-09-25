# F-SURFACE-CLARITY-01 调查报告：陶拉斯—利特罗单站清晰度与 LOD 接缝（第一批，只读；2026-09-25 已按 Codex 复核勘误修订）

> **勘误声明（2026-09-25）**：Codex 复核四张 diag 图后纠正本报告七处（详见文末勘误节）。关键更正：LOLA L1 实为 ~236.9m/px（抽稀后 ~474m），非 463/926；Taurus 窗外实际显示层含 WAC EMP 换装（未按机位核实前不能断言"NAC 直接接 2K 全球图"）；**撤回"无高墙/裂缝/拉撕"结论**——Codex 在 `seam-north-edge-from-outside.png` 观察到大面积竖向纹理拉伸、`ground-1m7-horizon.png` 右侧有突兀直立边缘，成因待查（已并入 F-LUNAR-LIMB-01 月球球缘缺陷项）。1600² 网格为 ~512 万三角形（原文 256 万有误）。原文探针的 enterSurfaceLook 机位属人工诊断机位（HUD 仍显示站点 1.7m），不能与正常 UI 证据混称。原截图保留不改。B 细化网格暂不立项。

任务/作者/目录/分支：F-SURFACE-CLARITY-01 / zcode sess_625dc0df / D:\solar-evidence\F-SURFACE-CLARITY-01\ / codex/restore-observation-experience
base/candidate：base=5cdd8f0e…；本次调查时 HEAD=d9e4492…（与参考候选一致，无漂移；origin/main 仍为 2a21586，未合并不重置）
本轮不改业务代码、不升级依赖、不下载资产；引擎访问仅只读诊断与 runner 同款 setSurfaceLook 环顾。

## 一页结论

**当前问题**：近地（眼高 ≲500m，尤其 1.7m 停驻）地表"糊"；DTM 窗缘（12km）外侧存在可辨接缝带——**其中包含待查的纹理拉伸/直立边缘**（并入 F-LUNAR-LIMB-01，本轮未定成因）。

**主要证据**（全部实测，源码位置见下节）：
1. **清晰度主因是源数据物理上限**：站区正射与 DEM 同为 **5 m/px**（`apollo17-v1/metadata.json` ortho.sameGridAsDem、nativeSpacingMeters=5，2400×2400）。眼高 1.7m、fov 45°、900px、俯角 30° 的单一几何下，一个 5m 纹素约占 **上千屏幕像素**（量级估计：5m×focal(1086px)/≈3.4m 视线落点距离；**仅适用该几何，不推广到任意视角**——精确数值已撤回，见勘误 5）。约 3km 眼高处 5m 纹素≈2px，与"下降到数公里以下开始糊"的观感分界一致。
2. **第二大限制是渲染网格几何抽稀**：`TerrainHeightProvider.buildDemWindowGeometry(satRadius)` 用默认 `maxSegments=400`（`SolarEngine.ts:380` 未传参），401×401 顶点/12km 窗 = **30m 顶点间距**（实测 dtmVertices=160801、320000 三角形）——地形起伏近观被平面化，且 Codex 的净空实测（1.7m 眼高→三角面 2.024m）正来自这个 30m 插值面。
3. **纹理侧配置合理，未发现过滤设置错误**（实测）：ortho DataTexture 2400×2400、minFilter=LinearMipmapLinear、magFilter=Linear、anisotropy=8、generateMipmaps=true（`RasterTerrainSource.ts:342-345`）；材质不透明 opacity=1。（anisotropy=8 是当前取值而非"最优"证明——设备上限与观感未测。）
4. **接缝带是 LOD 结构断崖 + 待查异常**：窗缘外侧经 `buildWindowRimSkirt`（rings=10、rim 0.15°≈4.5km、NAC↔LOLA 高程 smoothstep）过渡到 L1 层；L1 材质在 Taurus 的 WAC EMP 就绪且 gateOpen 时会换装 WAC（`SolarEngine.ts` lolaMaterials 换图路径）——**窗外实际显示层未按机位记录，本报告不断言具体纹理链**。Codex 已在窗缘截图观察到竖向纹理拉伸与直立边缘——**成因未定，不是"无裂缝"**。
5. **渲染管线现状**（Codex slab 重构后）：SURFACE_LOOK 下 4 段深度切片（far→near：21189 / 2.119 / 2.1e-4 / 2.1e-8 场景单位）。本候选**没有对应的遮挡验证证据**，不宣称已验证无遮挡异常。

**根因置信度**：清晰度=源分辨率上限（高，量级论证）；几何抽稀 30m 为次要可改善项（高）；接缝带具体成因（拉伸/直立边缘）=**未定**（已立 F-LUNAR-LIMB-01）。

**最小方案（Codex 复核后：B 暂不立项，先收口用户反馈的缺陷三项）**：
- A. 承认 5m 源上限并在停驻/近地观感上如实标注（fidelity 语义已有）——零代码。
- B.（**暂缓**）中心细化二级网格——1600² 全网格为 ~512 万三角形、半径 2km/5m 间距圆形细区内区已 ~50 万顶点，且非均匀网格影响 `surfaceGrid` 与 `ProceduralRockField.sampleRenderedTerrain`；且 B 不解决纹理模糊。待缺陷收口后再评估。
- C. 纹理侧超越 5m 源没有诚实路径（NAC 1-2m 正射存在于 LROC 档案但未打包；登记为独立数据任务，不在本轮）。
- 接缝：成因并入 F-LUNAR-LIMB-01 调查后按根因处理；过渡带打磨待定。

## 数据链真实参数（源影像→画面）

| 层 | 参数 | 源码/数据位置 |
| --- | --- | --- |
| NAC DTM/正射源 | 5 m/px，2400×2400，正射 u16 I/F 与 DEM 同网格 | `public/data/dem/apollo17-v1/metadata.json`（ortho.sameGridAsDem） |
| 纹理加载 | DataTexture 2400²，LinearMipmapLinear+Linear，anisotropy 8，mipmaps | `src/surface/RasterTerrainSource.ts:321-345` |
| 渲染网格 | maxSegments=400（默认，未传参）→401² 顶点=30m 间距；实测 160801 顶点/32 万三角形 | `src/engine/SolarEngine.ts:380` → `src/surface/TerrainHeightProvider.ts:242` |
| LOLA L1 中间层 | 128ppd≈**236.9m**/px（1737.4km 月球半径），decimate=2（**~474m** 顶点），实测 551988 顶点；rim 裙圈 4224 顶点 | `src/surface/LolaRegionalSource.ts` buildRegionalGeometry/buildWindowRimSkirt |
| WAC EMP 换装 | Taurus 专属：lolaMaterials 在 WAC 就绪且 gateOpen 时换图（99.75m/px 中景反照率）——实际显示层需按机位记录 | `SolarEngine.ts` lolaMaterials/WAC 门控路径 |
| 全球底图 | 2K 图（GSD≈5.3km/px） | `lroc_color_2k.jpg` |
| 渐显门控 | 地形块 8→36px smoothstep；WAC EMP 层 gate 实测 layerTexelPx=1.08e5 visible=true | `src/world-support/screenSpaceMetrics.ts` |
| 深度切片 | SURFACE_LOOK 4 段 slab（21189/2.119/2.1e-4/2.1e-8 场景单位） | Codex 5cdd8f0 重构，`lastFrameRenderInfo.depthRanges` 实测 |

## 玩家复现路径（全部正常 UI）

`npm run verify:foundations`（FOUNDATION_CASE=sites, SITE_IDS=taurus-littrow, TEST_URL=localhost:5199 dev）→ **PASS**（下拉选站→前往→着陆→停驻→环顾→书签→返轨，0 控制台错误）。针对性诊断 `scripts/probe-fsc01-taurus-clarity.ts`（正常 UI 入口+只读引擎读取）。视口 1440×900 headless Edge d3d11；模拟时间为引擎默认光照选时。

## 首批截图与用途（D:\solar-evidence\F-SURFACE-CLARITY-01\）

| 文件 | 用途 |
| --- | --- |
| `diag/ground-1m7-lookdown.png` | 【人工机位】1.7m 眼高俯视：5m 纹素的近观糊感（源上限取证） |
| `diag/ground-1m7-horizon.png` | 【人工机位】平视地平线：**Codex 复核发现右侧突兀直立边缘（成因待查，并入 F-LUNAR-LIMB-01）** |
| `diag/seam-north-edge-from-inside.png` | 【人工机位】窗缘内侧 400m 眼高南望：DTM→rim→L1 过渡带 |
| `diag/seam-north-edge-from-outside.png` | 【人工机位】缝外 900m 眼高北望：**Codex 复核发现大面积竖向纹理拉伸（成因待查，并入 F-LUNAR-LIMB-01）** |
| `runner/taurus-littrow-ground.png` 等 7 张 | 正常 UI 全流程产物（below-5000/below-50000/ground/left/right/bookmark/returned） |

注：diag 四张均为 enterSurfaceLook 人工诊断机位（HUD 站点眼高显示与实际机位不符），与 runner 正常 UI 证据分开；正常 UI 证据不能用直接改相机状态替代。动态问题未录像；`diag/` 另有探针 stdout 于会话记录。

## 检查记录（PASS/FAIL/NOT_RUN）

- PASS：`verify:foundations`（sites/taurus，报告 `runner/report.json`，0 错误）；诊断探针（0 pageerror）；纹理/网格参数实测。
- NOT_RUN：生产构建预览（本轮 dev server 取证，代码同源）；A/B 遮挡审计（本候选未改渲染路径，**无对应遮挡证据**）；其余五站（明确不扩）。
- NOT_OBSERVED：构图/观感可否接受——**Codex 已看四张 diag 图**（结论见勘误节），其余 runner 截图未逐张目检。探针 [2] 的 pxPer5m 原始输出有单位换算错误（场景单位当米），精确像素数值已撤回（量级估计保留并注明单一几何局限）。

## 勘误节（2026-09-25，按 Codex 复核修订）

1. LOLA L1 分辨率：月面 128ppd ≈ **236.9m**/px（1737.4km 半径），decimate=2 后 ≈**474m** 顶点——原文 463/926m 是火星 MOLA 值的误植。`SolarEngine.ts` 的 L1 渐显计算已用正确口径。
2. "NAC 直接接 2K 全球图"不成立：Taurus 的 lolaMaterials 在 WAC EMP 就绪且 gateOpen 时换图——窗外实际显示层须按机位记录（map/UV/色彩空间/渐显态），本报告未做，撤回该断言。
3. 撤回"无高墙/裂缝/拉撕"：Codex 在 `seam-north-edge-from-outside.png` 见大面积竖向纹理拉伸、`ground-1m7-horizon.png` 右侧见突兀直立边缘——只证明需要调查，不判定成因，也不证明正常 UI 必现。
4. diag 机位为 enterSurfaceLook 人工诊断（HUD 眼高与实际不符），不能称只读用户旅程；正常 UI 证据以 runner 截图为准。
5. 像素投影：旧探针把 5 场景单位当 5 米；解析的 ~1600px/纹素仅适用单一几何（俯角 30°/眼高 1.7m/fov45°/900px），不推广任意视角。如需保留量化须用实际可见地面交点、正确米制、两条地面切向轴与相机投影深度并做视锥内检查；本报告降级为量级估计。
6. anisotropy=8 是当前取值不构成"最优"证明；三点高程交叉差不证明整条接缝连续；本候选无遮挡验证证据，不宣称遮挡无异常。
7. 1600² 网格 ≈**512 万**三角形（原文 256 万有误）；半径 2km、5m 间距圆形细网格仅内区 ≈50 万顶点，且非均匀网格影响 `surfaceGrid` 与 `ProceduralRockField.sampleRenderedTerrain`。**B 暂不立项**（不解决纹理模糊，先收口用户反馈缺陷）。

## 回退与后续

原调查轮零代码改动（探针为新增只读文件）；本轮修订仅更新本文档与探针（提交见交接）。后续：F-LUNAR-LIMB-01 承接窗缘拉伸/直立边缘与球缘凹陷调查；B 方案待缺陷收口后再评估。
