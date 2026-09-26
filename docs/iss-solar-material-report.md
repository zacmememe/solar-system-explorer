# F-ISS-SOLAR-07：ISS受光太阳翼近黑

2026-09-26；base `cdccb6d36f31bf6fa29295f85d81338f6e4ac7d4`；Codex根会话唯一作者；原目录、`codex/restore-observation-experience`。本轮是现有ISS缺陷修复，不增加新载具/新生产功能切片。

## 原因与修改

用户在载具样机发现ISS太阳翼也全黑。正常选择ISS、单太阳正面时复现：`VehicleMeshBuilder.buildISS` 电池片金属度0.92，结合现有深色sRGB程序纹理，基底漫反射仅剩8%。源码使用标准PlaneGeometry法线、DoubleSide，无normalMap/额外color乘暗；样机太空光没有环境反射。与朱诺同类，ISS并非严格纯金属。

受控A/B仅将ISS电池材质金属度改为0，保持纹理、粗糙度0.18、几何、灯光和曝光。受光片格恢复，单太阳背光仍暗；换到另一侧受光面可见片格。采用非金属电池表面的显示近似，不宣称实测BRDF或真实颜色。未改共享太阳翼纹理或其他载具，不通过自发光/新增补光修正。

产品差异仅 `src/vehicles/VehicleMeshBuilder.ts` 的ISS太阳翼材质，另加名称供诊断。生产机库与伴飞共用该构建器，修复已进入本地游戏；用户原启动BAT每次构建最新源码。没有合main、部署或改入口。

## 本轮验证

- `npm run build`通过；产物 `index-C-BvTvvV.js`。保留既有fs/path浏览器外置及大chunk警告，没有把有警告写成零警告。
- `npx vitest run tests/vehicles.test.ts tests/vehicle-lifecycle.test.ts tests/vehicle-space-only.test.ts tests/vehicle-lab.test.ts`：23/23通过。没有为单常量新增镜像单测。
- `BASELINE=1 node scripts/verify-iss-solar.mjs`：修改前正常UI复现并诊断注入；5组/10图通过。默认再跑最终构建器，正面/背光/受光背面/伴飞/放大5组10图通过。每对检查相机、灯光、投影、三角数、纹理指纹及非目标材质一致，发光为0。
- `node scripts/verify-iss-solar-game.mjs`：冻结生产构建、正常UI选择地球和暂停时间→机库ISS工坊/在轨光→伴飞→随船/拖动→移除，7帧通过。伴飞另注入旧材质作诊断，断言机位/模拟时刻/补光/其他材质完全相同并恢复。两套浏览器非预期错误均0；脚本退出关闭自建服务/Edge。
- 样机ISS重新导出和加载，覆盖像素RGBA平均差0；文件327572bytes，SHA256 `587a68c117cb3b66eb54ca4df7ad7d900b654f883d75d853e8ee46a77545a7df`。最新样机包在 `D:/solar-evidence/iss-solar-07/final/models/iss.glb`，替代06任务ISS包用于后续准备；原包不覆写，尚未米制标定，生产仍用程序模型。

作者实际看图：样机正面前后、背光；游戏机库两种光、伴飞前后、随船。接受范围为受光电池片可读且背光不发亮；深色源纹理仍保留，不把变亮等同高精度真实模型。

只读子复核看了最终样机5张（正面前后/背光正面/背光背面/伴飞），结论一致并独立检查生产差异范围。属于同工具定向复核，不冒充跨工具独立批准。整体阶段体验及独立批准仍待完成；本轮未重跑全部天体/降落旅程、手机或GPU性能测试，相关状态机没有改动。

## 交接与回退

证据：`D:/solar-evidence/iss-solar-07/{baseline,final,game}`，报告包含源码/构建指纹。入口 `ISS太阳翼修复对比.html`；05/06历史页加最新链接并明确旧ISS样张。

下一步五款接入时使用当前ISS构建器；不得重新启用06旧ISS材质。Apollo和其他素材进度不受本轮影响。回退本轮提交可恢复旧材质，外部原始截图保留。其他作者未跟踪文件原样保留。
