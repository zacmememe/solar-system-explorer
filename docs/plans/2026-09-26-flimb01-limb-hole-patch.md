# F-LUNAR-LIMB-01 修复记录：月球落区球缘凹陷（挖孔补片）

任务/作者：F-LUNAR-LIMB-01 / zcode sess_625dc0df。分支 `codex/restore-observation-experience`，base=本项起点 HEAD（a1e3be1 之长辈同 followup.md 的 d9e4492 线；准确 commit 见交接页）。证据目录 `D:\solar-evidence\F-LUNAR-LIMB-01\`。

## 现象与用户证据

用户实机反馈"月球降落区在球缘出现凹陷"，并提供两张 1440p 实机截图（`user-reference/image-*.png`，复制自会话缓存）：着陆区所在区域随拖动转向球缘时，呈**矩形暗块**；转到边缘时**啃掉月盘轮廓**形成凹陷。站区为静海基地下拉选中态（轨道视角，月盘半径约 450px）。

## 根因（代码级，可证伪）

月站栈的挖孔球在 `buildHoledMoonSphereGeometry` 中按 L1 窗界+PAD 0.35° 对齐 2.8125° 格线挖孔（`TerrainHeightProvider.ts:302`）。孔洞的正常覆盖层是 L1 区域网格+窗缘裙圈+边界裙边（全部共享 `lolaMaterials`）与 DTM 窗网格；而 P3b-E/P3-T5b 的**距离渐显门控**（`SolarEngine.ts` animate，DTM 8→36px、L1 0.35→1.3px smoothstep）在站点距离 ≳1500km 时把这些覆盖层全部隐藏（opacity→0）。此时孔洞只剩**孔底盖板**兜底——它是低于 datum 2.1–4.2km 的同心小球，仅在近天底视角能填满孔的投影；斜视/球缘方向视线穿过孔洞的冲击参数落在盖板球之外，直接透出星空/暗面。两个门控的原始目的（消除远看亚像素闪烁）本身正确，缺陷是**隐藏覆盖层时没有球面级的填充层**——孔洞暴露是门控生命周期的空窗，不是真实负地形（站区 −2.6km 相对半径仅 0.15%，盘缘 0.5px，不可能构成可见凹陷）。

激活态语义（`activateMoonSite`，`SolarEngine.ts:618`）：只有激活站挂 group 可见性并吃门控；默认激活站为 taurus——用户在下拉选静海但未（重新）着陆时，看到的是默认站孔洞在盘缘的暴露，与用户截图形态一致。

## 修复（局部可见性生命周期，不触碰 LOD 架构/datum/深度）

1. `TerrainHeightProvider.buildSphereHolePatchGeometry`（新增）：保留被挖孔剔除的三角形（三顶点全在孔界格线内），与挖孔球构成**原球面的不重不漏三角面分区**——同顶点/法线/UV，接缝零裂缝，跨 ±180° 接缝（Victoria 类）同样成立。
2. `buildMoonSiteStack`/`buildMarsSiteStack`：盖板之后挂补片网格（`${siteId}-hole-patch`），**与本体共享材质**（同 shader/光照/纹理；材质换装处同步）。
3. animate 门控块（月/火镜像）：`patch.visible = (dtmOpacity < 0.999) || (l1Opacity < 0.999)`——细级覆盖层任一未全显时补片以原球面填孔；两者全显时隐藏让位真实地形。不透明渲染，无透明排序/明暗一致性问题。

不改变：DEM 数值、datum/碰撞、门控阈值、LOD 层级结构；不隐藏落区；不全局关深度。盖板保留作深层兜底。

## 检查记录

- PASS：`tests/moon-hole-patch.test.ts`（4 项：三角面分区不重不漏/顶点同源/跨接缝/退化孔界）。
- PASS：相关地形回归 `p3t5-lola-regional`、`terrain-seam-height`、`s4b-jezero-terrain`、`s5-mars-multisite`、`s5-mola-l1`、`s5-apollo11`、`s5-apollo15`（7 文件 65 项）。
- PASS：`npx tsc --noEmit` 零错误。
- PASS（行为）：探针 `scripts/probe-flimb01-limb-repro.ts` 正常 UI（按钮/下拉/真实拖动/滚轮/返轨）——修复后同机位盘缘轮廓光滑、`patchVisible=true` 与门控态联动正确。
- NOT_OBSERVED（作者不自封视觉结论）：修复前后关键帧的观感可接受度待 Codex 看图。
- 证据边界：A-lit 时间扫描与滚轮缩放为人工机位干预，探针输出与文件名如实标注；正常 UI 序列与人工干预分开。

## 回退

单项 commit revert 即可（新增函数+挂载+门控开关，无共享路径改动）；补片测试随 commit 一并回退。
