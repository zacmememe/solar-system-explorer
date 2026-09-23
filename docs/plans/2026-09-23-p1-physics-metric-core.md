# P1「公共物理与米制空间内核」接力执行计划（zcode，2026-09-23）

依据：`docs/zcode-handoff-2026-09-23.md`、Pro 交接包 `00/01/02` 文档、Anti P1 计划快照
（`review-exports/zcode-handoff-2026-09-23/antigravity-implementation_plan.md`，用户已批准，按交接勘误执行）。

基线：本地 main `731ff09`（P0），工作区含 P1 未提交 8 改 + 2 新增。 Anti 已中断，无并发写作者。

## 与 Anti 计划的差异（按交接勘误）

1. `tdbSecondsFromJ2000 = BASE_OFFSET + simTimeHours*3600` 的 BASE_OFFSET 是两个 JS Date 的 UTC 秒差，
   不能直接标 TDB。改为：明确记录时间基 `UTC + 37 闰秒 + 32.184s 固定偏移（TT≈TDB，未做 TDB−TT < 2ms 修正）`，
   数值上输出 `utcSeconds + 69.184`，并在契约字段/注释中如实说明这是近似换算而非星历级 TDB。
2. 涉及路径按实际代码：`src/contracts/bookmark.ts`、`src/utils/bookmarkStorage.ts`（Anti 写的 bookmarks.ts/BookmarkStorage.ts 不存在）。
3. 「十亿公里误差 < 1μm」不可实现：double 相对精度 ~2.2e-16，1e12 m 量级绝对误差 ~2e-4 m。
   测试按量级给误差预算：断言相对误差 < 1e-12（远严于 double 上限的余量），同时报告各量级绝对误差。
4. 「所有天体速度非零」不适用于太阳（原点）：验证有轨道天体的速度 = 位置的数值中心差分导数（容差按解析一致性）。
5. body-fixed 轴系显式声明为渲染边界约定 `+X=0°经、+Y=北极、-Z=90°E`，不冒充 IAU 制图坐标；
   惯性系如实标注为解析近似黄道系（XZ 圆轨道），不标 ICRF/J2000。
6. 月面看地球角直径不做恒等验收值：由同一快照实际距离与站点位置计算，验证渲染比例与物理公式一致。
7. 观察模式统一语义为 `'physical' | 'terrain-study'`，旧杂项标签（'PHYSICAL'/'TERRAIN'/'RADAR'/'NIGHT_LIGHTS'）在迁移时归一。

## 任务分解

### T1 合并 SolarEngine 重复观察模式方法（恢复编译）
- 删除 Anti 在 ~1368 新增的重复 `setObservationMode/getObservationMode`。
- 保留 P0 原版行为：瓦片 `earthTileManager.setObservationMode`、云层可见性、`onObservationModeChange` UI 回调。
- 云层状态一致性：新增私有 `syncEarthCloudVisibility()`，云层可见 = `showClouds && observationMode==='physical'`；
  `setShowClouds`/`setObservationMode`/晚到云纹理回调（~837 行）统一走它。用户手动关云后切模式再切回，
  保留用户选择（Pro P0-b 要求），并使书签 layers.showClouds 捕获一致。
- 不动 teachingLight 与观察模式的关系（P0 行为：地貌参考照明在瓦片 shader 内）。

### T2 BodyPoseProvider 物理状态诚实化 + 参考系统泛化
- `getPhysicalBodyState/getPhysicalSystemSnapshot`：
  - `tdbSecondsFromJ2000 = utcSecondsFromJ2000 + 69.184`，注释写明闰秒与 TT≈TDB 假设、非星历级；
  - `positionFrameId: 'ECLIPTIC-ANALYTIC-APPROX'`（如实：XZ 解析圆轨道，非 ICRF）；
  - `cartographicFrameId: 'BODY-FIXED-RENDER-X0-YN-Z90E'`（渲染边界轴约定，非 IAU 声明）；
  - `quality: 'analytic-approximation'` 保持；`sourceVersion` 更新为 P1 标识。
- 新增 `setPhysicalReferenceBody(id)`：PHYSICAL_OBSERVATION 下被线性化的父子系统（默认 earth）。
- `getBodyPose` 泛化：参考行星本尊保持其导航显示半径为局部基准（现 earth 行为），其卫星按
  `parentNavRadius × (physR/parentPhysR)` 半径、沿当前导航轨道方向 × `parentNavRadius × (a_km/parentPhysR)` 距离
  平滑过渡到物理比例（现 moon 特判的推广）。覆盖 Earth/Moon、Jupiter/Io、Saturn/Titan。
- `updateEphemerisPoses` 可见性：PHYSICAL 模式下参考行星系统 + 太阳可见（现硬编码仅 earth 系统）。
- 天王星姿态：`axialTiltDeg` 97.77 已在 BODIES；验证四元数极轴相对惯性 Y 的夹角 ≈ 倾角（测试）。
- 月球同步自转标注为近似模型（注释），不套用到 hyperion 等非锁定体（保持现行为，不新增假锁定）。

### T3 CameraController 站点随自转 + local-frame 接线 + 米制近裁剪
- `updateCameraTransform` SURFACE_LOOK 分支：
  - 用 `getPos(bodyId).quaternion`（同帧姿态）把 body-local 站点向量与 (u,e,n) 基变换到世界系，
    眼位 = bodyWorldPos + q·(站点local) + q·u × eyeHeightScene；解决站点不随自转变换。
  - 站点 body-fixed 米制坐标、法线改由 `local-frame.ts geodeticToBodyFixedM`（按天体 datum）计算，
    `bodyFixedToInertialKm`/`observerRelativeMeters` 用于与物理快照的一致性路径（提供站心惯性位置导出）。
  - 近裁剪面：`near = 0.1m × (surfaceRadius/datumM)`（米制 0.1m 的场景等效），删除「0.1毫米」误注释；
    移除固定 1e-4 下限。
  - 暴露 `getSurfaceStationPose()`：{ station: MetricStation(含地面高程 heightM、眼高 eyeHeightM、
    bodyFixedPosM、surfaceNormal), yawDeg, pitchDeg, metricScale, nearM } 供书签捕获与验收脚本。
- `getHeightMeters` 地面高程进 MetricStation.heightM（地面高程），眼高独立字段（区分二者）。
- 保持唯一相机写入者；打断、不自动回正等行为不变。

### T4 V3 书签真实闭环
- 契约：`MetricStation` 增加 `eyeHeightM`、`orientationDeg {yawDeg,pitchDeg}`；
  `BookmarkItemV3.observationMode: 'physical' | 'terrain-study'`（联合类型收窄）。
- `captureObservationSnapshot`：SURFACE_LOOK 时从 `cameraController.getSurfaceStationPose()` 取真实
  bodyFixedPosM/surfaceNormal/heightM/eyeHeightM/yaw/pitch，去除 [0,0,0]/[0,1,0]/眼高混装占位。
- `bookmarkStorage`：
  - V3 校验补全：三维向量有限、datum/coordinateType 合法、|lat|≤90、|lon|≤180、eyeHeightM>0、orientation 范围；
  - V1/V2 → V3 迁移不携带/不伪造 surfaceStation（仅 schemaVersion===3 时保留原站点字段并校验）；
  - 旧键 `solar_explorer_bookmarks_v2/v1` 迁移后原样保留作备份，不删除。
- 预置书签去污染：移除 Anti 加到 `preset-moon-physical-earth` 的硬编码地面站点（该预置本是轨道观察意图）；
  预置 observationMode 归一为 physical/terrain-study。
- App.tsx 恢复：站点书签用保存的 eyeHeightM、initialYawDeg、initialPitchDeg；
  sourceVersion 不一致时提示「数据版本变化」；站点非法（向量/范围校验失败）回退球坐标恢复 + toast，不 clamp 埋地。
- 恢复后仍执行 lookTarget（若存了看地球意图）。

### T5 测试
- 修 `tests/bookmarks.test.ts`：接受 schema 1/2/3 并新增 V3 行为断言（迁移不伪造站点、往返保站点/朝向/模式）。
- 修 `tests/r5-lunar-landing.test.ts`：near 断言改为 0.1m 米制等效（按测试内 surfaceRadius 换算期望值），
  并补「站点随天体四元数旋转」断言（同经纬度、不同姿态 → 机位 = 期望正变换）。
- 新增 `tests/p1-physics-metric-core.test.ts`：
  - 快照完整性（全 BODIES、有限值、诚实 frameId、quality、速度=数值导数）；
  - Earth/Moon、Jupiter/Io、Saturn/Titan 物理比例一致（渲染反算角直径 = 物理公式）；
  - 天王星极轴倾角四元数还原；
  - local-frame 往返（geodetic→bodyFixed→惯性→观察者相对）与量级化误差预算；
  - 0/6/12/18/24h 站点正反变换经纬度回算 < 1e-6°；
  - V1/V2/V3 书签迁移与非法拒绝。
- 不删除任何失败测试；断言失败即失败。

### T6 构建 + 真实浏览器验收
- `npm test`、`npm run build`。
- 新增 `scripts/verify-p1-physics-core.ts`：访问本地 preview（4173），基于 `window.__SOLAR_ENGINE__` 只读诊断 + 真实 UI 流程：
  1. `getPhysicalSystemSnapshot()` 全量有效；
  2. 进入月面地表观察 → 捕获 V3 书签（localStorage 校验 schemaVersion 3 与真实站点向量）→ 推进 12h → 恢复，
     断言站点经纬度/眼高/朝向/观察模式一致、相机未埋地（眼位-地面距 ≈ eyeHeight）；
  3. 同一地理点 0/6/12h 渲染命中（站点随自转）；
  4. 帧率采样来自引擎渲染循环（引擎新增 renderFrame 计数器），非独立 rAF；
  5. 结果 JSON 写 `artifacts/pro-review/batch-p1-physics-core-report.json`，任一断言失败 → 进程非零退出，
     不写死 PASSED。
- 截图存 `artifacts/pro-review/`，注明 commit 与状态。

### T7 交付
- `docs/pro-review-batch-p1-handoff.md`：commit、范围、源码证据、通过/失败/未执行、限制与回退。
- 检查 diff 与文件清单后提交、正常推送（快进），排除聊天/数据库/备份/导出物。

## 边界
- 单 SolarEngine、单 CameraController、HUD 不推进时钟、保留打断与不自动回正。
- 不升级 Three/Vite、不部署、不改可见性、不改历史、P1 完成前不进 P2。
- 程序纹理/近似轨道与真实数据如实区分标注。
