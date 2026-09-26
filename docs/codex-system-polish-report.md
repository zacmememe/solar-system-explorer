# Codex 系统收口：材质加载、载具投影与地表交互

任务 `F-CODEX-SYSTEM-POLISH`；用户授权 Codex 接手主力实现，zcode 已停止。base `adae9e9f8c4212838454833057dd7d8ff830dd40`；产品候选 `f6ade0df25a8fcef94db9da9b2a1941df23c0bd9`，分支 `codex/restore-observation-experience`。本报告及后续交接提交只记录证据，不改变产品候选。

## 对上一轮的判断

zcode 的三个方向成立：补片共享光照、toast 不截获点击、静海统一着色并混合全球底图。但交付证据还不能直接当成验收结果：

- 两个旧性能探针的浏览器回调引用了未定义的 `label`，异常后采样 Promise 不完成。等待超时不能证明地表渲染卡死。
- 旧轨道探针以 `renderer.info.render.frame` 作分母；本项目每个用户帧有多个世界切片和展示 pass，所以 5.5–5.6 ms/帧结论无效。
- `after/02-agl-293km.png` 的 HUD 实际约 167km，文件名不足以绑定机位。统一着色改善有图可见，严格同机位的幅度比较需重新取证。
- 一次交付不足以对模型做可靠排名。本轮保留其实现方向，修补加载顺序与边界条件；后续仍应要求可复现、固定版本的正常 UI 证据。

## 本轮具体修复

1. `SolarEngine.ts` 中建立生命周期稳定的月面光照 uniform。静海地形先就绪、全球月球材质后换装时，地表仍同步太阳方向与补光。月/火各站盖板与补片在本体换装时一起更新，诊断引用不再指向已经释放的旧材质。
2. `HolePatchMaterial.ts` 对 ShaderMaterial 与普通回退材质都执行淡出。贴图还没到时，普通补片不能一直不透明地压住真实地形；补片自身透明度仍独立，材质工厂返回真实类型。
3. `MoonMaterial.ts` 静海边缘采用两轴平滑权重的乘积，改善角部权重导数的折线，高清中心保留权重 1。未新增或虚构探测器数据；未扩到其他站点。
4. `DepthSliceRenderer.ts` 展示投影完全独立于世界 near/far。新增世界 near=10、飞船在相机前 2.1 单位的反例，要求飞船确实进入视锥；同时保留原来的月面极小 near 反例。
5. 着陆遥测可折叠，窄屏初次打开默认收起详情，暂停/继续/返轨按钮保留；手机站点选择与行动按钮增至 44px，切站即时反馈。toast 在组件卸载时清理定时器。
6. 三个旧探针改为有限时限的 RAF 采样，异常也关闭自身浏览器；人工诊断机位用权威物理半径而非挖孔网格包围球，明确与正常 UI 验证区分。修正全量材质检查把普通工具文件当作 GLSL 源码的误报。

## 验证与证据

所有截图、JSON 与浏览器资料位于 `D:\solar-evidence\codex-system-polish\`，不随项目同步或推送。生产包 `index-fOXLnsJE.js`，SHA256 `06bd77acfc6a0b1908eb024db9274f6c120dea525c3bfb33bc8b2c6fe2758b8a`。此包对应产品候选；提交前最后一次源码修改是切站即时反馈。`round1/` 早于这条 UI 修改，包 `index-DVMy5T9r.js`；该目录不能冒充最终候选全量验收。

- `npm test`：45 文件、281/281 通过。初次全量有一条材质检查误报，修正范围后重跑全量通过。
- `npm run build`、`tsc --noEmit`：通过。构建保留既有大 chunk 和 fs/path 浏览器外置提示，未改依赖版本或部署配置。本机缺失 npm shims，使用已有依赖执行离线 rebuild 恢复。
- `round1/report.json`：正常 UI 静海下降、HOLD、触地、拖动、返轨；贴图延迟注入；390×844 窄屏详情展开/收起与返轨，通过，页面/控制台错误 0。读到的当前材质共享引用和本体 alpha=1 均正确。
- `round1` 单个 headless Edge 会话：悬停、地表和返轨均采到 120 个 RAF 间隔，均值约 16.67ms，P95 16.8–16.9ms，引擎帧数 121。这是本机短时约 60FPS 的浏览器节奏，不能写成 GPU 耗时、手机实机性能或所有场景性能。
- `final-foundations/report.json`：13 组全部通过，包含基础操作、三个窗口尺寸、六站正常下降/拖动/返轨/跨星球书签恢复和地形加载失败后退出。正常页面与控制台错误 0；故障注入的 2 条资源错误单列。该 runner 在产品提交前启动，报告中的 HEAD 仍为 base + dirty；整个过程使用同一 `index-fOXLnsJE.js`，被测产品源码即后续冻结的 `f6ade0d`。
- 六站从相机射向实际显示三角面的离地距离约 2.02 / 1.64 / 1.60 / 1.72 / 1.95 / 1.22m（按陶拉斯、哈德利、静海、耶泽罗、维多利亚、盖尔顺序）。均通过既有 ±0.6m 检查；它们不等于全部精确 1.7m，源 DEM 与抽稀显示网格的残差仍存在。
- `final-vehicle-mobile/report.json`：最终包、`SLOW_TEXTURE=1`、`VERIFY_VEHICLE=1`，正常鼠标操作登舰 ISS、前往月球、下降/HOLD/停驻环顾/返轨与手机详情折叠/展开/退出均通过，页面及控制台错误 0。三个性能样本都是 120 个 RAF 间隔、121 引擎帧、均值约 16.67ms、P95 16.8ms。采样结论只限本机短时 headless Edge。
- `final-observation/report.json`：`VERIFY_SURFACES=0`（六站旅程已由 foundations 覆盖），12 项通过，含地球正常拖动、土星、全景、火卫一的方向/角尺寸契约和切换；页面/控制台错误 0，Edge 153.0.4234.48，同一最终 bundle。

作者已实际看过 `round1/02-transition-held.png`、`04-surface-horizon.png`、`08-mobile-orbit.png`、`09-mobile-hold.png`：静海明暗过渡较协调，地平线无原先整块盖板；斜视仍有细直线边界，近地影像仍模糊。窄屏折叠可降低遮挡，但不等于完成手机端重设计。`final-foundations/taurus-littrow-left.png` 可见地平线连续、近处影像模糊；`vehicle-formation.png` 中 ISS 位于地球前方，暗面较暗仍是已观察限制。其他图在实际查看前均保持 NOT_OBSERVED。

继续查看 `final-foundations/hadley-rille-left.png`、`tranquility-base-left.png` 与 `jezero-left.png`：月面近景和哈德利远山可辨认网格折面，Jezero 石块暗部对比较强。流程可玩不等于这些画面已达到最终质感；以上保留为明确视觉限制，不写成“六站无瑕疵”。

也已查看 `victoria-duck-bay-left.png` 和 `gale-murray-buttes-left.png`：能辨认陨坑、坡面与石块层次，仍有明暗反差较强、石块轮廓生硬和近地纹理不足。没有用自动像素检查替代这些视觉判断。

最终包额外目检 `final-vehicle-mobile/02-transition-held.png`、`04-surface-horizon.png`、`09-mobile-hold.png`：ISS 在约 308km HOLD 与地表均完整显示在前景（太阳能板背光较暗）；静海的直线边缘仍然可辨认；手机默认收起详情、三项操作可见，中央星球观察空间增加。作者仅接受这几项局部改善；独立技术/视觉批准仍未发生，整体阶段体验仍待用户复玩。

也已查看 `final-observation/earth-drag-2.png` 与 `saturn.png`：这两张代表图未见非目标天体闯入或黑色碎面遮挡；土星环影边缘仍有细小分段/锯齿，明确未修。未逐帧目检全部动作，不能据此承诺所有角度均无异常。

版本绑定：src tree `27b3e53a9f9f2fc6e658d6eb0d9591961d550bf4`；public tree `0b55260aeabad916c7fdc675bc68cfaeb6a28b79`；package-lock blob `115f620d5cc5e31ac21ff6746376fc51e75bd04c`。证据根目录 `verification-manifest.json` 另存版本与报告索引。自动化只记录行为，不自授视觉批准。独立审查状态为待复核（未获得批准），产品候选保留在任务分支。

## 接下来按这个顺序做

1. 固定候选的独立复核：最终证据中挑静海过渡、六站地平线和载具代表帧；旧性能结论不得继续沿用。作者自验不构成独立批准；本轮不合 main、不部署。
2. **静海剩余直边**：在相同站点、相同时间、HOLD 稳定机位下区分几何边界、法线差和源图亮度差。先测边界两侧，再决定外环法线/高度连续化或低频色调匹配；不直接放大透明带、抬高地形或关深度。
3. 土星阴影锯齿：独立固定机位任务，核对阴影边缘采样与抗锯齿。当前未实现或验收。
4. 近地清晰度：源数据 2–5m 分辨率限制保留；中心细化网格只改善几何，不能宣称增加真实影像分辨率。手机横屏/触屏手势仍需实机体验。

回退本轮产品修复可 revert `f6ade0df25a8fcef94db9da9b2a1941df23c0bd9`；不回滚其他作者文件、不重写历史。回退后须重新构建，旧性能报告的勘误仍应保留。
