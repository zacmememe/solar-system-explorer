# F-VEHICLE-FOREGROUND-01 修复记录：展示载具与世界深度隔离 + 伴飞缩 25%

任务/作者：F-VEHICLE-FOREGROUND-01 / zcode sess_625dc0df。分支 `codex/restore-observation-experience`，基于项 1 commit（721f8b4）之上。证据目录 `D:\solar-evidence\F-VEHICLE-FOREGROUND-01\`。

> **勘误（2026-09-26，bdac3bc 复核 R1）**：本文初版声称展示 pass 使载具"不被世界 near/far 裁掉"——该声明在月面量级下不成立：展示 pass 当时继承世界分段最近切片的 near/far（near=2e-8 时末段 far≈2e-4），相机前 ~2 单位的载具整体在锥外，Codex 已用投影反例复现。修复见后续 R1 提交（展示 pass 独立投影范围 + 包围球视锥测试）；本节其余描述仍准确。原第 1 条中"不被世界 near/far 裁掉"以 R1 修复为准。

## 方案（layer 隔离 + 独立展示 pass）

展示载具（伴飞/随船）迁入专属 `VEHICLE_DISPLAY_LAYER`（layer 1）：

1. `DepthSliceRenderer.render` 接受 `displayLayer` 选项：世界 pass（单段或分段深度）一律以 layer 0 相机渲染；世界（含分段深度）完成后**只清深度**（保留世界颜色），用同一机位渲染一次 layer 1——载具不再被世界深度吞没，不在世界 pass 中重复出现，不清空世界颜色。`autoClear` 在 finally 恢复。
2. `vehicleGroup` 与每次装载的模型 `traverse` 到 layer 1（`buildVehicle`/attach 处）；纯星球观察（`PLANET_OBSERVE`）载具 `visible=false`，展示 pass 整体跳过。
3. **灯光同步启用 layer 1**（sunPointLight/ambientLight/cameraHeadlight）：three.js 灯光同样按 layer×相机掩码收集，灯留在 layer 0 会让展示 pass 里的载具成为无光照黑剪影（本轮实测发现并修复；灯掩码 0|1 对世界 pass 的收集判断无影响）。
4. 伴飞尺度首个候选：`0.85/origDim → 0.6375/origDim`（缩 25%）；随船保持原构图（0.95）不动。
5. `lastFrameRenderInfo.vehicleDisplayPass` 记录每帧是否执行展示 pass（验收/回归断言用）。

未做：全局 depthTest 开关、移动星球、重排物理遮挡；物理世界对象仍按真实深度渲染（世界 pass 不变）。模型自遮挡/光照/透明件在展示 pass 内正常（同一深度缓冲内互相测试）。无新增 GPU 资源，resize/切站/释放随既有路径。

## 检查记录

- PASS：`tests/depth-slices.test.ts` 6 项（含 3 项新增：世界 pass 不见展示层且展示 pass 末段执行/无 displayLayer 时完全跳过/多段世界逐段屏蔽展示层）。
- PASS：`tsc --noEmit` 零错误；`vehicle-lifecycle`、`r4-vehicles-pipeline`、`r1-depth-projection` 回归通过。
- PASS（行为，正常 UI 探针 `scripts/probe-fveh02-vehicle-pass.ts`）：ISS 地球伴飞拉近/拉远/拖动球缘完整可见；月球/土星（含星环、卫星标签）伴飞正常；观星模式载具完全隐藏且 `vehicleDisplayPass=false`；换 Hubble 再切回 ISS 装载互不干扰；全程 0 页面错误。
- PASS（对照）：土星同机位 A/B（`ab-before-fix.png` 修复前载具 0.85 尺度遮挡星环、`ab-after-fix2.png` 修复后 0.6375 受光完整前景）。
- NOT_OBSERVED（作者不自封视觉结论）：伴飞 25% 缩放后的观感占比是否合适、模型质感——待 Codex 看图定夺（首个候选值可调）。

## 回退

单项 commit revert；`displayLayer` 参数为可选，回退后 DepthSliceRenderer 旧行为完全恢复。
