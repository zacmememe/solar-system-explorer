# 太阳系漫游 · 批次 R3 工程实施与验收交接文档

## 一、概述与版本范围

- **关联批次**：**批次 R3**：同一次观察（物理尺度、光照、观察目标、HUD 和书签统一）；
- **基线版本**：基于 `070589f`（R2 真实 NASA BMNG 地表金字塔与地理入口完成）；
- **目标分支**：`main`（GitHub 公开仓库 `zacmememe/solar-system-explorer`）；
- **核心目标**：
  1. 彻底根除地月 170° 混合光照偏差，改用真实物理空间绝对矢量统一计算太阳光照方向；
  2. 解耦机位锚点 (`anchor`) 与观察朝向 (`lookTarget`)，使“月球眺望地球”书签真实正对地球，精准呈现 1.90° 居中视圆盘；
  3. 修正相机月球旧过大半径约束与动态近剪裁面，杜绝地表裁剪；
  4. 统一 HUD 视窗与轨迹范围，在物理观察模式下自适应包含 81.45 单位物理轨道，彻底根除 8415px 溢出；
  5. 升级书签 V2 事务化快照捕获与恢复（权威时间、策略、视向、图层、载具），采用 `Number.isFinite` 严格数值校验。

---

## 二、批次 R3 核心源码实施证据 (Source Evidence)

1. **地月物理太阳光照统一计算 (`src/astronomy/BodyPoseProvider.ts`, `src/engine/SolarEngine.ts`)**：
   - 物理单位向量公式：`d_sun = normalize(P_sun_km - P_body_km) = normalize(-P_body_km)`；
   - 卫星节点更新中，废弃非线性局部坐标反向方案，全天体材质 uniforms 同步真实绝对向量；
   - **实测地月太阳光照向量夹角**：从原 170.24° 逆向缩减至 **0.0790°**（严格平行）。

2. **观察朝向与机位锚点解耦 (`src/contracts/camera.ts`, `src/camera/CameraController.ts`)**：
   - 扩展类型 `CameraLookTarget = { kind: 'center' } | { kind: 'body'; bodyId: BodyId } | { kind: 'point'; point: [number, number, number] }`；
   - 相机控制器支持向特定天体对齐视线，并在每帧保持对目标天体朝向；
   - 月球表面观测地球时，地球视直径精准收敛至 **1.8994° ≈ 1.90°** 居中视圆盘。

3. **物理观察模式局部参考系隔离 (`src/engine/SolarEngine.ts`)**：
   - 在 `PHYSICAL_OBSERVATION` 模式下，仅保留地月物理局部系统（Earth, Moon, 载具），动态过滤掉宏观示意 3D 太阳球体（8.5 单位）与其他大行星网格；
   - 彻底杜绝 81.45 物理距离处示意大球体在视线中穿模抢镜。

4. **相机月球真实渲染半径与动态近剪裁面 (`src/camera/CameraController.ts`, `src/astronomy/BodyPoseProvider.ts`)**：
   - 导出 `renderSurfaceRadius`（月球为 0.36815）；
   - 相机月表最小限距从 0.6869 降至 0.3782，动态近剪裁面降至 0.003，保证贴近地表无穿模切削。

5. **HUD 物理轨迹自适应收纳 (`src/app/hud/model.ts`)**：
   - `buildSystemMapModel` 计算 `extent` 包含天体同一次观察的实际距离；
   - 物理模式下轨道点同比例自适应缩放，椭圆严密穿过天体点，地月全系统居中收纳在 540x100 视窗内，溢出像素为 0。

6. **书签 V2 事务化快照与有限数校验 (`src/contracts/bookmark.ts`, `src/utils/bookmarkStorage.ts`, `src/app/BookmarkModal.tsx`)**：
   - 接入 `captureObservationSnapshot`，完整快照 `simTimeHours`、`presentationPolicy`、`lookTarget`、图层与载具；
   - `isValidBookmarkAnyVersion` 采用 `Number.isFinite` 校验，抵御 `Infinity` 与非法枚举。

---

## 三、自动化测试与实机端到端验收结果 (Verification Results)

1. **自动化单元测试**：
   - 执行：`npm test`
   - 结果：**15 个测试文件全部通过 (15/15 passed)，74 项单测全部通过 (74/74 PASS, 100%)**；
   - 新增：`tests/r3-observation-coherence.test.ts` 涵盖日照夹角、视圆盘几何收敛、相机近距、HUD 视窗自适应与书签 V2 严格全字段校验。

2. **生产构建检查**：
   - 执行：`npm run build`
   - 结果：`tsc` 0 类型错误，`vite build` 0 构建错误，成功输出 `dist/`。

3. **真实浏览器端到端实测 (Microsoft Edge Headless / Direct3D 11 WebGL)**：
   - 执行：`npx tsx scripts/verify-r3-observation.ts`
   - **地月物理太阳光照夹角**：`0.0790°`（通过，门禁 $\le 0.15^\circ$）；
   - **视向解耦与角直径**：`1.8994°`（通过，基准 $1.90^\circ$ 居中）；
   - **相机月球最小限距**：`0.3782`（通过，顺利贴近表面）；
   - **HUD 视窗自适应**：`81.45` 物理轨道点收纳（通过，0 像素溢出）；
   - **书签 V2 事务化快照**：完整保存与恢复（通过，严格有限数）；
   - **渲染循环性能**：**Avg FPS 60.0**，**P95 17.8ms**，**Max 19.3ms**，**长帧 0**，**控制台错误 0**；
   - **报告路径**：`artifacts/pro-review/batch-r3-observation-report.json`。

4. **实机截帧比对**：
   - `50-r3-moon-view-earth-centered.png`：月表凝望地球（1.90° 居中视圆盘，深邃纯净星空背景）；
   - `51-r3-earth-moon-physical-sunlight.png`：地月系统日照同向比对；
   - `52-r3-hud-physical-tracks.png`：HUD 物理尺度自适应收纳；
   - `53-r3-bookmark-v2-snapshot.png`：书签 V2 事务化快照与收藏列表面板展示。

---

## 四、安全与合规审计证明 (Security Audit)

- 仓库性质：公开仓库（GitHub Public Repository）；
- 凭据审计：全量 diff 与未跟踪文件检索，无个人用户名、无本地 Windows 绝对路径、无 Token、无密码、无 API 密钥；
- 文件排除：排除构建临时文件、排除浏览器调试日志、排除凭据与本地导出包。

---

## 五、回退方案 (Rollback Procedure)

如需回退批次 R3，可执行：
```bash
git revert --no-edit HEAD
npm test
npm run build
```
即可安全无损撤销 R3 的修改并恢复至 R2（Commit `070589f`）。
