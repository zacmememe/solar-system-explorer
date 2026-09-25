# 基础体验收口与后续执行约束

任务 F-EXPERIENCE-FOUNDATIONS；作者/临时值班为当前 Codex 会话，zcode 保持暂停。用户授权继续系统验证、修复基础体验并在完成后推送。目录为原项目目录，分支 `codex/restore-observation-experience`，base `5cdd8f0e06d5eb653bd861239cd9590e3c0ca144`。保留其他作者未跟踪文件。

## 范围与先验约束

本轮只收口已有功能：日常观星、输入接管、时间/HUD 一致性、已有六站地表链路、书签与载具往返。不新增天体/资产/框架，不升级依赖，不部署。正常推送任务分支供后续固定版本审查，不用作者自测代替独立 main 批准。

1. 先用实际 UI 建立失败样本，覆盖拖动/缩放、快速切星、取消、暂停/恢复、观察模式、窗口缩放；诊断读取引擎，用户操作通过 UI。
2. 复核书签跨系统恢复、地表保存/恢复及六站资源切换；不可从 UI 到达的功能明确登记，不以私有调用冒充用户入口。
3. 修复已证实的缺陷，保留失败前证据；共享相机/时间/参考系的改动先写不变量，再加反例测试。
4. 最终生产构建重跑适用路径，逐张观察代表画面。自动行为、作者视觉、独立批准、用户体验分开。
5. 为 zcode/Anti 留下短的执行准则、复现入口、统一检查命令和交接模板；避免继续累积互相矛盾的“已通过”。

不变量：相机仍由 CameraController 写入；HUD 展示引擎已生效状态；用户输入可打断自动任务，取消不改选其他天体或让镜头漂移；书签恢复先建立对应参考系与资源，再恢复机位；同一地形切片几何/碰撞/视觉采用一致的空间与资产语义。失败必须可见且可退出。

证据统一在 `D:\solar-evidence\experience-foundations-20260925\`，浏览器沿用 Edge，无安装。回退按本轮独立提交 revert，保留 base 与原始证据；不要覆盖用户/zcode 文件。

## 实测记录

### 已复现并修复的链路

| 玩家行为 / 故障 | 根因与本轮处理 | 证据 / 反例 |
| --- | --- | --- |
| 下降中轻拖就突然换朝向 | 导引四元数接管时仍从旧 yaw/pitch 计算；改为先读取当前可见方向再施加拖动 | `experience-input.test.ts`；小量输入对应约 0.01rad，旧实现约 2.325rad；真实 UI 的下降→轻拖→HOLD→继续 |
| 下降实际 1×，左下仍显示 50×；用户改速被退出覆盖 | 移除 React 的第二份时钟；HUD 消费引擎帧；用户改速撤销下降的临时倍率所有权 | `01-before-hold.png`；单测和六站 HUD/引擎同值断言 |
| 多站点只有自动最近站，不容易从正常入口到指定站 | 给已有六站添加显式选择入口，保留自动最近站作为默认；站点选择仍由到达/资源/状态机约束 | runner 全部走 dropdown 和实际着陆按钮，无私有机位摆拍 |
| 月面/火星书签返回了机位却没恢复地形与任务，或冷启动失败 | 先准备对应站点资源，再恢复参考系、相机和 SURFACE_LOOK；恢复可被新导航撤销，失败保留当前视角；经度统一为合法范围 | 六站跨星保存/返回，Hadley/Victoria 冷重载；`bookmark-restore-safety.test.ts` |
| 冷重载书签改变暂停/倍率 | V3 增加可选播放状态并验证；旧书签未记录时保留当前播放设置，不强制迁移 | V3 持久化反例及冷重载 UI 断言 |
| 机库说已登舰，主画面看不到载具 | 机库的全局加载代次与引擎局部代次混用；主场景用自己的迟到回调守卫 | `vehicle-lifecycle.test.ts`；最终图必须实际看到 ISS，不能只检查 vehicleId |
| 太阳背后标签穿盘、地貌观察局部照明不一致 | 标签按完整视盘遮挡判定，不把星环当不透明球；地球基础材质与瓦片使用同一观察模式 | `label-visibility.test.ts`，最终太阳/地貌观察图 |
| 火星地平线上出现巨大竖直色板 | 射线命中 `mola-l1-window-rim`；原代码在 DEM/抽稀网格边界外采样，把 invalid 的 0m 拉成约 2.5km 高墙；接缝改为采样实际可见三角网格，闭合边界不外推 | `jezero-inspect.png` → `jezero-seam-fixed.png` 同机位；`terrain-seam-height.test.ts` |
| 地表转头后遥测朝向不变、1.7m 被显示为 2m | 地表角度从实际相机更新；只在变化时通知；米级高度保留一位小数、坐标明确 E/W/N/S | 六站环顾后的 HUD/相机一致断言 |
| 窄屏找不到月球入口、退出 canvas 后指针状态易残留 | 窄屏卫星栏重新定位；指针捕获及 cancel/lostcapture 防误拾取 | 390×844、844×390 图；未把桌面鼠标自动化冒充真机触摸验收 |

### 验证版本与结果

- 本轮 base：`5cdd8f0e06d5eb653bd861239cd9590e3c0ca144`；分支 `codex/restore-observation-experience`。最终完整 candidate 由唯一队列记录；本文件随候选提交，不填写自引用哈希。
- `npm test`：43 文件、263 项通过。`npm run build`：通过；保留既有 fs/path 浏览器 externalization 与大 chunk 警告，不写“零警告”。
- 冻结生产 JS：`index-hWJF-uBo.js`；CSS：`index-BVD9hWX9.css`。最后一轮报告目录为 `accepted-candidate/`（目录名称只标识最后一次候选，不授予独立批准）。测试报告中的 commit 是启动时 base，dirty 列表如实保留；用冻结 bundle 与最终候选的源码对应关系绑定结果。
- Edge `153.0.4234.48`，1440×900，单 GPU 验证会话：`FOUNDATION_CASE=all` 的 13 组全部通过，包括六站正常 UI 下降/轻拖接管/继续/环顾/书签跨星恢复/返轨、Hadley/Victoria 冷重载。`accepted-candidate/report.json` 正常页面/控制台错误均为 0。
- 故障注入单列 2 条预期资源错误（请求失败、DTM 加载失败）；再次以 `FOUNDATION_CASE=faults` 等待 HUD 实际出现“装载失败”后截图并通过，见 `fault-ui/`。这次仅补测试等待条件，运行时 bundle 未变；第一次错误截图拍早，不能证明错误文字已出现。
- `VERIFY_SURFACES=0` 的观星专项 12 项通过，`physical-sky/report.json`：地球拖动四方向、土星、全景、火卫方向/角尺寸与转场，页面/控制台错误为 0。六站已单独全跑，不重复下降。
- 土星终态短采样 2014.5ms / 121 引擎帧，RAF 间隔 P95 16.8ms；这是 headless Edge 的墙钟间隔，不是 GPU 计时，也不是与旧版相比的性能提升证明。
- 六站实际网格净空：Taurus 2.024m、Hadley 1.644m、Tranquility 1.598m、Jezero 1.721m、Victoria 1.947m、Gale 1.217m；源高程眼高均 1.7m，符合本轮 ±0.6m 检查范围。
- `accepted-candidate/source-manifest.json` 保存冻结运行时代码/runner Git blob 与 bundle SHA-256；提交后另写 `candidate-binding.json` 核对。故障 runner 最后一处只增加等待错误文字的断言，单独记录其新 blob 与补验报告，不覆盖原始 manifest。

### 作者实际看图范围（不是独立批准）

- `accepted-candidate/`：`orbit-sun`、`orbit-saturn`、`viewport-390x844`、`viewport-844x390`、`vehicle-formation`；Taurus `ground`；Hadley `ground` / `bookmark-restored`；Tranquility `ground` / `right`；Jezero `ground` / `left` / `right`；Victoria `ground` / `right` / `bookmark-restored`；Gale `ground` / `left` / `right`。
- `physical-sky/`：`earth-drag-2`、`saturn-drag-1`、`overview`；`fault-ui/terrain-unavailable`；根目录 `jezero-inspect` 与 `jezero-seam-fixed` 的原故障机位前后对照。
- 上述画面中已观察到：地面连续不透明、没有原 Jezero 高墙；载具模型出现；地表朝向/眼高可读，错误原因可见；所看观星图没有原先的异系统巨大穿模。其余自动截图未逐张目检，仍为 NOT_OBSERVED；未录像逐帧审查整个六站过程，不写全帧视觉接受。

### 中间失败记录与证据边界

- `core-initial/`、`sites-initial/`、`production/` 是开发过程，含脚本缺陷：拖动恰等于而未超过阈值、未等待 HUD 发布、保存后选中旧书签 ID。已修正脚本，不把这些误报算作产品缺陷，也不引用其中通过项当最终验收。
- `final/` 实际是倒数第二次构建 `index-XPnHfaQu.js` 的回归：12 项行为通过、正常错误为 0，但逐图观察发现 Jezero 高墙。保留这个反例，说明自动状态正确仍可能视觉错误。最终证据只认本节明确绑定的版本。
- 所有动作使用正常 UI；只读引擎做机位、状态与地面射线诊断。故障注入独立标记，预期资源错误另列。脚本始终输出 `visualAcceptance: NOT_OBSERVED`，人工观察另记。

### 本轮不声称完成的体验

- 近地贴图模糊、地形 LOD 细节与接缝可辨，程序碎石只是示意。真实数据的采样精度不会因为测试通过而变成照片级地表；不靠加噪声或放大几何掩盖。
- 眼高 1.7m 是源高程语义；验收另测眼睛到实际抽稀三角面的距离（容差 0.6m），不把两者说成完全一致。
- 手机窗口已检查基础入口与溢出，仍拥挤；触屏手势、所有弹窗与长时间移动端体验未全面接受。
- 土星环阴影仍有细线锯齿，属于后续视觉打磨项；本轮不改阴影框架或隐藏星环。
- 独立技术/视觉/架构批准未发生，整体体验待用户复玩。允许正常推送任务分支供后续审查，不自行合 main、不部署。

### 接力与回退

后续先读 `docs/experience-foundations.md`、本记录和唯一队列。zcode 负责可反证的逻辑/生命周期/数据，Anti 负责逐帧观察和批准范围内的视觉修改。当前优先复核已有六站；不要绕过 pending 切片上限扩站。发现新缺陷时保留同机位、同时间与同版本证据。

同步纠正了唯一队列顶部的过时项：P3-T5 已在 41d1c6b/a494b8b 实现，不能仍标 READY 让后来者重复下载/实现；半径专项先读 a42e28e 审计与当前物理观察修复，不再直接按 P3b-A 的旧数值改代码。该修正不授予旧切片独立批准。

回退本轮独立提交即可恢复 base；上轮观察空间修复与入口修复分别保留在 `5cdd8f0`、`ddd6145`，不要连带重置。保留 zcode 原有未跟踪文件；没有自动推 main、改历史或变更仓库可见性。
