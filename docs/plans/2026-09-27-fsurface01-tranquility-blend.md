# F-SURFACE-BLEND-01：静海基地高清区边缘自然过渡（原型报告）

- 分支：`codex/restore-observation-experience`；base `8deebfc`，本轮含 P1（`7361736`）与 toast 修复（`69d3e30`）。
- 范围：仅静海基地（`tranquility-base`）站点栈材质；Taurus-Littrow / Hadley-Rille 与全部火星站点未动。
- 证据目录：`D:\solar-evidence\fsurface-blend\`（`before\`＝8deebfc 隔离 worktree 构建 4174；`after\`＝本轮构建 4173；`diagnosis\`＝诊断；`touch-probe\`＝触地判别实验）。

## 1. 诊断（review 步骤 1：先识别边界双方）

探针 `scripts/diag-blend-v4.ts`（真实降落序列，引擎导引机位，不做人工摆位）：

295km AGL 11×11 栅格射线命中分布（`diagnosis/raycast-v4.json`）：

| 区域 | 命中 mesh | 材质 | 纹理 |
| --- | --- | --- | --- |
| 矩形外 | `(moon body)`（外球） | ShaderMaterial（MoonMaterial 着色） | 全球 2K |
| 矩形内主面 | `tranquility-base-hole-patch`（近全透明）+ `lola-l1-regional-terrain` | ShaderMaterial（克隆本体）/ **MeshStandardMaterial** | 全球 2K / 全球 2K |
| 矩形边带 | `lola-l1-boundary-skirt` | **MeshStandardMaterial** | 全球 2K |

结论：**矩形明暗带的责任面 = 外球（MoonMaterial 自定义月面着色）与 L1/裙边（MeshStandardMaterial PBR+场景灯）两套光照口径失配**。同贴一张全球 2K 图，但 Lommel-Seeliger vs PBR roughness+环境光的亮度/色温显著不同。静海 L1 没有独立高清贴图（UV=全球等距柱状），"矩形内更清晰"来自 LOLA 真实几何起伏。斜视角下 skirt 上缘的亮白线与 PBR 高光相关，统一着色后消失。

诊断过程记录：人工改 `camera.position` 会被 CameraController 覆盖（v1 作废）；人工球坐标对准存在纹理参数化映射差（v2/v3 作废）；`scripts/diag-blend-v4.ts` 为最终采用路径。站点 group 仅在激活（降落序列或 `activateMoonSite`）后可见，选站本身不激活。

## 2. 实施（review 步骤 3+4）

1. **统一明暗口径**：静海站的 valley（NAC DTM 窗）、L1 区域面、窗口 rim、boundary skirt 全部从 MeshStandardMaterial 换为 MoonMaterial 着色（`createMoonMaterial`）。光照 uniform（`sunDirection`/`teachingLight`）与本体材质**共享同一 uniform 对象**（P1 同款机制），模拟时间推进与补光开关自动同步；渐显门控统一走 `uOpacity`（`setSurfaceLayerOpacity`，`HolePatchMaterial.ts`），透明度阈值/透明标志语义与原 opacity 一致。taurus 的 WAC 换装路径不受影响（`collarMaterial` 仅 taurus 赋值，换装判定处显式窄化）。
2. **地理混合带（review 步骤 4）**：`createMoonMaterial` 新增 `blend` 选项——高清纹理按网格局部 UV 采样，全球底图按窗口的全球等距柱状 UV 范围（`raster.windowBounds` → `[u0,v0,u1,v1]`，v 轴反向校正）独立采样；到窗口边最近距离在 `bandFrac=0.15`（方案起点 10–20% 取中）内权重平滑 0→1，中心恒为纯高清，四角用 min 距离场保持连续（无十字线/圆形硬边）。权重以**地理位置**固定（UV 由网格顶点插值），不随屏幕/相机游走。应用于 valley（NAC 高清 ↔ 全球 2K）。
3. **未动项**：中心 DEM/碰撞/高度契约不变；L1 真实几何起伏不削（那是真实地形，不是缺陷）；补片栈与盖板结构不变；无透明露孔（着色统一后孔区仍由补片/细层不透明覆盖，R2 连续淡出逻辑原样）。

## 3. 前后对照（同构建同流程，真实 UI 降落）

| review 要求 | after | before |
| --- | --- | --- |
| ~293km 全景 | `after/02-agl-293km.png`（285km 帧） | `before/02-agl-293km.png`（181km 帧）+ `after/../before/01-*` 阈值帧 |
| 中低空含边缘 | `after/02-agl-60km.png`、`before/02-agl-60km.png` | 同左 |
| 球缘斜视 | `after/07-limb-oblique.png` | `before/07-limb-oblique.png` |
| 触地回望 | `after/03-surface-look(-turned).png`、`touch-probe/surface-look-final.png` | （见 §5 限制） |
| 连续下降 | `after/00-seq-01..10.png`（每 5s）+ `timeline-descent.jsonl` | `before/00-seq-01..10.png` + 同名时间线 |
| 阈值前后帧 | `after/01-th-{l1,dtm}-{005,095}-up-{a,b}.png`、`01-th-patch-off-{a,b}.png` | before 同名全套 |

- 看图结论（作者自评，供 Codex 复核）：~293km 机位下 before 存在清晰的矩形明暗/色温边界与 skirt 亮白斜线；after 同机位矩形外轮廓、明暗带、白线明显减弱，L1 区域与外围球面色调统一，仅剩真实地形细节 vs 平滑球面的自然差异（这正是"同一片地表逐渐缺少细节"的观感方向）。中心 NAC 高清细节不受影响（blend 中心权重恒 1）。
- 阈值帧抓拍说明：垂直速度最高 ~67km/s、采样间隔 400ms，`02-agl-*` 帧与名义高度存在 ±30km 量级偏差（帧内 HUD 显示真实 AGL）；`01-th-*` 为渐显门控 5%/95% 越阈前后帧。
- `05/06/07` 人工摆位机位说明：以挖孔球 boundingSphere 为半径基准，实际高度低于名义值（贴脸广角），但 **before/after 实现完全一致**，仍可有效对照；用户机位的权威对照是真实降落序列的 `02-agl-*`。

## 4. 性能（同法测量，绝对值含截图开销，用于前后对比）

`renderer.info.render.frame` 帧数差 × 12 次截图墙钟（headless 截图驱动模式，`report-orbit.json`）：

| 机位 | after | before |
| --- | --- | --- |
| 293km 轨道 | 5.5 ms/帧 | 5.6 ms/帧 |
| 60km 低轨 | 5.5 ms/帧 | 5.5 ms/帧 |
| 1200km 斜视 | 5.5 ms/帧 | 5.5 ms/帧 |

静海栈材质数量不变（3 个 MeshStandardMaterial → 3 个 ShaderMaterial，同网格）；采样数/纹理不变。无回归。

## 5. 限制与如实说明

1. **NAC 正射图自带已拍入的光照阴影**，与本引擎实时光照叠加后，valley 窗内仍有"影像阴影 + 实时晨昏"双光照痕迹——这是现有资产口径问题（review 已预见），未在本轮解决；全球 2K 为正射纠正无影图，混合带内 NAC 阴影随权重渐出。
2. **L1 与外球的分辨率差仍在**（几何+门控渐显），本轮消除的是"贴上去的矩形照片"观感；2K 全球图与 L1 之间没有中间分辨率资产，"完全无缝"不做承诺。
3. **SURFACE_LOOK（触地）渲染极重**：headless 下贴地单帧耗时秒级，探针的 rAF 采样与返轨等待在该模式长时间阻塞（CDP evaluate 超时，三次复现；56s 短会话判别实验证明功能健康、evaluate 毫秒级响应）。这是**既有行为**（bdac3bc/R2 轮同流程可复跑成功，本轮材质改动前后均存在），但值得下一轮单独取证（真实帧率下用户体验待实测）。因此 before 侧触地回望图未采集，after 侧有（`03-*`、`touch-probe/surface-look-final.png`）。
4. before 侧 `report-orbit.json` 的 descent-tail 采样缺失（探针分段顺序问题），轨道三机位 perf 两侧齐全。
5. 静海无 WAC 换装路径（仅 taurus 打包），本轮未触碰；`diagnosis/` 下 v1–v3 过程脚本因方法缺陷已删（结论记录在 v4 头注释）。

## 6. 验收与回退

- 验收：`npx tsc --noEmit` 干净；`tests/hole-patch-material.test.ts`+`tests/moon-hole-patch.test.ts`+`tests/depth-slices.test.ts` 18/18 PASS；生产构建通过；Codex 看图清单见 §3。
- 提交拆分：①P1 光照同步 `7361736`；②toast 修复 `69d3e30`；③本项（MoonMaterial 扩展+静海统一着色+混合带+探针）。
- 回退：revert 本项提交即可完整恢复 8deebfc 行为（`MoonMaterial.ts` 的 options 参数向后兼容，其他调用点不受影响）。
