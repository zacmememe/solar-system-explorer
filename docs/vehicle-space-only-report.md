# 载具只用于太空观察

F-VEHICLE-SPACE-ONLY-04。base `4e9019a61da59e1216905d15286cc2b0f28aa23d`，产品候选 `281e65d7ee7646b405bbe8fe41c91ca0133b867b`，分支 `codex/restore-observation-experience`。根会话唯一作者，子代理只读审查。

## 行为与根因

旧版正常UI从火星进入耶泽罗并落地，仍能打开机库登船，ISS直接覆盖地表视野；`baseline/04-ground.png`是作者已看反例。原引擎只按载具选择与显示模式绘制，未检查降落/相机阶段；React另存选择状态，隐藏单个按钮不足以消除残留入口、灯光、异步加载和书签恢复。

现统一由引擎决定权限并发布到HudFrame。准备、落区绕行、下降、HOLD、地表和上升会结束伴飞、释放模型、撤掉载具补光；机库、随船/伴飞按钮和“正在伴飞”提示同步退出。迟到模型被释放，即时渲染也检查权限。返轨后只重开机库，不自动带回旧载具。普通太空转场保留选择，暂隐后恢复；旧地表书签忽略载具字段，正常太空书签保留。恢复书签前结束旧落区绕行，防止错误清掉恢复的飞船。

从地表离开又取消转场时，落区状态可能已是ORBIT但实际镜头仍贴地。保留最近地表天体的锁，实际距离超过显示半径的1.08倍且进入稳定观星模式才开放；这是显示净空，不是大气层或物理太空边界。未修改相机轨迹、地形、资产、依赖或HUD设计方向。

## 验证与限制

最终候选55文件372/372测试、tsc与生产构建通过；最终Edge 1440×900旅程11项检查、10张截图，页面/控制台错误0。JS SHA-256 `ef2ae550a947124c82f7ef6128a8f2f1211f8ad82fc13fd17b3f89303b690590`。

- 单元测试覆盖五个降落阶段、地表锚点、落区绕行、加载晚到、普通转场保留选择、近地取消以及绕行中恢复太空书签。既有载具加载代际测试保留。
- 正常UI浏览器旅程：耶泽罗太空登船→下降→HOLD/观察菜单→触地→升空→返回高空无自动载具→重新登船→地球转场→静海下降中止→返回高空。单独标注的防御诊断通过公开引擎方法尝试地面登船、旧地表书签和太空书签；这些不冒充正常UI操作。
- 初次修复包 `index-BROeBT7y.js` 在 `final/`，逻辑检查通过但作者看到月球下降时还留有“正在伴飞”提示；随后补UI同步。最终包 `index-CKfEZ_r-.js` / CSS `index-CH4BTTPh.css` 使用 `final-confirmed/` 重新完整取证；取证期间未重建dist。旧基线包是 `index-VtXa3VT5.js`。
- 作者实际看过最终`final-confirmed/04-ground`、`05-returning`、`07-reboarded`、`08-moon-descending`：地面/升空无飞船或机库，重新登船后模型正常出现，月球下降无残留伴飞提示。其余最终帧只作自动行为取证，视觉NOT_OBSERVED。Jezero地面仍可见远处细长断片、模糊纹理与粗糙石块，这些另列F-JEZERO-DISTANT-FRAGMENTS-03，不属于本轮已修。月球夜侧图只用于入口与载具检查，不作为地形质量接受。
- 生产构建含既有fs/path外置和大chunk提示。未执行全六站/手机实机/性能专项；未重跑历史system-polish全旅程（只增强其阶段断言）。作者与同工具子代理审查不代替跨工具独立批准，仍BLOCKED；用户复玩待办，不合main或部署。

证据 `D:\solar-evidence\vehicle-space-only\verification-manifest.json` 绑定六个产品/测试文件、最终JS/CSS以及三组截图/报告。`baseline/`为旧反例，`final/`为提示修正前迭代，`final-confirmed/`才是最终候选证据。浏览器配置不进入仓库或manifest。

复验：`npm run build`并开启preview；PowerShell设置`$env:TEST_URL`到该端口、`$env:CHECK_FIXED='1'`、`$env:EVIDENCE_DIR='D:/solar-evidence/vehicle-space-only/<新目录>'`，运行`node scripts/verify-vehicle-space-only.mjs`。不设置CHECK_FIXED时仅记录旧行为。`probe-r1-vehicle-descent.ts`已标记旧契约并加显式运行开关，避免后续为旧测试恢复月面伴飞。回退可revert产品提交`281e65d`后重建；保留证据与其他作者文件。
