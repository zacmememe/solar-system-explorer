# P2 证据索引（D-P2-EVIDENCE 汇总，2026-09-23）

被审候选：`0dbf65a62e7b71a6d0e370af03f92eac0ee1e1a5`（base `7de3a68313f219afb1e45eb983510341c88326c9`）。
原始工件在本地 `artifacts/pro-review/`（`.gitignore:54` 不入库）；本索引入库供审查者定位，评审需读取工件时在本机取或走 `npm run review:export -- --with-images`。运行环境：本地 `vite preview`（dist）+ Edge headless 1440×900。

## 证据项

| # | 工件（artifacts/pro-review/ 下） | 内容与结论 | 产生脚本（提交） |
|---|---|---|---|
| 1 | `batch-p2-dem-descent-report.json` | 实机 10/10：网格 160801 顶点/正射 1200²；三点远程交叉 diffPacked=0；1.7m/500m 非黑；近/背侧地球仰角 +52.55°/−54.78°；25/50/75% HOLD 冻结→触地 AGL 1.7 / MSL −1689.2 / measured-dem；返轨；异日期起点连续；书签 −1690.9；admission 重载 admitted；fps 128.6 | `verify-p2-dem-descent.ts`（0dbf65a；报告产生时代码与 0dbf65a 一致，stamp 为提交前） |
| 2 | `batch-p1-physics-core-report.json` | P2 改动后 P1 回归 9/9，0 错误，fps 124.7 | `verify-p1-physics-core.ts`（0dbf65a） |
| 3 | 截图 `70/71/72`、`80/81/82/83(+82b/82c)` | 70=1.7m 站点（29.5% 采样亮）；71/72=地球圆盘居中/书签恢复；80=1.7m 真实正射纹理（底带 75% 亮，maxLum 250）；81=500m 地平线 60–65% 高度；82=触地月夜光照呈黑（HUD 正确，另见勘误注 2）；83=书签恢复（底带 35% 亮） | 各 verify 脚本内置截图 |
| 4 | `batch-p2-cancel-paths-report.json` + 截图 `84/85` | 真实 UI 失败/取消路径 3/3：装载停滞→PREPARING 不放行+UI 取消回 ORBIT；DEM 404→fail-closed（诚实错误日志/网格隐藏/门槛不放行/可取消/无未处理拒绝）；干净重载回归正常 | `verify-p2-cancel-paths.ts`（1dc03ca2477cd54c32402c752f708aabdd5be43f） |
| 5 | `batch-p2-boundary-controls-report.json` | 边界/NoData 控制点 5/5：四角+北/东边中点远程 PDS 读数=打包值逐位（diffPacked=0）且页面统一入口采样一致（<1e-3）；窗外紧邻点 datum-sphere 回退 0m 而远程真值 −2098.8/−1958.4（无泄漏）；valid.u8 全 1 | `verify-p2-dem-boundary-controls.ts`（本提交） |
| 6 | `86-p2-descent-demo-mjpeg.avi` + `batch-p2-descent-demo-fingerprint.json` | 代表录像 78.6s@16fps（MJPEG-AVI 无重编码）：启动→25/50/75% 暂停→触地（MSL −1689.2，admission admitted）→返轨；0 控制台错误。指纹含运行时状态（相机模式/网格/帧计数/里程碑遥测） | `record-p2-descent-demo.ts`（本提交） |
| 7 | 单元测试 | 125/125（20 文件），含 p2-dem-descent 9 项（导数数值微分/对跖拒绝/哈希不符拒绝/窗外 fail-closed/真实锚点） | `npm run vitest run`（0dbf65a） |

## 审阅注意（防误读）

1. **高空 HOLD 时 MSL==AGL 是正确语义**：下降中途机位的地面投射在 DTM 窗外，datum-sphere（0m 基准）如实回退；触地时站点 measured-dem，MSL=AGL+地面高程（1.7−1690.9=−1689.2）。
2. **82 触地帧地面全黑**：该模拟时刻站点处于阴影段（显示比例光照几何，P1 交接 §5.2 已知问题），非数据/渲染缺陷；同站点有光照时刻见 80/81/83。
3. 录像为 MJPEG-AVI（无音频）；如需 H.264/更小体积需引入 ffmpeg（未安装，避免为证据材料加依赖）。

## 仍缺的独立验证（Q-P2-REVIEW 输入就绪，等待审查者）

- 跨工具技术审查（N 级最低要求；H 级需 Codex/适配 Pro 定向架构复核）
- 独立视觉验收（P1、P2 两切片合计，待视验 2/2 达上限）
- 独立数据复核（边界点已补齐；如需更多控制点可由审查者指定坐标复跑 `verify-p2-dem-boundary-controls.ts` 的 POINTS）
