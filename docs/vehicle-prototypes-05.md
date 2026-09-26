# F-VEHICLE-PROTOTYPES-05 · 第一批载具样机

> 后续用户决策：用户明确认为当前航天飞机可以接受，**撤回下面的素材淘汰建议并继续采用**。技术细节上限记录保留，最新状态和朱诺修正见 [F-VEHICLE-PREFLIGHT-06](vehicle-preflight-06.md)。下面是05轮历史结论，不能当作当前禁用指令。

日期：2026-09-26。作者：Codex 根会话；只读协助：vehicle_phase_audit、crewed_asset_research、appearance_audit。

目录：`D:\Game Zac\Personal Projects\太阳系漫游`；分支：`codex/restore-observation-experience`；base：`b59aa60849dcf6779857b535051db24727dd927f`。

本轮执行[已确认名单与构型](plans/vehicle-lineup-05.md)的第一步：卡西尼＋航天飞机样机、阿波罗缺件核验。六款题材仍为 ISS / Voyager / Cassini / Juno / Shuttle / Apollo CSM＋LM；Webb 已排除。**未修改 src、public、游戏入口、依赖、部署或生产相机。** 这是独立样机交付，不是六款载具上线。

## 结果与取舍

| 项目 | 本轮结论 | 尚未通过的部分 |
| --- | --- | --- |
| 卡西尼 | 保留修整版，进入下一阶段候选。作者与独立只读审查均看过主体放大的正/背/底部及原材质对照；设备、天线支架与隔热膜层次足够继续 | 天线碟面偏素、部分底盘与设备简化；实际游戏光照、性能、米制尺度和用户接受仍未验收 |
| Shuttle D | **淘汰这份素材的生产候选资格**，装配成果保留作研究。按真实安装环补齐五喷管、补门、取回缺图仍不足以精细合理 | 机腹黑底与白灰块硬切、鼻尖白圆帽、舷窗/鼻部糊状贴图、喷管浅色套筒感。需换模型与 UV，不继续靠材质补丁掩盖 |
| ISS | 作为现有造型基准预览，未改生产外观 | 原单位与真实尺寸不能混称 1:1 |
| Voyager | 本轮补伴飞构图证据，细杆保留且主体可辨 | 未完成这款的完整精修/动态细杆检查 |
| Juno | 调整样机取景角度展示三翼；原材质保留 | 单太阳/辅助光下太阳翼仍过暗，未接受其最终伴飞画面；不能以轮廓完整当作视觉通过 |
| Apollo CSM＋LM | 构型确认保持不变；明确两条 CSM 来源路径 | 尚未取得并验证合格完整源包，没有拼装成品，不用裸 LM 顶替 |

独立目视意见（appearance_audit）：最新 7 帧重新读取后，卡西尼放大仍可保留；高频亮斑比原材质克制，褶皱存在，无明显破洞、悬浮件或装配错位。取回贴图后的 Shuttle 舱门已改善，但腹面/鼻部/喷管缺陷仍足以退回。这是样机的独立复核，**不作为生产集成批准**。

## 实际实现

- `tools/vehicle-lab/`：独立 Three.js 实验页；完整结构/主体放大/伴飞占屏，正背底角度，摄影棚/单太阳/辅助光，原材质与修整版比较。
- `model.mjs` 把源变换、轴向、metricRoot、presentationRoot 分开；非 1 校准不被占屏缩放覆盖。伴飞包围体超出视口时收敛展示尺寸，保留相机位置和模型相对结构。仍未声明已完成任何模型的真实米制标定。
- 卡西尼只调整 `foil_gold/foil_gold_2`：normalScale 2→1.2，roughness .30→.36。没有自发光、没有新增几何噪声。第一版 .75/.42 过度软化，最终证据均为 1.2/.36。
- Shuttle 的 `shut-bay` 用同一彩色图同时作为底色与法线；修整版删除错误 normalMap，保留原 UV 重复。原文件/仅改材质的同机位证据专门分离此变量；关上舱门的图不用于证明舱内修正效果。
- 异步迟到结果丢弃并释放；GLB 及其外链贴图必须完整，缺图明确失败，绝不悄悄回退成白壳。资源释放也覆盖被移除的 normalMap 和共享附件。
- `scripts/vehicle-lab.mjs` 只在 localhost 服务；资产按 manifest 精确放行、哈希核验；下载/归档与截图留在外部 D 盘。`package.json` 仅新增 `vehicles:lab` 命令。

## Shuttle 装配证据与缺图修复

原图五个 GLB 在 NASA 新版仓库 revision `11ebb4ee043715aefbba6aeec8a61746fad67fa7`。两门保留整体坐标；`eng` 与 `rcs` 是以局部原点保存的单喷管，**不能把它们直接加到机身原点就算装配完成**。

独立 CPU 解码 body primitive 15（POSITION accessor 60）的三个收口环，以及 primitive 30/31（POSITION 120/124）的两个 OMS 环，得到安装中心和尾向法线；数值保存在 `shuttleMounts`。附件狭口中心分别 `(5.754056,-.217610,-.092874)` 与其一半，尾向法线 `(-.999968,-.007987,.00000105)`。外包节点按法线旋转、接口中心平移；保留资产 `<3DSRoot>` 矩阵。三个主环半径约 19.87，主喷管狭口约 19.807；OMS 环约 9.934，小喷管约 9.903。均为源单位，不是米。圈半径差小于 .12 源单位；侧后图实际看到五个喷管贴合安装基座，但历史发动机工况/可动喷管姿态未验证。

不能删除 primitive 15 来去掉背板圆图：它还包含真实收口与万向节圈体。

门 GLB 外链 `SHUT-DOO.JPG` / `SHUT-DOA.JPG` 未随新版仓库发布。沿历史找到**同五个 GLB Git blob 一致**的旧包：revision `af4cf98471052b48c404158dda28cad2aa461f3c` 下 `3D Models/Shuttle (High Res)/Shuttle (High Res).7z`，5,399,397 bytes，SHA-256 `4e459c7b59ee9923887dfc7f045ff4b757def74b0a73ebc87879a8e0c83ec114`。实际列档、提取 `Textures/shut-doors-side.jpg` / `Textures/shut-doors-top.jpg`，按材质对应补回别名。两图片 SHA、文件大小与 archiveMember 均入 manifest。最终 35 帧已在贴图完整版本上重跑；此前白壳帧不作为最终候选证据。

## Apollo 缺件核验

用户要的是服务舱含主推进器、指令舱与 LM 对接的完整赴月组合体。不退回裸 LM，不混入逃逸塔或 S-IVB。

1. [NASA Apollo Soyuz](https://science.nasa.gov/3d-resources/apollo-soyuz/)：GLB mesh 0 / primitives 12–17 可完整提取 CSM（约 14,002 三角），无需裁切。源模型 −X 尾喷管、+X 对接；1975 ASTP 构型与登月 Block II 有外部差异，官方预览的天线、喷管及表面细节不足，不能直接采用。[NASA 改装图](https://www.nasa.gov/history/SP-4225/diagrams/astp/astp-diagram-5.htm)
2. [3dpilgrim：Apollo Spacecraft Block 2](https://sketchfab.com/3d-models/apollo-spacecraft-block-2-release-2012-dec-31-fdcae17bbfa04101b86e4ce920367982)：作者页与公开 API 显示 CC BY 4.0、可下载，301,140 三角/134,325 顶点，作者声明原始 1 Blender 单位＝10 英寸。预览包含 SPS 与四碟 HGA，同时含逃逸塔、罩和内构。正常取得需登录下载；未访问用户账号、未取得源文件、未导入验证，不宣称可用成品。

后续取得源包后：保留同任务阶段的在轨壳体，去除发射附属件和不可见内构；CM/SM 以约 3.91m 壳体直径核对比例。LM 约 9.4m 是展开两脚的对角跨度，不能拿 X/Z 单轴包围盒定标。对接用真实接口锚点，不能按含天线的最高点贴合。[NASA 尺寸资料](https://ntrs.nasa.gov/api/citations/19800009716/downloads/19800009716.pdf)

如果仍需大规模重建壳体或重画 UV，就淘汰该版本；未取得高质量 CSM 时不展示“已完成六款”。

## 验证、证据与局限

证据：`D:\solar-evidence\vehicle-prototypes-05\`。最终 `verification.json` 包含 base、8 个运行输入文件的 SHA-256、模型/贴图 SHA、35 个截图状态与渲染计数。验证首尾核对输入哈希无漂移；精确源码以这些哈希对应本轮提交为准。

- **通过**：6 个变换/取景单测；`tsc` 与生产构建；35 帧浏览器实渲；正常 UI 选择、拖动、缩放；快速切换最新选择胜出；缺外链贴图必须失败且可恢复；430px 完整结构取景不裁切；最终非预期 console error/pageerror 为 0。
- **资源检查**：连续三次 Shuttle→Cassini 切换后均为 15 geometries / 8 textures，没有按切换累积。仅代表此重复序列，不等同长期内存性能证明。
- **构建警告**：已有 `manifestLoader.ts` 的 fs/path 浏览器外置警告及大 chunk 提示，未修改这些模块，不写“零警告”。
- **未执行**：生产游戏集成、机库新入口、32 天体矩阵、移动端完整交互、真实帧率与性能预算、六款真实尺度、用户体验接受。游戏业务未变，不重跑全部游戏流程。
- **失败与修复**：首轮发现伴飞包围体出框；后发现验证脚本停用拦截后未卸载监听器；再由全错误检查查出官方外链门图缺失。分别修正取景、探针清理、原图补齐及严格加载后通过。不能抹去这些失败并把最初截帧描述为通过。

作者已看最终卡西尼主体三面、太阳光、伴飞，Shuttle 三面和伴飞，Voyager/Juno/ISS 伴飞；独立目视看最新卡西尼主体三面/原材质对照与 Shuttle 三面。其余生成角度没有逐帧人工批准，不能将 35 图数量当作全部视觉接受。

## 接力与回退

本轮样机阶段已交付；下一批优先按卡西尼样机进入独立的生产准入任务，先解决 loader 的米制/展示 scale 层级与缺图失效，再接游戏状态门禁、机库列表、真实光照与 UI 证据；不得直接复制实验页摄影棚光作为太空真实照明。Voyager/Juno 分别补细杆与太阳翼质量，不一口气上线。Shuttle D 暂停，Apollo 待合格源包。

生产视觉待审切片仍按原 queue 管理，本轮未增加生产切片，也没有合并 main/部署。回退仅需撤销本轮新增样机工具、测试、文档与 npm 命令；D 盘原素材、证据保留，不删用户历史文件。
