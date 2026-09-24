# F-RADIUS-CONSISTENCY 调查记录（2026-09-24）

登记来源：S4b 期间 taurus 回归探针输出 `moonRadius 0.368`（NAV）与 hadley 探针 flyDiag `radius 0.687`（PHYSICAL）的表面矛盾。本记录为调查结论与方案，未改动任何代码。

## 半径口径清单

| 口径 | 定义 | 所在 |
| --- | --- | --- |
| `displayRadius`（node） | 天体初始化时捕获的 NAV 展示半径，几何构建基准 | `SolarEngine.bodyNodes` |
| `renderSurfaceRadius` | `BodyPoseProvider.getBodyPose()` 输出的当前策略渲染半径 | `BodyPoseProvider.ts:37` |
| `pose.surfaceRadius` | `getBodyWorldPose()` 直通 `renderSurfaceRadius` | `SolarEngine.ts:3574` |
| `mesh.scale` | 卫星 PHYSICAL 过渡的平滑缩放（行星恒 1） | `SolarEngine.ts:3736` |
| `moonBaseRadius`/`marsBaseRadius` | 站点栈几何构建捕获的 NAV 值 | `SolarEngine` 站点栈 |
| `datumRadiusKm`/`datumRadiusM` | 物理（米）基准——高程换算分母，非场景半径 | 契约/地形源 |

## 结论：当前一致性成立

- **行星（含 mars）**：任何策略下 `renderSurfaceRadius = navRadius` 恒定（参考行星本尊保持 NAV 标尺，`BodyPoseProvider.ts:514`），mesh scale 恒 1，几何用同一 `displayRadius` 构建。因此尘雾换算 `metersPerScene = datumM / pose.surfaceRadius`（`SolarEngine.ts` updateMarsDustAtmosphere）与 `computeGroundPose` 的 `displayRadius × scale` 双通道天然互等。
- **卫星（moon）**：PHYSICAL 过渡时 `blendedRadius = lerp(navRadius, physMoonRadius, smoothT)`（`BodyPoseProvider.ts:548`），animate 每帧 `mesh.scale = pose.displayRadius / node.displayRadius`（`SolarEngine.ts:3736`）跟随同一插值 → **不变量**：`pose.renderSurfaceRadius ≡ node.displayRadius × mesh.scale.x`（全策略、含过渡中间态）。0.368（NAV）与 0.687（PHYSICAL = parentNavRadius × 1737.4km/6371km 系数）是该半径的两个合法值，非矛盾。
- 站点栈几何（挖孔球/DTM 窗/裙圈）挂在 mesh 下随 scale 缩放，米制换算（`datumM / 世界半径`）在全策略下自洽。

## 风险点（为什么值得专项）

1. 不变量 `renderSurfaceRadius ≡ displayRadius × mesh.scale` 目前**无守护测试**——两处插值（BodyPoseProvider 的 smootherstep 与 SolarEngine 的逐帧 scale 跟随）若一方改动公式（如缓动函数不同步），中间态将出现半径错配，症状为下降段 AGL 跳变/雾距错档，且仅在过渡瞬态可见，易漏。
2. `computeGroundPose` 的 fallback 分支 `node.mesh.scale.x` 与 `bodyPose.surfaceRadius` 是双通道等价取值——依赖同一不变量。
3. 站点栈的 `moonBaseRadius`/`marsBaseRadius` 是构建期捕获值——若未来支持运行时重建（窗口变更/分辨率升级），须与 `displayRadius` 同源。

## 建议方案（后续轮次，需确认后执行）

- **守护断言 A（探针）**：在既有下降探针的 PREPARING 完成帧断言 `|pose.surfaceRadius − node.displayRadius×mesh.getWorldScale().x| < 1e-6`（moon 三站 + mars 三站）。
- **守护断言 B（单测，BodyPoseProvider）**：过渡 progress ∈ {0, 0.25, 0.5, 0.75, 1} 时 moon 的 `renderSurfaceRadius` 单调且端点精确等于 navRadius / physMoonRadius；parentNavRadius × moonPhysRadiusKm/parentPhysRadiusKm 复算闭合。
- 以上均为断言级改动，无行为变化；预计 +8 测试用例。

## 涉及证据

- `BodyPoseProvider.ts:477-570`（三策略半径输出）；`SolarEngine.ts:3541-3578`（pose 直通）、`:3722-3740`（卫星 scale 联动）、`:2425-2447`（computeGroundPose 双通道注释"行星恒 scale 1"）。
- 探针基线：taurus `moonRadius 0.368`（S4b）；hadley `radius 0.687`（S5-3）。
