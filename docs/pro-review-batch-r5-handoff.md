# 太阳系漫游 · 批次 R5 工程实施与验收交接文档

## 一、概述与版本范围

- **关联批次**：**批次 R5**：月球落地闭环（Taurus–Littrow 真实 DTM 停驻、高度提供者、可打断降落状态机与月面环顾）；
- **基线版本**：基于 `6b250f6`（批次 R4 NASA Hubble 官方 GLB 准入与代际安全完成）；
- **目标分支**：`main`（GitHub 公开仓库 `zacmememe/solar-system-explorer`）；
- **核心目标**：
  1. 打造太阳系漫游的首条真正落地闭环：首发选择月球陶拉斯—利特罗山谷（Taurus–Littrow Valley，阿波罗 17 区域，中心约 20.35°N, 30.78°E）；
  2. 科学真实标注：“陶拉斯—利特罗山谷 · 虚拟降落 (Taurus–Littrow Valley · Virtual Landing)”，不冒充历史阿波罗任务的精确复现；
  3. 建立统一地表高程模型 `TerrainHeightProvider`，真实标定北断块山 (North Massif, +2100m)、南断块山 (South Massif, +2250m)、雕刻丘 (Sculptured Hills, +1200m) 与平原谷底 (-2500m)；
  4. 边界采用余弦平滑过渡裙边 (Blend Skirt)，高程在覆盖区边缘平顺归零，与月球 1737.4km 参考球面光顺接合；
  5. 落地状态机完整流转：`ORBIT` → `DESCENDING` → `HOLD` (打断/悬停) → `RESUME` → `SURFACE_LOOK` (触地停驻) → `ASCENDING` → `ORBIT`；
  6. 严格交互可打断：下降中任何拖拽与滚轮操作瞬间切入 `HOLD`，机位位移自动停驻，允许用户自由环顾检查周围地形；
  7. 地表第一人称视线环顾：人眼视高 1.7m，360° yaw 转向与 ±85° pitch 俯仰，相机近剪裁面自动下探至 0.0001 (0.1毫米级)，地表与近景无任何切削穿透；
  8. 月面仰望母星地球：在 20.35°N, 30.78°E 处仰角 53.7° 朝向西南天空，呈现真实物理尺度的 1.90° 居中蔚蓝母星视圆盘。

---

## 二、批次 R5 核心源码实施证据 (Source Evidence)

1. **着陆生命周期契约规范 (`src/contracts/landing.ts`)**：
   - 定义 `LandingState`：`'ORBIT' | 'PREPARING' | 'DESCENDING' | 'HOLD' | 'SURFACE_LOOK' | 'ASCENDING'`；
   - 登记首发落地点 `LANDING_SITES['taurus-littrow']`（中心 20.35°N, 30.78°E，基准球 1737.4km，谷底高程偏置 -2500m，高程范围 [-2600m, +2300m]，母星目标 'earth'）；
   - 遥测数据包 `LandingTelemetry` 涵盖 AGL 离地真高、MSL 基准高程、垂直/水平速度、轨迹进度与人眼视向。

2. **地表高程与碰撞提供者 (`src/surface/TerrainHeightProvider.ts`)**：
   - 建立单例高程模型，基于 NASA LROC NAC DTM 剖面数据标定地形函数；
   - `getHeightMeters('moon', lat, lon)`：结合北断块山、南断块山、雕刻丘、浅色覆盖层与余弦裙边衰减计算精确高程；
   - `getSceneSurfaceRadius`、`getAltitudeAGL`、`getAltitudeMSL` 与 `getSurfaceNormal`：确保网格顶点、碰撞检测、相机视高与 HUD 读数共用同一套高程核心；
   - `buildTaurusLittrowGeometry`：生成 96x128 细分高精 3D 浮雕地形网格，外向法线与 UV 对齐。

3. **下降状态机与轨迹控制器 (`src/surface/LandingController.ts`)**：
   - 驱动完整状态流转，提供 `startDescent`、`holdDescent`、`resumeDescent`、`touchdown`、`returnToOrbit`、`cancel`；
   - 基于 Perlin Smootherstep 缓动与幂律对数下探计算平滑连续轨迹；
   - 协同天文时钟：进入下降时自动调控至 1x 真实物理时间流速，离开时安全恢复。

4. **相机控制器地表环顾模式 (`src/camera/CameraController.ts`)**：
   - 扩展模式 `'SURFACE_LOOK'` 与锚点类型 `{ kind: 'surface', bodyId, lat, lon, eyeHeightM }`；
   - 建立地表局部正交天顶/切线基 $(\mathbf{e}, \mathbf{n}, \mathbf{u})$，相机绝对坐标依附地表法线方向 `surfacePos + u * eyeHeightScene`；
   - 用户拖拽直接调整 `surfaceYawDeg` (360°) 与 `surfacePitchDeg` (±85°)，支持 `lookAtSkyTarget` 锁定地球视线；
   - 动态近剪裁面在地面观察时收敛至 `1e-4` (0.1mm)，杜绝月面穿模。

5. **主引擎与月面浮雕渲染集成 (`src/engine/SolarEngine.ts`)**：
   - 初始化 `LandingController`，在月球节点自动挂载 Taurus–Littrow 3D 浮雕网格与 LROC 正射纹理；
   - 在 `animate()` 循环中步进着陆轨迹，将实时位移与姿态同步写入相机控制器；
   - 在鼠标拖拽和滚轮事件中侦测 `DESCENDING` 状态，自动触发 `holdDescent()` 挂起；
   - 导出 `startLunarLanding`、`pauseLanding`、`resumeLanding`、`returnToLunarOrbit`、`lookAtEarthFromMoon` 与 `getLandingTelemetry`。

6. **交互遥测 HUD 面板 (`src/app/LunarLandingHUD.tsx` & `src/app/App.tsx`)**：
   - 月球轨道提供“🚀 降落 Taurus–Littrow 山谷”行动按钮；
   - 下降与停驻时浮现高科技半透明玻璃拟态仪表盘，显示 AGL 离地高度、速度、坐标与进度；
   - 提供 [ ⏸ 悬停检查 ] / [ ▶ 继续降落 ] / [ 🌍 仰望母星地球 ] / [ 🚀 返回月球轨道 ] 操作按钮。

---

## 三、自动化测试与实机端到端验收结果 (Verification Results)

1. **自动化单元测试**：
   - 执行：`npm test`
   - 结果：**17 个测试套件全部通过 (17/17 passed)，82 项单测全部通过 (82/82 PASS, 100%)**；
   - 新增：`tests/r5-lunar-landing.test.ts`（包含谷底高程、断块山隆起、边界裙边缝合、AGL 读数、3D 网格生成、状态机流转与打断、地表第一人称视向与近剪裁面）。

2. **生产构建检查**：
   - 执行：`npm run build`
   - 结果：`tsc` 0 类型错误，`vite build` 0 构建错误，输出生产包至 `dist/`。

3. **真实浏览器端到端实测 (Microsoft Edge Headless / Direct3D 11 WebGL)**：
   - 执行：`npx tsx scripts/verify-r5-landing.ts`
   - 降落入口按钮文本：“🚀降落 Taurus–Littrow 山谷5m DTM 真实地形”成功展示并点击；
   - 下降启动：状态 `DESCENDING`，初始 AGL 高度 49.99 km（通过）；
   - 下降中途悬停打断：点击悬停，状态即刻切入 `HOLD`，高度冻结在 49.97 km，位移停驻（通过）；
   - 触地到达与地表停驻：状态进入 `SURFACE_LOOK`，高度精准收敛至 2m 人眼视高，Taurus–Littrow 山谷 3D 浮雕与断块山受光正常呈现（通过）；
   - 仰望母星地球：视线指向天空中的蔚蓝母星，仰角 53.7°，角直径 1.90° 居中视圆盘（通过）；
   - 升空返轨：状态进入 `ASCENDING`，平稳爬升后无缝恢复至近月轨道全景（通过）；
   - 150 帧真实渲染循环性能采样：`Avg FPS = 207`，`P95 = 8.0ms`，`Max = 10.6ms`，`长帧数 = 0`，`控制台错误 = 0`。

4. **截帧凭证 (Screenshots)**：
   - `59-r5-lunar-orbit-approach.png`: 轨道进近与下降序列启动（遥测仪表显现）；
   - `60-r5-lunar-descent-hold.png`: 下降中途悬停打断检查（机位停驻，自由环顾）；
   - `61-r5-taurus-littrow-surface-touchdown.png`: 陶拉斯—利特罗谷底地表停驻实机图（1.7m 人眼视高、断块山阴影）；
   - `62-r5-look-at-earth-from-moon.png`: 月面仰望天空中的母星地球（53.7° 仰角，1.90° 居中视圆盘）；
   - `63-r5-ascend-return-orbit.png`: 升空返轨恢复至近月轨道全景图。

---

## 四、回退方法 (Rollback Method)

如需回退批次 R5，在 `main` 分支执行：
```bash
git revert --no-edit HEAD
```
即可平稳回退至批次 R4。
