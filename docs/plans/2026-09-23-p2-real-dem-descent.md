# P2「真实月球山谷与连续下降」执行记录（zcode，2026-09-23）

基线：本地 main `7de3a68`（P1）。任务来源：`前置方案打磨/260923Pro model优化审计/solar-da58d2a-worlds-handoff/docs/01-执行Agent交接.md`（Pro 交接包 P2）。
本文件记录实际执行路径与偏离 Pro 原方案的 4 处勘误，供审查与后续批次复用；验收结论见 `docs/pro-review-batch-p2-handoff.md`。

## 1. 范围（按 Pro 交接包）

1. 下载 LROC `NAC_DTM_APOLLO17` 真实 32 位 DEM（5 m/px）+ 配套 NAC 正射影像（非缩略图）；
2. 删除高斯假地形后端（保留示意路径必须改名 prototype 且不得标注 measured-dem）；
3. 栅格提供器返回 `{valid, sourceId, fidelity, datum}`，NoData/窗外 fail-closed，不隐式补平原；
4. 下降控制改进：PREPARING 资源门槛、起点=当前机位连续、HOLD 保用户视线、resume 只续位移、参考曲线真实导数；
5. 验收清单（数值配准/地平线/两侧母星可见性/HOLD 闭环/异日期起点/书签/不能只核 state）。

## 2. 数据管线（实际执行）

### 2.1 源与坐标

- DEM：`NAC_DTM_APOLLO17_E041S3078_5M` 等距圆柱 float32 GeoTIFF（行星中心坐标，球体 1737400 m，中心 lat 20.33°/lon 180.356°… 实取 tiepoint 左上角 (−4276880, 645990) m、ModelPixelScale (5,5) m、**yM 自赤道起算**）；11600 行 × 9985 列，RowsPerStrip=1，未压缩。
- 正射：`NAC_DTM_APOLLO17_MOSAIC_5M.IMG`，PDS3 附着标签（RECORD_BYTES=19970，^IMAGE=2 → 偏移 19970），uint16 LSB，与 DTM 同网格。
- 下载源：`pds.mcp.nasa.gov` 网关（im-ldi 源站对密集 Range 请求 429 限流，Retry-After 3600s）。

### 2.2 勘误一：标签与 TIFF 头 StripOffsets 差 1 字节

PDS LBL `^IMAGE = 93472`，但 TIFF 头 `StripOffsets[0] = 93471`。按 LBL 读取会得到系统性错位 1 字节的乱码浮点（数值呈 ±1e30 量级）。解析器改为**从 TIFF 头动态读 strip0 并抽验条带连续性**（行 n 结束偏移 = 行 n+1 起始），不再信任 LBL。

### 2.3 勘误二：大块 Range 拼装不可靠（重要，后续禁止复用）

- 4 字节小 Range 读取在 pds.mcp 网关上稳定，且跨主机一致，可作真值探针；
- **4 MB 大块 Range 拼装出现内容漂移**：同一偏移不同请求返回不同内容，打包文件出现远距离重复值；据此得到的站点高程 −1113.3 m 是**假值**（真值 −1690.9 m）。
- 结论与既定路径：**整文件单流下载（curl 断点续传）+ 本地裁窗 + “三位一体”自校验**（本地复读 = 打包值 = 远程小范围读数，逐位一致，diffPacked=0）。
- `.gitignore` 增加 `/data/`：原始整幅文件（~800 MB）与行段缓存只在本地 D 盘，不入库。

### 2.4 打包产物（`public/data/dem/apollo17-v1/`，入库 ~10 MB）

窗口：列 [4382,5582) × 行 [5181,6381)，1200×1200 @5 m（6×6 km，全有效）。

| 文件 | 内容 |
|---|---|
| `height.f32` | float32 高程（5.76 MB），min **−2712.2** / max **−878.2** m |
| `valid.u8` | 有效位掩码（1.44 MB），窗口内全 1 |
| `ortho.u16` | NAC 正射 I/F uint16（2.88 MB），max 65530 / 均值 466.5 |
| `metadata.json` | schemaVersion 2：sourceStrip0=93471、sourceRowBytes=39940、**全文件 SHA-256 溯源**（DEM 与正射各自）、窗口仿射、PDS 数据集标识 |
| `admission.json` | `admitted-2026-09-24-3point-remote-crosscheck`（验收脚本三点交叉通过后写入；缺失时运行时如实标注 requires-source-and-registration-review） |

**真实锚点**（三位一体校验值，远程=打包 逐位一致）：
- 站点 (20.35°N, 30.78°E)：取整像元 −1689.826 / 双线性 **−1690.906**；
- 站点东 2 km：−2018.15（节点双线性 −2018.74）；
- 站点北 2 km：−981.22（节点双线性 −980.99）；
- SW/SE 窗角 −2585/−2687 m：谷地向东南下切，与 Taurus-Littrow 地貌一致。

### 2.5 勘误三：错误值回填

Range 假值时期写入的站点/量程断言已全部回填真值：`src/contracts/landing.ts`（elevationDatumOffsetM −1690.9、elevationRangeM [−2712.2, −878.2]、provenance、subtitle“真实 DTM 降落”）、`tests/r5-lunar-landing.test.ts`、`tests/p1-physics-metric-core.test.ts`（P1-09 断言 (−2000,−1400)）、`scripts/verify-p1-physics-core.ts`（P1-WEB-02 同步）。

## 3. 运行时改动

| 模块 | 内容 |
|---|---|
| `src/surface/RasterTerrainSource.ts`（新） | 单例；`load()` fetch 4 文件 + **SHA-256 校验拒绝缓存投毒**；`sampleHeight(lat,lon)` 双线性 **fail-closed**（任一贡献像元无效即 invalid）；窗外显式 datum-sphere 回退（0 m + fidelity 标注）；`buildOrthoTexture()` 99.5 分位归一化 8-bit RedFormat DataTexture（flipY=false，v=0=北）；`injectBuffers()` 仅测试/准入工具（注入数据同样过哈希校验）；admission.json 读取（admitted-* 前缀才覆盖） |
| `src/surface/TerrainHeightProvider.ts` | 删除高斯后端；`getHeightSample()` 返回 measured-dem 或 datum-sphere；`buildDemWindowGeometry()` 窗口网格（外向绕序，保持 P1 勘误） |
| `src/world-support/descentCurve.ts`（新） | smootherstep + **解析导数**；短大圆航点（对跖抛 RangeError）；`sampleDescent` 返回 commandedClearanceRate/TangentialSpeed |
| `src/surface/LandingController.ts` | 状态机 ORBIT→PREPARING→DESCENDING→HOLD⇄→SURFACE_LOOK→ASCENDING；**PREPARING 资源门槛**（DTM ready + 站点 measured-dem 才放行，pendingStartPose 暂存）；起点 = 当前机位地面投射（**对跖保护** dot<−0.99995 时起点经度 +1.5°）；机位 >55 km 先 8 s 接近段再 42 s 主段；**HOLD 置 userInterrupted，此后 cameraYaw/PitchDeg 为 null（保留用户视线）**；遥测 `verticalSpeedSemantics: commanded-clearance-rate` + terrain{fidelity, sourceId, admissionState} |
| `src/engine/SolarEngine.ts` | 月谷网格异步构建（数据未就绪 visible=false，不伪造地形）；PREPARING 也进 animate 更新；位移下发条件展开（null=不动相机朝向）；`startLunarLanding()` 用当前相机→月 body-fixed 投射计算起点；select 非月球取消准备；书签 sourceVersion `2026.09-P2-DTM` |
| `src/app/LunarLandingHUD.tsx` | PREPARING 面板（装载进度 + 取消按钮）；地形溯源行（measured-dem/datum-sphere + 准入状态如实标注） |
| `src/contracts/landing.ts` | 遥测契约扩字段；站点真实数值与 PDS 溯源文案 |

## 4. 勘误四：验收脚本对正射/DEM 准入的写入语义

准入状态不是运行时自封：`scripts/verify-p2-dem-descent.ts` 在三点远程交叉 + 打包哈希全过后，把 `admission.json` 写入 public 与 dist（preview 服务的是 dist，运行期写 public 不会生效——这是联调期踩过的坑），再重载页面确认运行时读到 admitted。下降过程中（准入尚未写入时）遥测显示 requires-source-and-registration-review 是设计内诚实标注。

## 5. 验收

- 单元：125/125（20 文件，含 `tests/p2-dem-descent.test.ts`：导数数值微分一致/往返/端点/对跖拒绝/哈希不符拒绝/真实锚点 ±0.1/窗外 fail-closed/正射尺寸）。
- 实机：`scripts/verify-p2-dem-descent.ts` **10/10 通过**，0 控制台错误，fps 128.6（详见交接 §4）。
- P1 回归（P2 改动后复跑）：9/9 通过，0 控制台错误，fps 124.7。
- 目检：80（1.7 m，NAC 正射纹理清晰、地形趋势与数据一致）、81（500 m 地平线在画面 60–65% 高度、微起伏）、83（书签恢复，底部带 35% 亮、maxLum 250）；82 触地帧地面无直射光呈黑（该模拟时刻站点处于阴影段，见交接 §5.2），HUD 触地状态正确。
