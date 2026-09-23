# 太阳系漫游 · 批次 P0 工程实施与验收交接文档

## 一、概述与版本范围

- **关联批次**：**批次 P0**：珠江口真数据与观测闭环（BMNG D1 正选数据扇区接入、站心系与自转四元数姿态配准消除 12.4° 偏差、全局 Black Marble 仿射 UV 夜景城市灯光、物理观测 vs 地貌观察双模式架构）；
- **基线版本**：基于 `da58d2a`；
- **审计对齐基线**：`前置方案打磨/260923Pro model优化审计/00-审计结论与真实感路线.md`；
- **目标分支**：`main`（GitHub 公开仓库 `zacmememe/solar-system-explorer`）；
- **核心目标**：
  1. **纠正切片源扇区错误**：将原南半球 C2 彻底替换为 NASA 官方正选的 D1（覆盖东亚/中国/珠江口，`90°E~180°E, 0°~90°N`，原生 GSD 约 463m），并在代码层建立扇区白名单阻断防护，杜绝拿错象限；
  2. **消除相机姿态配准偏差**：地理入口 `focusRegion` 接入地轴倾角与天体自转四元数 (`fixedToInertial`)，将站心法线变换到惯性世界坐标，彻底消除 12.4° 视向偏差；
  3. **修复瓦片着色器夜灯机制**：基于瓦片全球经纬度边界线性映射 Global UV 采样真实 Black Marble 夜景，杜绝单瓦片重复整张地球，实现大湾区广州/香港/深圳/珠海璀璨夜景的真实自发光呈现；
  4. **区分“物理观测”与“地貌观察”双模式**：
     - **物理观测模式 (physical)**：保持真实昼夜、云层外壳与城市夜景自发光；
     - **地貌观察模式 (terrain-study)**：隐藏云层、开启全向参考照明、保持模拟时钟不变，经纬度海岸线与伶仃洋水系清晰可辨；
  5. **瓦片调度与视背剔除 Bug 根因修复**：消除极近距离下根瓦片因曲率被视背剔除误杀导致无法下潜的缺陷，引入相机局部距离优先排序遍历与 `maxMemoryTiles: 256` 扩容；
  6. **实机端到端验收与测试**：四态渲染截帧验收、100 项自动化测试 100% 通过、生产构建零错误。

---

## 二、批次 P0 核心源码实施证据 (Source Evidence)

1. **BMNG 象限几何与白名单防护 (`src/world-support/bmng.ts`)**：
   - 标定 NASA 官方四大象限边界：`D1: 90°E~180°E, 0°~90°N`，`C2: 0°~90°E, 90°S~0°N`；
   - 实现 `verifyQuadrantSource(source, id)`：强力校验象限元数据，白名单放行东亚 D1，阻断拦截错误扇区（如 C2 冒充）；
   - `nativeGsdMeters`：计算原生地面分辨率（赤道约 463m/px）；
   - `sourceWindow`：浮点高精采样窗口计算，杜绝整数舍入拉伸导致的子像素漂移；
   - `globalUv` 与 `tileGlobalUvTransform`：瓦片世界经纬度边界映射至全球等距柱状夜景 UV 仿射变换。

2. **真实珠江口瓦片重切与生产清单 (`public/assets/tiles/earth/`)**：
   - 接入 NASA 官方 BMNG D1 正选高精源图（验证 SHA-256：`54fa2c1b6417e05cc2af635abe88b1254af51e035285a787ba79e85d8ba29cf6`）；
   - 切出覆盖珠江口核心区域的 34 块真实 L5–L9 瓦片（文件大小均在 10KB~25KB，彻底取代原 C2 纯黑大洋瓦片）；
   - 更新 `manifest.json` 至 `v2.1.0`（标明原生 GSD 0.463km 与 D1 来源）。

3. **数学内核与坐标系对齐 (`src/world-support/frames.ts`)**：
   - `earthGeodeticSiteFrame`：构建标准正交地理站心坐标系 `[up, east, north]`；
   - `latLonDirection`：输出与 Three.js 球面坐标系约定一致的局部地表法线；
   - `solarElevationDeg`：计算站心天顶方向与太阳光照向量的高精度太阳高度角；
   - `nearPlaneMeters`：近地面观察时动态近剪裁面距离计算。

4. **双模式观测策略与可见性 (`src/world-support/visibility.ts`)**：
   - 定义 `ObservationMode`：`'physical' | 'terrain-study'`；
   - `observationPolicy`：地貌模式强制隐藏云层、开启参考照明、严禁修改模拟时间并输出合规性说明；物理模式保留真实昼夜与云层；
   - `cloudPathLengthM` 与 `transmittance`：基于 Beer-Lambert 定律的云层物理透过率衰减模型。

5. **相机控制器地理对焦姿态配准 (`src/camera/CameraController.ts`)**：
   - `initiateFocusRegionFlight` 接入天体地表姿态四元数（地轴倾角与当前自转姿态）：
     ```ts
     const targetInfo = this.latestGetBodyPos ? this.latestGetBodyPos(targetId) : null;
     const bodyQuat = targetInfo?.quaternion || new THREE.Quaternion();
     const normalWorld = normal.clone().applyQuaternion(bodyQuat).normalize();
     ```
   - 转换至 Three.js 球坐标系，彻底消除 12.4° 视向偏差；
   - 目标半径安全限距计算：`targetRadius = Math.max(this.minDistance, this.surfaceRadius + safeAltitude)`。

6. **瓦片着色器夜灯与参考照明 (`src/surface/TileMaterial.ts`)**：
   - Uniforms 扩充：`nightTexture`, `hasNightTexture`, `tileGlobalUvOffset`, `tileGlobalUvScale`, `observationMode`；
   - 全球夜灯采样与自发光项：
     ```glsl
     vec2 globalUv = tileGlobalUvOffset + vUv * tileGlobalUvScale;
     globalUv.x = fract(globalUv.x);
     globalUv.y = clamp(globalUv.y, 0.0, 1.0);
     vec3 nightLights = hasNightTexture > 0.5 ? texture2D(nightTexture, globalUv).rgb : vec3(0.0);
     vec3 cityGlow = nightLights * vec3(2.5, 2.1, 1.6);
     vec3 litNightColor = dayColor * (0.04 + 0.25 * teachingLight) + cityGlow;
     ```
   - 地貌观察模式全向参考照明：
     ```glsl
     if (observationMode > 0.5) {
       vec3 refLightDir = normalize(vec3(0.4, 0.8, 0.5));
       float refDiffuse = max(dot(vNormal, refLightDir), 0.0) * 0.35 + 0.65;
       finalColor = dayColor * refDiffuse;
     }
     ```

7. **瓦片管理器视背剔除与调度修复 (`src/surface/SurfaceTileManager.ts`)**：
   - **Horizon Culling 豁免**：增加 `coord.z > 2 && distToTile > sphere.radius` 门禁，彻底解决根瓦片在极近距由于曲率夹角小于 -0.2 被整棵剪枝的致命 bug；
   - **距离排序调度**：`rootKeys` 与 `tile.children` 在四叉树递归细分前均按到相机的局部欧氏距离升序排序，相机正下方视区绝对优先细化下潜；
   - **显存与夜灯**：`maxMemoryTiles` 提升至 256；提供 `setObservationMode` 与 `setNightTexture`。

8. **主引擎姿态同步与模式驱动 (`src/engine/SolarEngine.ts`)**：
   - 纹理注入：加载 `earth_night.jpg` 注入 `earthTileManager`；
   - 提取 `updateEphemerisPoses(deltaSec)` 与 `getBodyWorldPose(id)`；
   - 在 `setSimTimeHours` 与 `focusEarthRegion` 执行时立即同步天体瞬时姿态与相机控制器世界位置，杜绝时钟修改后的姿态延迟；
   - 地貌模式下自动同步隐藏 `earthNode.cloudMesh`。

9. **UI 与交互集成 (`src/app/App.tsx` & `src/app/hud/MissionHUD.tsx`)**：
   - 入口文案更新：“📍 俯瞰珠江口 (约236km)”；
   - 顶栏增加“🌐 物理观测 / 🔭 地貌观察”模式切换按钮；
   - 俯瞰珠江口时浮现模式状态提示卡片与快速切换按钮。

---

## 三、自动化测试与实机端到端验收结果 (Verification Results)

1. **自动化单元测试**：
   - 执行：`npm test`
   - 结果：**18 个测试套件全部通过 (18/18 passed)，100 项测试全部通过 (100/100 PASS, 100%)**；
   - 专门套件：`tests/p0-earth-prd-visibility.test.ts`（包含 D1/C2 阻断防护、原生 GSD 463m、Global UV 仿射变换、站心系与自转四元数姿态配准、双模式策略、v2.1.0 瓦片质量与 24 小时昼夜点积测试）。

2. **生产构建检查**：
   - 执行：`npm run build`
   - 结果：`tsc` 0 类型错误，`vite build` 0 构建错误，输出生产包至 `dist/`。

3. **真实浏览器端到端实测 (Microsoft Edge Headless / Direct3D 11 WebGL)**：
   - 执行：`npx tsx scripts/verify-p0-earth-visibility.ts`
   - 验收报告：`artifacts/pro-review/batch-p0-earth-visibility-report.json`
   - 120 帧真实渲染循环性能采样：
     - `Avg FPS = 236`
     - `Avg Frame Time = 4.2ms`
     - `P95 Frame Time = 5.2ms`
     - `Max Frame Time = 7.1ms`
     - `长帧数 (>33.3ms) = 0`
     - `控制台与 WebGL 错误 = 0`

4. **四态高精截帧凭证 (Screenshots)**：
   - `64-p0-earth-global-d1-daylight.png`: 地球全局向阳面视角，正午高照下清晰呈现东亚、中国与 D1 扇区真实陆海轮廓；
   - `65-p0-earth-prd-physical-clouds.png`: 珠江口俯瞰（约 236km 轨道）· 物理观测（白昼），真实云层外壳漂浮在大湾区与伶仃洋上空；
   - `66-p0-earth-prd-terrain-study.png`: 珠江口俯瞰（约 236km 轨道）· 地貌观察模式，云层隐藏、全向参考照明、时间保持不变，水系与海岸线清晰可见；
   - `67-p0-earth-prd-night-city-lights.png`: 珠江口俯瞰（约 236km 轨道）· 物理观测（夜景），深黑夜面下大湾区城市群（广州/深圳/香港/澳门）Black Marble 璀璨夜灯自发光呈现。

---

## 四、回退方法 (Rollback Method)

如需回退批次 P0，在 `main` 分支执行：
```bash
git revert --no-edit HEAD
```
即可平稳回退至上一批次。
