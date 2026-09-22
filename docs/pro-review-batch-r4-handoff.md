# 太阳系漫游 · 批次 R4 工程实施与验收交接文档

## 一、概述与版本范围

- **关联批次**：**批次 R4**：少量精品载具（NASA 官方 Hubble GLB 资产准入、代际事务安全与机库交互重构）；
- **基线版本**：基于 `87b3b6d`（批次 R3 同一次观察完成）；
- **目标分支**：`main`（GitHub 公开仓库 `zacmememe/solar-system-explorer`）；
- **核心目标**：
  1. 默认精选目录收缩至经过认证的精品载具（ISS 与 NASA 官方 Hubble 空间望远镜），其余旧程序型号归入“全部历史载具”分区并保留兼容；
  2. 接入 NASA 官方公开 `Hubble Space Telescope (B).glb`（5,140,096 bytes，SHA-256：`FC2690F5806BCBE39EA534735B0AFEA9BD268AB89203A05C46E8C418CEB88489`）真实 PBR 资产，彻底替代简易几何拼装；
  3. 建立 `VehicleAssetRegistry` 准入清单，严格登记资产出处、许可协议（Public Domain / NASA Open Data）、哈希、统一米制几何变换与物理 Bounds；
  4. 建立 `VehicleLoader` 与代际计数机制（Generation Tracking），杜绝高频快速切换载具/清空载具导致的“异步迟到回调复活旧模型”与“相机注视机位偏斜”；
  5. 离线部署 Three.js Draco 解码器至 `public/draco/`，杜绝任何外部 CDN 网络依赖；
  6. 升级 3D 机库展厅交互：工坊中性白光 vs 在轨高反差日光一键切换、1:1 真实米制网格对比、结构热点动态随船旋转与科普解密、搭乘伴飞与一键干净移除。

---

## 二、批次 R4 核心源码实施证据 (Source Evidence)

1. **载具契约扩展与资产准入表 (`src/contracts/vehicle.ts`, `src/vehicles/VehicleAssetRegistry.ts`)**：
   - 载具定义扩展 `isFeatured`、`modelFormat` ('glb' | 'procedural')、`modelAssetPath`、`modelSourceUrl`、`modelLicense`、`modelApproved` 属性；
   - 建立 `VEHICLE_ASSET_REGISTRY` 准入清单，严格校验 NASA GSFC 作者、Public Domain 协议、5,140,096 字节大小与 SHA-256 哈希；
   - 导出 `getFeaturedVehicleIds()` 仅输出 `['hubble', 'iss']`，`getAllVehicleIds()` 返回全部 7 艘载具。

2. **异步载入与代际事务安全管线 (`src/vehicles/VehicleLoader.ts`)**：
   - 单例复用 `GLTFLoader` 与 `DRACOLoader`，本地指定 `dracoLoader.setDecoderPath('/draco/')`；
   - 引入原子代际计数器 `currentGeneration`，在 `loadVehicle(id, gen)` 异步完成时比对代际；若已过时则立即深度释放显存 (`disposeVehicleObject`) 并丢弃结果；
   - 自动化居中校准 (`rawBox.getCenter(center); gltf.scene.position.sub(center)`)，双面材质太空受光校正，并计算真实物理包围盒挂载在 `userData` 中。

3. **机库 3D 展厅与相机动态自适应 (`src/vehicles/VehicleViewer3D.tsx`)**：
   - 常驻单一 WebGLRenderer 实例，挂载代际管理；模型切换时自动更新 `targetCamPos` 与 `targetLookAt`，结合 `deltaSec` 指数衰减平滑插值，彻底消除机位偏斜；
   - 支持工坊中性白光与在轨高反差日光（单向主直射光 3.5 强度 + 极低环境光 0.1）实时无缝切换；
   - 结构热点标记随飞船自转同步旋转，根据模型包围盒动态适配光标大小。

4. **机库界面分类与出处证书展示 (`src/vehicles/HangarModal.tsx`)**：
   - 顶部提供“🌟 精选典藏”与“📦 全部载具”两级分类 Tab，精选默认仅展示 2 艘精品；
   - 显式展示“NASA 官方 GLB PBR 模型 (Public Domain)”出处认证证书 Badge 与详细任务档案；
   - 底部提供“登船并伴飞”与“结束伴飞 · 移除航天器”一键响应按钮。

5. **引擎主场景伴飞安全挂载 (`src/engine/SolarEngine.ts`)**：
   - 主引擎伴飞载具载入全面接入 `VehicleLoader.loadVehicle` 与 `vehicleLoadGeneration`；
   - 清空载具或切换载具时，自增代际并深度释放显存，杜绝旧飞船在太阳系空间残留。

---

## 三、自动化测试与实机端到端验收结果 (Verification Results)

1. **自动化单元测试**：
   - 执行：`npm test`
   - 结果：**16 个测试套件全部通过 (16/16 passed)，78 项单测全部通过 (78/78 PASS, 100%)**；
   - 新增：`tests/r4-vehicles-pipeline.test.ts`（包含精选收缩与元数据准入完整性、NASA Hubble GLB 与 Draco 磁盘存在与 SHA-256 哈希校验、代际事务防迟到回调拦截、历史载具向后兼容测试）。

2. **生产构建检查**：
   - 执行：`npm run build`
   - 结果：`tsc` 0 类型错误，`vite build` 0 构建错误，输出生产包至 `dist/`，包含 `dist/assets/models/hubble-nasa-b.glb` 与 `dist/draco/`。

3. **真实浏览器端到端实测 (Microsoft Edge Headless / Direct3D 11 WebGL)**：
   - 执行：`npx tsx scripts/verify-r4-vehicles.ts`
   - 精选典藏载具数量：`2` 艘（通过）；
   - 全部历史载具数量：`7` 艘（通过）；
   - NASA 官方 Hubble (B) GLB 真实模型载入、PBR 受光、出处证书：通过；
   - 1:1 米制比例网格与热点交互定位：通过；
   - 工坊白光与在轨日光高反差模式切换：通过；
   - 快速连续点击切换 (ISS -> Hubble -> 清空) 代际安全测试：未登船状态完美恢复，无残留模型，通过；
   - 150 帧真实渲染性能采样：`FPS = 60`, `P95 = 17.8ms`, `Max = 18.9ms`, `长帧数 = 0`, `控制台错误 = 0`。

4. **截帧凭证 (Screenshots)**：
   - `54-r4-hubble-nasa-glb-hangar.png`: 哈勃 NASA 官方 GLB 模型机库呈现图；
   - `55-r4-hubble-hotspots-metric.png`: 1:1 米制对比网格与热点标尺呈现图；
   - `56-r4-hubble-orbit-lighting.png`: 在轨日光高反差单向受光图；
   - `57-r4-hubble-in-orbit-formation.png`: 哈勃望远镜在轨前景伴飞实机图；
   - `58-r4-vehicle-cleared-clean.png`: 载具完全清空与纯净主场景恢复图。

---

## 四、回退方法 (Rollback Method)

如需回退批次 R4，在 `main` 分支执行：
```bash
git revert --no-edit HEAD
```
即可平稳回退至批次 R3。
