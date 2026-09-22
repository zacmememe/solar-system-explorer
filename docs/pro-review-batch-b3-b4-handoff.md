# 太阳系漫游 · 批次 B3 与 B4 工程实施与验收交接文档

## 一、概述与版本范围

- **关联批次**：
  - **批次 B3**：地球离线双根地理四叉树瓦片与高精 ROI（Earth Offline Geographic Quadtree & High-Precision ROI）；
  - **批次 B4**：天体物理局部空间与精选航天器管线（Physical Local Space & Selected Vehicle Pipeline）；
- **基线版本**：基于 `df471c4`（B2 视觉基石、统一色彩管线与资产管理完成）；
- **目标分支**：`main`（GitHub 私有仓库 `zacmememe/solar-system-explorer`）。

---

## 二、批次 B3：地球瓦片金字塔与高精 ROI 成果

1. **双根四叉树拓扑划分 (`src/surface/TileGeometryBuilder.ts`, `src/contracts/surface.ts`)**：
   - 经度范围严格划分：西半球（根瓦片 `0/0/0`，经度 $[-180^\circ, 0^\circ]$，纬度 $[-90^\circ, 90^\circ]$）与东半球（根瓦片 `0/1/0`，经度 $[0^\circ, 180^\circ]$，纬度 $[-90^\circ, 90^\circ]$）；
   - $16 \times 16$ 细分球面网格，极点法线重算收敛，消除中央子午线（$0^\circ$）缝隙与极点退化；
   - 严格计算各瓦片外接包围球心与半径，提供视锥快速剔除与自适应细分。
2. **自适应 LOD 调度与平滑渐变 (`src/surface/SurfaceTileManager.ts`)**：
   - 视锥快速剔除与基于相机距离的屏幕空间误差 (SSE) 自适应 LOD 调度；
   - 父子瓦片平滑淡入渐变（0.2s Fade Blend），彻底消除几何跳跃与闪烁；
   - 内存与显存硬限制：最大 64 块活跃贴图 LRU 缓存，防内存泄漏。
3. **高精离线切片与生产清单 (`scripts/generate-earth-tiles.ts`, `public/assets/tiles/earth/`)**：
   - 生成 44 块标准 512×512 生产瓦片（覆盖 L=0 全球双根、L=1 半球、L=2 大陆级及珠江口、喜马拉雅两处高精 ROI）；
   - 包含生产清单 `manifest.json`。
4. **瓦片专用着色材质 (`src/surface/TileMaterial.ts`)**：
   - 晨昏线渐变过渡、大气边缘 Fresnel Rim 散射微光与夜间灯光渲染；
   - 统一接入 ACES Filmic + sRGB 渲染管线。

---

## 三、批次 B4：物理局部空间与精选航天器管线成果

1. **天体物理状态提供器与展示策略调度 (`src/astronomy/BodyPoseProvider.ts`)**：
   - 建立双精度公里常数与 J2000 统一物理框架；
   - 提供 `NAV_SCHEMATIC`（宏观导航比例）与 `PHYSICAL_OBSERVATION`（地月物理真实比例）双策略；
   - 采用 Smootherstep（$6t^5 - 15t^4 + 10t^3$）双向平滑插值过渡，加速度连续无突跳；
   - **月球看地球真实物理视直径权威验证**：
     - 真实物理公式：$\theta = 2 \arcsin(6371 / 384400) \approx 1.89931^\circ \approx 1.90^\circ$；
     - 场景物理等价视直径：$2 \arcsin(1.35 / 81.45346) \approx 1.89931^\circ$；
     - **实测绝对误差：$2.22 \times 10^{-16\circ}$**，彻底修复旧版示意模式夸大 11 倍（$21.47^\circ$）的物理缺陷。
2. **精选航天器管线：NASA 哈勃太空望远镜 (`src/vehicles/VehicleMeshBuilder.ts`, `src/vehicles/VehicleCatalog.ts`)**：
   - 真实 1:1 米制建模（长 13.2m、口径 2.4m、翼展 12m、质量 11.1 吨）；
   - 钛银高光 MLI 隔热镜筒、敞开 42° 的活动遮光防护保护门（Aperture Door）、2.4 米凹面超高反射主镜与次镜支撑十字架、ESA SA3 柔性硅双翼太阳翼、双抛物微波天线、后部设备仪器舱与黄色维护扶手；
   - 四大热点科普：主反射镜、柔性太阳翼、遮光保护门、第三代广角行星相机（WFC3）。
3. **机库生命周期优化 (`src/vehicles/VehicleViewer3D.tsx`)**：
   - WebGLRenderer 常驻，切换热点与标尺仅通过相机平滑补间，彻底消除黑屏闪烁。
4. **书签契约升级 V2 (`src/contracts/bookmark.ts`, `src/utils/bookmarkStorage.ts`, `src/app/App.tsx`)**：
   - 扩展 `BookmarkItemV2`，支持存储展示策略、时间 Epoch 与固连参数；
   - 提供 `upgradeBookmarkToV2` 兼容迁移器，向后兼容 V1；
   - 新增预置书签 `preset-moon-physical-earth`（🌕 月球 · 物理尺度眺望地球 1.90°），恢复书签时自动同步策略至主引擎。

---

## 四、验证结果与性能指标

1. **自动化单元测试**：
   - 全工程共 **58 项单测全部通过 (58/58 PASS, 100%)**；
   - 覆盖四叉树拓扑、网格缝合、物理角直径真值、双向平滑插值、书签 V2 迁移。
2. **类型检查与构建**：
   - `npx tsc --noEmit`：**0 错误**；
   - `npm run build`：**成功 (dist 1.12MB gzip 308KB)**。
3. **真实 Edge 浏览器自动化端到端验收**：
   - **B3 性能**：150 帧采样平均帧率 **240.0 FPS**，P95 帧耗时 **4.3 ms**，长帧 0；
   - **B4 性能**：151 帧采样平均帧率 **240.1 FPS**，P95 帧耗时 **4.7 ms**，长帧 0；
   - 实机高清截图已在本地生成并归档。
