# zcode / GLM-5.3 Flash 接力指引

## 1. 现在从哪里继续

**追加交接：太阳修复14。** 用户要求Codex修复白球感，并明确选择红黄、缓慢翻涌、有辉光的增强活动视图。最终产品`127b0f408ee9767e66b8a2035f1b0396da6613a0`，在`codex/sun-appearance-14`（base为main的516a3aa）；f821b74是白光中间版。先读`docs/sun-appearance-14.md`和唯一queue；下文b98e909仍是历史主线基准。本地已多出本修复，下一任务从包含127b0f4的当前交付HEAD创建分支，不盲切旧main。F-STARTUP-RESPONSIVENESS-11仍是首任务。保留增强色彩、模拟时间驱动的局部流动和示意说明，不因“太阳本来是白色”擅自回退方向，不调全局曝光或关辉光深度测试。定向runner与证据见报告。

用户明确将后续执行交给 zcode 内的 GLM-5.3 Flash；Codex 暂停常规重度开发。当前成果作为继续改进的质量基准，先理解其因果与验证方法，再做局部增量。

- 项目：`D:\Game Zac\Personal Projects\太阳系漫游`。
- 用户授权合并的产品基线：`b98e909686adf174014177a1d0ddf2271d44f59e`。此前 main 为 `2a21586045215471a41db55d41f941ed3ae681a1`；采用快进，保留中间46个提交，无冲突拼接、无历史重写。其后接力文档提交不改变产品树。
- 这次 main 合并依据用户本轮明确授权，不虚构已经发生跨工具独立审查；历史报告的“未合main”描述的是各轮交付时状态。历史待审缺口保留，不要求先回退已获用户授权的主线。
- **后续普通改动可实现、自测、提交和推任务分支；本次合并授权不自动覆盖以后所有合并、部署或数据真值变更。** 没有新的明确授权时沿用项目评审流程，不自降闸门，也不把 Codex 的在线可用作为每次正常工作的依赖。
- 唯一状态源：`D:\Game Zac\Personal Projects\太阳系漫游\review-exports\coordination\queue.md`。开工填真实作者会话、任务、目录、分支、完整base SHA。Codex已交出代码写入权；其他作者存在时先避开同目录并行写入。
- 日常唯一启动入口仍是根目录`启动太阳系漫游.bat`，每次构建本地源码成功后启动对应preview。改完告诉用户关闭旧页面再启动。不要创建另一个“最新版”BAT或静默打开旧dist。

开工读取顺序：`AGENTS.md`、唯一queue、`README.md`、本文、`docs/experience-foundations.md`；之后按任务读`docs/system-polish-10.md`或`docs/selected-vehicles-10.md`及相关源码。不必重读全部旧聊天和几十份历史方案。`docs/codex-resume.md`主要保留历史索引，本次分工以本文和queue为准。

先`git status --short`、`git branch --show-current`、`git rev-parse HEAD`、`git log -5 --oneline`，再从当前main建立短任务分支，例如`codex/startup-responsiveness-11`。若当前main已多了别人提交，先核对范围，不reset回旧SHA。未跟踪的`.zcodeignore`、旧review/plan/prompt和diag脚本是保留文件，不删除、不覆盖、不顺手提交。queue被gitignore排除是有意设计，应直接读绝对路径；不要因文件搜索忽略它而另建看板。

## 2. 先学会这四个修复案例

|案例|原来的错误与定位方法|应保留的实现与启示|
|---|---|---|
|火星地平线 `97a66d6`|正常UI默认225°复现长条；同一时刻/机位逐层隐藏定位MOLA；CPU证实旧裙圈与实际删面孔边相差112m|`MolaRegionalSource`记录真实孔界，`TerrainBoundary`桥接实际共边。不要隐藏远景、抬高地形或继续贴理想球。无症状机位不能证明修复。|
|石块 `b5ddb62`|源DEM差分5.02°处，显示三角面可达65.92°；只贴源高度会浮空/插坡|`RenderedTerrain`给出实际三角面位置与法线，按显示坡面过滤并定姿；CPU双精度完成大坐标相减，再交GPU。源物理高程与显示接触不混为一个定义。|
|影像 `857a975`|576万样本同步排序慢；不是纹理过滤问题|`orthoNormalizer`精确直方图替代排序；百分位rank、掩码时序和回退语义相同，实际RGBA逐字节验证。子步骤快145倍不意味着游戏快145倍。|
|载具 `b98e909`|竖屏固定锚点出框；Juno自转时翼尖裁断；加载成功与预览成功是两次不同事务|保留`formationFraming`、`previewFraming`、请求代际与资源所有权。投影反例证明入框，仍要看实际构图。不要以重新归一化模型或加大far替代定位。|

第一份进度回复用自己的话说明：玩家怎么触发、证据支持哪个根因、哪条约束不能动、准备用什么反例推翻自己的判断。不要只是抄“遵守规范”。随后直接执行已就绪工作，不等用户再批准一次。

## 3. 必须守住的产品行为

|领域|当前基准与不能倒退的点|最小关联阅读|
|---|---|---|
|相机/导航|世界相机归`CameraController`；从当前可见position/quaternion接续，拖动立即接管、不闲置回正；跨星检查整段相对运动，不能无解后走穿球直线。机库独立预览相机只管机库，不写世界相机。|`CameraController.ts`、`NavigationPath.ts`、`docs/navigation-experience-report.md`|
|卫星构图|卫星前景、母行星背景，留出HUD；不移动/放大母星，不自动打开暗部补光；书签保留原观察意图。|`satelliteViewDirection`、导航报告|
|下降/返轨|途中放弃从实际位置升空，不先落完再跳走；同天体换落区沿球外绕行；用户转头保留；准备取消不能随后复活。白昼由用户显式选择，暂停天体时间不等于暂停导览。|`LandingController.ts`、`docs/landing-continuity-report.md`|
|地形/精度|源DEM datum、物理高度、显示网格、AGL分清；接缝落到实际顶点/法线；无效采样不能回零当有效地形。大世界坐标米级差在CPU双精度/局部空间完成。不能用`depthTest=false`、透明平板、polygonOffset或近裁面放宽掩盖未知错接。|`TerrainBoundary.ts`、`RenderedTerrain.ts`、`ProceduralRockField.ts`、系统10报告|
|光照/资产|正射不是无阴影真色反照率，程序纹理/石块是示意；不把增强色叫自然色。不改变全局曝光、太阳方向或模拟时刻来“证明”局部修好。已登记来源/许可/哈希保持；新增素材另做来源核验。|`sources/production-assets.json`、对应材质报告|
|HUD|A任务弧为主、B位置小图展开；大屏内容约98px/含渐变110px是当前参考。左地点、中央阶段主读数、右操作；详细信息进二级菜单。消费同一帧真实引擎状态，不另推时钟/相机，不把导引速度称航天器速度。|`docs/hud-task-arc-report.md`、`src/app/hud/`|
|载具外观|只选ISS/Cassini/Voyager1/Juno/Shuttle。保留ISS舱段细化、太阳翼非金属响应、Cassini箔材及Juno太阳翼修整、Shuttle尾部斜后方。源包轴向已烘焙，不再烘一次；展示wrapper可缩放，metricRoot与源材质单/双面/透明语义保持。|`VehicleAssetRegistry.ts`、`VehicleLoader.ts`、`public/assets/models/selected/provenance.json`|
|载具状态|只在稳定太空观察可选择、显示。下降/HOLD/地面/升空撤下模型、入口、伴飞灯和提示；返轨不自动重选。pending不等于成功，模型/贴图失败不得假装成功，迟到只释放。多个ISS消费者共享CPU图像而各自持有GPU纹理wrapper。|`docs/vehicle-reliability-09.md`、`docs/selected-vehicles-10.md`|
|存档|保留地点、视线、时刻、模式；旧非入选载具引用归零，不能偷换成另一艘。资源迟到不抢用户新导航。地表旧存档不能恢复伴飞。|`contracts/bookmark.ts`、restore相关测试|

这些是结果约束，不是永远禁止碰这些文件。若实测证明当前实现有缺陷，可以提出局部修复；必须保留相邻行为、给失败反例及当前候选验证。新共享语义需单独说明，不混在“整理代码”里完成。

## 4. 后续任务按此顺序

### F-STARTUP-RESPONSIVENESS-11：第一个就绪任务

**目标：找出当前main启动最长任务的主因，只修有证据支持的一项，保持画面、数据和交互等价。** 初始允许范围是测量、定位及已批准语义内的局部性能修复；不要预先决定换引擎、重写加载框架、批量上Worker或降画质。

历史值只是线索：系统10启动最长主线程任务6147→6255ms，尚未改善；首次Earth538→577ms、Mars874→901ms也未改善。只有静海首次准备2198→798ms明确改善。程序纹理、GPU初始化目前仍是待证实归因，不能直接当根因。

执行步骤：

1. 在新分支从当前main获取基线。用现有`scripts/verify-switch-performance-10.mjs`，每次指定新的`EVIDENCE_DIR`，勿覆盖10轮基线。该脚本自行创建/关闭生产preview；采样在业务脚本之前启动。
2. 加只读计时/Performance trace或精确临时标记，区分模块初始化、程序纹理、影像解码、网格准备、资源上传和着色器编译。最终代码移除无用调试日志。`longtask`只代表主线程区间，不能据此断言GPU耗时；必要时用已有Edge/CDP，不装新浏览器。
3. 写出可推翻的归因与一个最小方案，说明输出等价及取消/重试/销毁路径。若在现有契约内，直接实现一个小提交；若需要改变相机、空间、时钟、资产准入或全局生命周期语义，留下两页以内问题包，转就绪支持任务，不能强行扩架构。
4. 同机器/浏览器/分辨率/缓存条件，前后至少三次有效配对，GPU负载串行。每轮新HTTP profile仍不等于清空OS/驱动缓存；报告注明。不得一边跑多浏览器一边报帧率。
5. 同时报告最长任务、最大帧间隔、首个可交互时刻/点击响应、总准备耗时；不得只把一个大任务拆小后宣称加载变快。首个可交互应有正常UI响应证据，不能只用DOM出现或renderer存在代替。排查是否把开机卡顿搬到首次换星、首次落区、首次开机库。
6. 回归首次静海准备、热切换、快速换目标/取消和失败后重试。图像算法变化比较原始输出哈希；上传/调度变化则固定候选、时刻、机位和模式看相应画面。性能须超出配对波动才声称改善；出现更快但丢资源、晚到抢镜、画质下降即不接受。

交付`docs/startup-responsiveness-11.md`：准确base/candidate、复现、归因/反例、前后数据及波动、变更文件、实际看图、失败与未执行、回退commit。推任务分支并更新queue，不直接推进main。无需每一步请用户确认，也不用为普通实现呼叫额度紧张的Codex。

### F-SURFACE-CONTACT-12：性能轮交付后，先单站原型

目标为火星石块接触感与近地层次，先耶泽罗一个站、一个明确缺陷。先阅读系统10，确认目前法线/坡面贴合已修，不重复改高程和网格。固定机位比较白昼/低太阳高度/夜侧、低空接近/触地/环顾。阴影应跟光照和坡面变化；固定黑贴片、全局压暗、拉高石块不构成真实接触改善。

先在隔离实验或任务分支做一个可撤回原型，量化增加的绘制/CPU/GPU成本，保留前后图供用户/恢复后的Anti看。这一步不授权永久改全局渲染架构或一次铺开六站。若当前问题主要是1–5m源影像上限，应如实说明；几何细化、锐化和噪声均不能恢复不存在的摄影细节。需要更高分辨率实测素材时先做来源/覆盖/许可调查，不伪造。

### F-APOLLO-SOURCE-13：可作为等待视觉反馈时的支持任务

第六款明确为**指令舱＋服务舱＋登月舱对接的赴月组合**。已有五款继续保留；不恢复旧裸LM、Webb或低质量占位。先读`docs/plans/vehicle-lineup-05.md`、`docs/vehicle-preflight-06.md`及`tools/vehicle-lab/`。检查官方/许可明确的源模型是否确实包含三部分、对接轴向、推进喷口、完整材质/贴图；保留来源URL、许可、源/派生SHA和单位说明。找不到合格来源就写清缺件，不承诺凑齐第六款。未经样机质量接受不加入正式名单。

当前不开始全32天体重制、新落区、大HUD改版、依赖升级或部署配置修改。已有问题先做完一个可验收闭环。

## 5. 验证按改动选，不重复跑无关全套

产品基线已有63文件430测试及build通过；浏览器基线均绑定各自候选，不能复制旧PASS作为新候选结果。只改交接文档无需再跑全WebGL；产品代码修改执行相关测试，提交候选前完整`npm test`、`npm run build`，冻结dist后运行受影响的UI路径。

|改动|优先验证|
|---|---|
|启动/加载调度|`verify-switch-performance-10.mjs`前后配对，加首次资源失败/快切取消；跨载具加载时加`verify-vehicle-reliability.mjs`|
|火星网格/石块|`mars-boundary-continuity`、`rock-topology`、`rock-local-origin`、`local-terrain-refinement`测试；`verify-surface-detail-10.mjs`用`SITE_ID=jezero`，触公共MOLA再查`victoria-duck-bay`、`gale-murray-buttes`|
|载具/预览/展示|`selected-vehicles`、`vehicle-framing`、`vehicle-reliability`、`vehicle-viewer-lifecycle`测试；`verify-selected-vehicles-10.mjs`、`verify-vehicle-reliability.mjs`、`verify-vehicle-space-only.mjs`|
|世界相机/阶段/HUD确有必要修改|相应camera/navigation/landing/hud/bookmark测试；正常UI导航、返回/换落区、阶段HUD回归。旧脚本的过时契约先核对，不能削弱断言迎合新bug。|

Windows可直接用的首任务命令（在项目根目录，先登记作者与分支；每次使用新目录）：

```powershell
git switch -c codex/startup-responsiveness-11 main
npm test
npm run build
$env:EVIDENCE_DIR = 'D:/solar-evidence/startup-responsiveness-11/baseline-01'
node scripts/verify-switch-performance-10.mjs
```

修改后另存`candidate-01`等路径。每次检查命令退出码，前一步失败就处理，不盲跑下一步。上述首任务基线有必要重跑用于配对；其他未改功能不因换作者重复拍全套。

空间限定回归需`$env:CHECK_FIXED='1'`、`$env:VEHICLE_ID='cassini'`。火星一般UI取证用`$env:ISOLATE='0'`；需要层隔离诊断才单独开，注明它不是正常UI。`verify-navigation-experience.mjs`、`verify-landing-continuity.mjs`等旧runner需要自行启动preview并设置实际`TEST_URL`；本轮10系列和vehicle-reliability/space-only默认自起preview（后者给了TEST_URL则复用）。不要混用端口或同时跑GPU工作。

可参考证据：

- `D:/solar-evidence/system-polish-10/本轮结果.html`：用户可读结果页。
- `D:/solar-evidence/selected-vehicles-10/candidate-manifest.json`：b98e909与94个源码/资产文件、生产包及3份报告的绑定。manifest中的未合main状态是冻结时记录，不能冒充现在动态状态。
- `selected-vehicles-10/final`、`reliability`、`space-only`：33图正常UI、12项故障、11项/10图月火阶段。
- `surface-detail-10/baseline-facing-225`、`bridge-*`、`final-jezero`、`final-gale-murray-buttes`：原反例与分阶段最终图，不混不同版本。
- `switch-performance-10/baseline`和`final`：17项前后记录。旧结果用来设计新测量，不代替当前main基线。

证据哈希注意：本机`core.autocrlf=true`，切分支会把工作区文本转为CRLF，旧manifest记录的是当时工作区字节（部分文件曾混合换行）。字节SHA不符要先区分换行与内容漂移；以固定Git提交/blob、资产二进制和生产包共同核对，不直接改旧manifest或忽略真实diff。本次main切换的核对记录见`docs/main-baseline-2026-09-26.md`。

GLM本轮可以实际看图，就逐图描述看到了什么、哪里改善/退步；看不准写NOT_OBSERVED，给用户2–4张关键图。原生多模态不自动代表有视觉验收能力，单测/投影/像素统计也不是审美判断。

## 6. 如何小步交付，避免把基准改坏

一次一个可归因问题；先记录基线和反例，再最小修改。失败记录保留，不能覆盖重跑后的同名报告。测试阈值不能与修复一起无理由放宽；若契约确实更新，明确旧/新含义及独立预期。不用跳过测试、隐藏目标、延长动画、自动选白昼来消除现象。

同一候选上检查差异文件清单，逐文件stage，不用`git add .`。证据/浏览器profile/缓存放D盘项目外，不把原始聊天或凭据推到公开仓库。重资产运行素材需要来源与哈希；不用为了交接额外装软件、模型或浏览器。

合适的阶段回复模板：

> 任务 / base / candidate / 分支；玩家原问题与复现；证实的根因与反例；实际改变及保持的行为；测试与UI验证的PASS/FAIL/NOT_RUN；逐图观察/NOT_OBSERVED；性能条件与波动；证据路径；下一步与回退。作者检查、独立批准、用户接受分列。

遇到两次不同假设均被推翻、无合法源数据，或必须改变核心契约才可继续：留下最小问题包、当前候选和最后成功结果，切换queue中可做的支持任务；没有READY项就结束，不空转。不要为了保持“持续执行”无限试补丁。

收尾或额度中断时记录真实会话、HEAD、工作区差异、未跟踪文件、失败/未测、PID/端口、下一条命令。只关自己启动的进程；不批量结束所有node/Edge。回退用任务提交revert，保留基线和用户数据。让下一位能从证据接续，而不是再次猜上一个模型做到了哪一步。
