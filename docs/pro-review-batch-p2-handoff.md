# P2「真实月球山谷与连续下降」执行交接（zcode，2026-09-23）

基线：本地 main `7de3a68`（P1）。任务：Pro 交接包 P2（真实 LROC DTM 地表 + 连续下降）。
计划与执行勘误：`docs/plans/2026-09-23-p2-real-dem-descent.md`（§2 含 Range 拼装不可靠的调查结论）。

## 1. 提交

- Commit：见 `git log -1`（本文件随同一提交入库；commit message 前缀 `feat(surface)`，尾标 `(P2)`）。
- 范围：源码 8 处修改 + 4 个新源文件 + 打包数据 5 文件（~10 MB，含全文件 SHA-256 溯源）+ 2 个脚本 + 1 个测试文件 + 2 份文档。
- 不含：`/data/`（原始整幅缓存，.gitignore 新增）、`artifacts/pro-review/`（**既有 `.gitignore:54` 规则即忽略，验收工件只存在于工作区**——P1 交接 §2 表格把 70/71/72 列入提交范围是不准确的，实际 7de3a68 未包含任何 artifacts 文件，此处更正）、`docs/collaboration-bootstrap-2026-09-23/`（用户/Pro 侧工作流脚手架，非本批范围）、`docs/zcode-start-prompt-2026-09-23.md`（聊天材料）。

## 2. 变更范围与源码证据

| 文件 | 内容 |
|---|---|
| `src/surface/RasterTerrainSource.ts`（新） | 单例栅格源：load() fetch 4 文件 + SHA-256 逐位校验；`sampleHeight` 双线性 fail-closed；窗外显式 datum-sphere 回退；`buildOrthoTexture()` 99.5 分位归一 RedFormat DataTexture；`injectBuffers()` 测试/准入专用；admission.json 读取（admitted-* 才覆盖） |
| `src/surface/TerrainHeightProvider.ts` | 高斯假地形后端删除；`getHeightSample()` → measured-dem / datum-sphere 二值如实标注；`buildDemWindowGeometry()` 窗口网格（外向绕序保持 P1 勘误） |
| `src/world-support/descentCurve.ts`（新） | smootherstep 参考曲线 + 解析导数；短大圆航点（对跖 RangeError）；commanded-clearance-rate 语义 |
| `src/surface/LandingController.ts` | PREPARING 资源门槛（DTM ready + 站点 measured-dem）；起点=当前机位连续（对跖保护）；>55 km 两段式（8 s 接近 + 42 s 主段）；HOLD→userInterrupted 后 cameraYaw/PitchDeg=null（保留用户视线）；遥测扩 verticalSpeedSemantics/terrain 溯源 |
| `src/engine/SolarEngine.ts` | 月谷网格异步构建（未就绪 visible=false 不伪造地形，正射 SRGBColorSpace）；PREPARING 进 animate；位移命令条件展开；`startLunarLanding()` 由当前相机投射起点；select 非月球取消准备；书签 sourceVersion `2026.09-P2-DTM` |
| `src/app/LunarLandingHUD.tsx` | PREPARING 面板 + 取消按钮（data-testid=landing-btn-cancel-prep）；地形溯源行如实标注 fidelity 与准入状态 |
| `src/contracts/landing.ts` | 站点改真实数值（−1690.9 / [−2712.2, −878.2]）与 PDS 溯源；subtitle“真实 DTM 降落” |
| `scripts/fetch-apollo17-window.mjs`（新） | probe / fetch / **pack-local** 三模式；pack-local 从本地整文件裁窗（fs.readSync 带位置）+ 全文件 SHA-256 溯源 + 三位一体自校验（local=packed=remote 逐位） |
| `scripts/verify-p2-dem-descent.ts`（新） | 实机验收 10 项（§4）；准入写入 public+dist 后重载确认 |
| `scripts/verify-p1-physics-core.ts` | P1-WEB-02 高程断言随真实 DTM 值更新 (−2000,−1400) |
| `tests/p2-dem-descent.test.ts`（新） | 曲线导数数值微分一致/往返/端点/对跖拒绝；注入哈希不符拒绝；真实锚点 −1690.9±0.1；窗口跨度；窗外 fail-closed；正射尺寸 |
| `tests/r5-lunar-landing.test.ts` | 重写：R5-00 PREPARING 门槛（注入前不放行）；注入真实 DEM 后 R5-01 站点/窗口/回退、R5-02/03 HOLD 后视线保留与 MSL≈−1689.2 |
| `tests/p1-physics-metric-core.test.ts` | beforeAll 注入真实 DEM；P1-09 断言随真实值 |
| `public/data/dem/apollo17-v1/`（新，5 文件） | height.f32 / valid.u8 / ortho.u16 / metadata.json（schemaVersion 2，全文件 SHA-256、sourceStrip0=93471）/ admission.json |
| `.gitignore` | 新增 `/data/`（原始整幅缓存不入库） |

## 3. 数据可靠性调查（Range 拼装为何被禁用）

1. im-ldi 源站密集 Range → 429（Retry-After 3600s），改走 pds.mcp 网关。
2. 网关 4 字节小 Range 稳定且跨主机一致（可作真值探针）；**4 MB 大块 Range 内容漂移**——同偏移不同请求返回不同字节，拼装产物出现远距离重复值，站点高程曾因此得到假值 −1113.3（真值 −1690.9）。
3. 定案：整文件单流下载（curl -C - 断点续传，D 盘 `/data/` 缓存）→ 本地裁窗打包 → 三位一体自校验（本地复读 = 打包值 = 远程小范围读数，逐位 diffPacked=0 × 3 锚点）。
4. 附带发现 PDS LBL `^IMAGE=93472` 与 TIFF `StripOffsets[0]=93471` 差 1 字节：解析器从 TIFF 头动态读取并验证条带连续性，不信任 LBL。
5. 错误值回填清单见计划文档 §2.5。

## 4. 验收结果

### 实机端到端（`scripts/verify-p2-dem-descent.ts`，本地 preview + Edge headless，**10/10 通过，0 控制台错误，fps 128.6**）
| 检查 | 结果 | 关键数据 |
|---|---|---|
| P2-WEB-01 DTM 网格挂载 | ✅ | visible、160801 顶点 / 960000 索引、正射 1200×1200 |
| P2-WEB-02 三点远程交叉+哈希 | ✅ | 站点/东 2km/北 2km：remote=packed 逐位（diffPacked=0），节点双线性 −1690.9/−2018.7/−981.0；packedHashOk |
| P2-WEB-03 1.7 m 画面非黑 | ✅ | readPixels 99/336，maxLum 78 |
| P2-WEB-04 500 m 画面+地平线 | ✅ | 站点仍 measured-dem −1690.9，AGL=500 |
| P2-WEB-05 近/背侧母星两侧语义 | ✅ | 近侧地球仰角 +52.55° / 背侧 −54.78° |
| P2-WEB-06 下降闭环 | ✅ | 25/50/75% HOLD 冻结（progress 0.254/0.503/0.751，AGL 49404/33412/7923）→ 触地 AGL=1.7、MSL=−1689.2、verticalSpeed=0、terrain=measured-dem/NAC_DTM_APOLLO17 |
| P2-WEB-06b 触地后返轨 | ✅ | 恢复 ORBIT |
| P2-WEB-07 起点连续+异日期 | ✅ | t=0h 与 t=300h：firstTraj=startPose 投影（10.4157/20.6462 与 7.3793/17.7436），均 DESCENDING |
| P2-WEB-08 书签恢复 | ✅ | sourceVersion 2026.09-P2-DTM，heightM −1690.9058 |
| P2-WEB-09 准入重载+帧率 | ✅ | admission=admitted-2026-09-24-3point-remote-crosscheck，fps 128.6 |

### P1 回归（P2 改动后复跑 `verify-p1-physics-core.ts`）
9/9 通过，0 控制台错误，fps 124.7；截图 70/71/72 重新生成（71 地球圆盘居中语义保持）。

### 单元测试与构建
- 单测：125/125 通过（20 文件，含新增 p2-dem-descent 9 项）。
- 构建：`npm run build` 通过（提交前与 vitest 一并复跑作为最终门禁）。
- 未执行：无（计划内项目全部执行）。

### 画面目检（四截图分区像素统计 + 图像模型语义确认）
- `80-p2-dtm-surface-1p7m.png`（1.7 m）：底部带 75% 非 黑、maxLum 250；目检确认**真实 NAC 正射影像纹理清晰**（灰度月面、坡面明暗），地形趋势与 DEM 数据一致（谷地向东南下切）。
- `81-p2-dtm-surface-500m.png`（500 m）：中带为天空，**地平线位于画面 60–65% 高度且微起伏**；底部带 48% 非黑、maxLum 250。
- `83-p2-bookmark-restored-dtm.png`：与 80/81 同模式（底部带 35% 非 黑、maxLum 250），书签恢复画面正常。
- `82-p2-touchdown-dtm.png`：触地帧地面无直射光呈黑（见 §5.2），HUD 正确显示“月表停驻·原地环顾”面板、“仰望母星地球”按钮与海拔读数；裁剪目检确认无地球圆盘在帧内（相机保留用户平视朝向，地球在 +52° 仰角不在视野）——与 P2-WEB-05/06 数值证据不矛盾。
- 目检方法备注（沿用 P1 §3.3）：像素分区统计为底稿，图像模型用于语义确认；本批 82 的 CDN 链接持续 400，改用裁剪重传 + 分区统计交叉。

## 5. 已知问题与限制（移交后续批次）

1. **触地光照（显示比例光照几何，P1 §5.2 延续）**：物理观察模式月球显示轨道半径 > 日地显示距离，近侧站点光照随轨道共旋而非真实昼夜循环；下降若发生在阴影段，触地帧地面全黑（82 即此）。同站点有光照时刻画面已确认（80/81/83）。待比例体系重构一并处理。
2. **正射纹理为单通道灰度**（NAC I/F 99.5 分位归一化 8-bit），不是彩色照片；对外口径保持“正射影像”（AGENTS.md：程序纹理不得称为探测器照片）。
3. 月面仅此 6×6 km 窗口为 measured-dem；窗外为 datum-sphere 如实标注（不隐式补平原）。其他天体无 DEM。
4. 下降为显示节奏（两段共 50 s），verticalSpeed 语义是 commanded-clearance-rate（≠惯性速度≠MSL 变化率），HUD 已如实标注。
5. admission.json 由验收脚本写入（public+dist 双写）；下降过程中准入未写入时遥测显示 requires-source-and-registration-review 属设计内诚实标注，非缺陷。
6. `/data/` 原始缓存（~800 MB）仅存本地 D 盘，不入库；重新打包走 `scripts/fetch-apollo17-window.mjs pack-local`。
7. artifacts/pro-review/ 按既有 .gitignore 规则不入库（§1 已更正 P1 交接的表述）。

## 6. 执行顺序与回退

- 执行顺序：数据调查（Range 漂移定案）→ 整文件下载+裁窗+三位一体校验 → RasterTerrainSource/descentCurve/TerrainHeightProvider → LandingController/SolarEngine/HUD/契约 → 单测（含回填真值）→ 实机验收 10/10 → P1 回归 9/9 → 目检四截图 → 文档 → vitest+build 门禁 → 提交。
- 回退：单一提交，`git revert <commit>` 整体回退。软回退（保留代码、仅去数据）：删除 `public/data/dem/apollo17-v1/` 与 dist 副本——栅格源 load 失败后月谷网格保持 visible=false，PREPARING 门槛不放行下降（HUD 显示装载失败/取消入口），TerrainHeightProvider 回退 datum-sphere 如实标注，不影响其余功能。
