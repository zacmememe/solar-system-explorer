# F-STARTUP-RESPONSIVENESS-11 · Zcode 工程报告（第18轮）

作者：zcode / GLM-5.3（sess_625dc0df-b15a-46e7-87a7-51351f4852bf）。视觉结论一律 NOT_OBSERVED。
基线 P=23e1271c23cc3144632c2bcd55d29991c0e5489a；实际 H=cf5e8263dbf9f7caa38fbe18a70394a398aa2578（生产树与 P 逐字一致，P→H 仅协作文档）。
工作目录 `D:/solar-worktrees/zcode-startup-11`，分支 `codex/zcode-startup-11`。构建产物 `dist/index.html` SHA-256 基线与运行轮一致（report.json `indexSha256`）。

## G0：基线测量（已完成）

### 现场与口径

- 机器：本机 Edge headless（版本见 report.json `browser`），1920×1080@DPR1，ANGLE/D3D11。
- 每轮=全新浏览器进程+独立 userDataDir（冷 HTTP：无共享缓存命中）。**OS/驱动/GPU 磁盘缓存未清**，如实声明。
- 采样自应用代码之前开始（evaluateOnNewDocument）：rAF 全序列、PerformanceObserver longtask/resource/paint、click/change 捕获态事件、`__solarEngine` 属性赋值拦截（引擎构造完成时刻）、100ms 轮询 HUD/默认站 built。
- CPU 采样：CDP Profiler 1ms 间隔，`cpu-r{1..3}.cpuprofile` 全程采样；归因用 dev 构建（未压缩、函数名可读）单独跑一轮 `attr-devprofile/dev.cpuprofile`（dev 数字不作为性能基线）。
- 证据：`D:/solar-evidence/F-STARTUP-RESPONSIVENESS-11/baseline-2026-09-28-09-12-/`（三轮完整 report.json/raw/raw-events/cpu profiles/final 截图）；首跑失败轮 `baseline-2026-09-28-09-05-` 保留（availability 语义：静海背面需 travel，非缺陷）。

### 三轮冷启动关键值（原值）

| 指标 | r1 | r2 | r3 |
|---|---|---|---|
| firstPaint / firstRAF (ms) | 284/89 | 268/84 | 284/88 |
| 引擎构造完成 engineCreated (ms) | 8165 | 7886 | 7916 |
| HUD 可操作（顶部导航出现）(ms) | 8205 | 7928 | 7957 |
| 默认站 taurus built (ms) | 10873 | 10606 | 10645 |
| **启动期最长主线程任务 (ms)** | **7861** | **7581** | **7611** |
| 启动期最长 rAF 间隔 (ms) | 7879 | 7604 | 7629 |
| 首次切星 earth↔moon 总时长 (ms) | 3317 | 3189 | 3186 |
| 首次切星期最长任务 (ms) | 648 | 436 | 538 |
| 首次准备（选静海→前往→开始→DESCENDING）(ms) | 14490 | 14578 | 14433 |
| 首次准备期最长任务 / 任务数 | 968/10 | 1045/9 | 1039/8 |
| 取消下降→ORBIT (ms) | 18195（平滑，0 长任务） | 18200 | 18183 |
| 热访问 hadley / 热复访 taurus (ms) | 1169/1178 | 1185/1179 | 1177/1170（均 0 长任务） |

页面错误/控制台错误：三轮均 0。

### 热点归因（调用栈证据）

1. **启动期单一 7.6–7.9s 长任务 = SolarEngine 构造期同步生成 23 颗卫星程序纹理**。任务起点 313ms（JS 执行初）→ 终点即 engineCreated。dev profile 引擎构造段（300ms..11600ms）self-time 前列全部是 `src/astronomy/MoonTextures.ts` 的噪声/特征函数：grad3D(:279) 累计 ~1.4s、noise3D(:285) 累计 ~1.0s+、各 `getXxxTexture`（Europa:403 376ms、MarsMoon:892 322ms、Triton:1542 219ms、Ganymede:693 192ms、Callisto:791 154ms…）+ latLonToVec3/angularDistance。每颗 1024×512 像素 × 每像素 2–4 次 fbm3D（各 2–4 octave）。消费点 `SolarEngine.ts:1799` 构造期 for 循环同步调用（4 颗有实测资产的走异步 assetManager 不阻塞，其余 ~19 颗程序纹理同步）。
2. **默认站资产到达后的同步建栈 ~0.7–1.0s 长任务**（生产 9786ms 处 862ms、10950ms 处 711ms）：`buildMoonSiteStack` 同步构建 LOLA L1 区域网格（55 万顶点）+ 法线 + 边界桥 + 窗缘裙圈 + 碎石场布点。dev 对应段（13800..15600ms）热点：buildRegionalGeometry(MolaRegionalSource:73)、computeVertexNormals、sampleHeight(JezeroTerrainSource:88)、generateRockPlacements(ProceduralRockField:22)、buildTerrainBoundaryBridge(TerrainBoundary:21)。
3. 首次准备 14.4s 的构成为 travel-to-site 飞行动画（设计时长 ~12s）+ 静海站资产装载与同类建栈长任务（最长 ~1s）。取消/热复访路径平滑无长任务（既有修复有效，不重做）。

### 冻结的工程目标（目标，非本轮成绩；旧阈值不下调，未达成就报 FAIL）

- T1 首个可操作帧（HUD 可点击）：冷启动 ≤ 2000ms（当前 ~7.9–8.2s）。
- T2 启动期主线程单一长任务 ≤ 250ms（当前 7.6–7.9s）。
- T3 交互期（切星/选站/准备启动）单一长任务 ≤ 200ms（当前 0.4–1.0s）。
- 约束：不降纹理分辨率/LOD/图层、不删避障采样、不删卫星、不延长动画掩盖、不换数据。视觉=NOT_OBSERVED。

## G1：按站点就绪、恢复与提交权（第一批完成）

读码实证（P 源码）：

1. `TerrainHeightProvider.isRasterReady` 返回默认站 `this.raster.isReady`（:126），而采样路由 `activeMoonRaster()`（:57）。`SolarEngine.stepLandingPreparation` 月球分支用它（:2570）——默认站失败会连坐其他站的准备（Z18-01 方向）。火星分支已按站路由（:2569）。
2. `ensureMoonSiteAssets/ensureMarsSiteAssets` 组合等待 DTM+区域层后建栈（:345/:365）；`stack.built = true` 在 `buildMoonSiteStack`/`buildMarsSiteStack` 开头（:386/:725），实际装配完成前置真——中途抛错既不能重试（loadStarted 已置）又显示 built。`JezeroTerrainSource.buildOrthoTexture()` 直接返回 TextureLoader 未解码对象（:236-245），调用方不能当作影像就绪（Z18-02）。
3. `RasterTerrainSource.load`/`JezeroTerrainSource.load` 的 `loadPromise` 失败后不清理（Raster :144-149 / Jezero :97-103）——后续调用复用 rejected promise，同页重试永远失败（Z18-04）。

### 第一批修复（已验证）

1. **失败可重试**：两个源类 `load()` 失败时清 `loadPromise`（保留 `loadError` 态），下一次 `load()` 产生新请求；`doLoad()` 开头清旧失败标记（重试成功后 state 回 ready）。Jezero 补齐与 Raster 同口径的 `state` getter（idle/loading/ready/failed）。
2. **ensure 失败重入**：`ensureMoonSiteAssets`/`ensureMarsSiteAssets` 在源 `state==='failed'` 时允许重入（loading/ready 幂等）；`.catch` 回滚 `loadStarted=false`。
3. **built 尾置+半装配回滚**：`build{Moon,Mars}SiteStack` 的 `built=true` 移到全部装配成功之后；新增 `reset{Moon,Mars}SiteStackPartial`（dispose 本站独占 geometry/材质、挖孔球若已装到本体先换回整球、清栈引用），构建抛错时回滚并允许重试。共享材质（本体材质/共享纹理）不 dispose。
4. **月面准备按站路由**：`stepLandingPreparation` capture 门月球分支改读 `moonSiteStacks.get(site.id)?.raster.isReady ?? false`（fail-closed），不再用默认站 getter。

### 第一批验证

- 单测 `tests/startup-responsiveness-11.test.ts` 3/3：Raster 404→failed→解除→同实例再 load 发新请求并 ready 且旧 error 清理；Jezero 同律；成功后幂等（复用 resolved promise 无新请求）。fetch stub 返回真实打包字节。
- 相关既有测试 77/77（p2-dem-descent/s4b/s5-apollo11/s5-apollo15/s5-mars-multisite/landing-continuity）；tsc 干净；生产构建通过。
- 浏览器反例探针 `scripts/verify-g1-counterexamples.mjs`（生产构建，请求拦截注入）**PASS**：
  - **Z18-01**：默认站 taurus 数据 404 → raster=failed/built=false/loadStarted 已回滚；哈德利选择后 raster=ready、availability=travel-to-site（不被连坐）；前往→开始→DESCENDING 达成（capture 门按本站数据放行，旧代码此处永远 wait）。证据 `g1-counterexamples/report.json`。
  - **Z18-04**：静海 DTM 404（4 请求被拦）→ failed/built=false；同页解除故障后"换站再选回"实际产生 5 个新请求 → ready/built=true/error=null。无刷新依赖。
- 视觉：NOT_OBSERVED（final.png 原图保留）。

### 未完成（G1 后续批次）

- Z18-02（正射影像解码失败受控路径）、Z18-03（可选 L1 极慢不阻塞基础能力——当前 L1 缺失回退两级栈已实现，需反例验证）、Z18-05/06/07（取消代际/资源回调装旧场景）、Z18-08（并发建站不串站——buildXxx 临时切 activeSite 为同步段，无跨 await，需并发探针实证）、Z18-09..12（书签同门槛/缓存淘汰复访/等价/连续性——随 G2/G3 批次验证）。

## G2：重计算移出输入关键路径（第一单元完成：卫星程序纹理）

### 改动

`SolarEngine` 构造期的 23 颗卫星表面纹理 for 循环（含 4 颗实测资产的异步装载与 ~19 颗程序纹理的同步 fbm3D 生成）与土卫六烟雾纹理段，**生成代码零改动**地搬移为 `installMoonSurfaceTexture(satId, token)` / `installTitanHazeTexture()` 两个私有方法，构造期只填 `pendingMoonTextureTasks` 队列；`pumpMoonTextureTasks()` 每帧（rAF）安装 1 颗，`dispose()` 时 `cancelAnimationFrame` 停泵（`isRunning=false` 双保险）。构造期各卫星保持中性材质（与既有"实测资产加载中"表现同口径）。

### 等价验证（Z18-11 口径：同一代码路径输出一致）

`scripts/verify-texture-equivalence-11.mjs`（生产构建）：队列排空后经引擎实例 `bodyNodes` 读取每颗卫星当前材质的纹理，canvas 型逐颗 `toDataURL` SHA-256。改造前（b80191e 构建）vs 改造后：**19 颗程序纹理 canvas 哈希全部一致**；4 颗实测资产为网络图（src 路径一致，端口随 preview 实例不同，非差异）。证据 `equiv-before/`、`equiv-after/`。视觉 NOT_OBSERVED。

### 三轮前后（同条件：全新浏览器进程/独立 profile/同机器；原值见 g2-after-1/report.json）

| 指标 | 基线 r1/r2/r3 | G2 后 r1/r2/r3 |
|---|---|---|
| engineCreated (ms) | 8165/7886/7916 | **1599/1578/1552** |
| HUD 可操作 (ms) | 8205/7928/7957 | **2262/2297/2227** |
| 启动期最长任务 (ms) | 7861/7581/7611 | **1323/1299/1294** |
| 启动期最长 rAF 间隔 (ms) | 7879/7604/7629 | 1958/1987/1945 |
| 默认站 built (ms) | 10873/10606/10645 | 8164/8081/7797 |

页面错误 0。切星/准备/取消/热复访与基线持平（未回归）。

### 冻结目标对账（如实）

- T1 首可操作帧 ≤2000ms：**未达成**（2227–2297ms，超 ~13%）。剩余=引擎构造尾部 ~700ms 后 React 首渲染。
- T2 启动单一长任务 ≤250ms：**未达成**（1294–1323ms，较基线 -83%）。剩余 1.3s 任务=构造函数其余同步初始化（23 卫星 mesh/几何创建、瓦片管理器等，CPU profile `cpu-r*.cpuprofile` 250–1700ms 窗口，压缩名待 dev 级进一步拆分）与队列泵最大单颗（maxGap ~1.95s 窗口内含单颗生成+GPU 上传）。
- T3 交互期单一长任务 ≤200ms：**未达成**（切星 493–687ms / 准备期 991–1091ms，与基线持平——G2 第一单元只针对启动段）。

下一单元候选（按 trace 价值排序）：①站点建栈长任务（~0.7–1.1s：L1 区域网格 55 万顶点+法线+边界桥+碎石布点，资产到达后同步执行，直接影响首访交互）②构造函数剩余同步段拆分③队列泵颗内分块。均需更深的异步化设计，本轮若额度/时间不再覆盖则如实移交。

## G3：资源寿命与完整旅程（待）

## 验证状态汇总

- 代码存在/行为验证分列；本报告数字为生产行为验证（浏览器真实 UI 路径）。
- 视觉接受：NOT_OBSERVED（作者不做视觉判断；final-r{1..3}.png 原图可供 Anti 复核）。
- 采集成功 ≠ 性能达标：当前 T1/T2/T3 全部未达成（基线值见上表），如实记录为 FAIL（待修复后复测）。
