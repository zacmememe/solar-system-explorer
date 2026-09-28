# Pro 第18轮：固定版本与当前事实

此文件是 2026-09-28 的公开审查快照，不是本机动态队列。配套：[深审提示词](pro-review-18-prompt.md)、[任务拆分指示](pro-parallel-18-prompt.md)、[并行执行约定](parallel-zcode-anti-18.md)。

## 要读哪个版本

- 仓库：https://github.com/zacmememe/solar-system-explorer
- 本轮**产品审查固定版本**：`23e1271c23cc3144632c2bcd55d29991c0e5489a`，分支 `codex/hud-classic-a-17`。其中产品代码提交是 `84143a21d9eed1bd544f2ba8288d75f04d5d5db2`，之后仅文档。
- 本轮审查/并行指引分支：`codex/pro-parallel-handoff-18`，从上述固定版本派生，只新增/更新文档，生产代码树不变。不要把此分支上的说明更新当产品重新验证。
- 核查时远端默认分支 `main` 仍是 `516a3aa07175585a3abc28a11dfb589fa06fced1`，不含太阳14、HUD15/17；只读仓库首页会读旧进展。
- 已经匿名 GitHub API 核对 public、分支 SHA；固定 SHA 的 `docs/hud-classic-a-17.md` 返回 HTTP 200，内容含正确产品提交号。Git 远端引用也匹配。核查时间为本次交接，不保证将来仍无新增提交。
- Codex 的网页抓取工具对这两个 GitHub URL 返回 cache miss；独立匿名 HTTP 读取成功。**不能由此声称用户自己的 ChatGPT Pro 会话/连接器已测试成功。** Pro 先做实际文件读取核验；不能读就列缺口，不用聊天记忆补成“已读”。

固定代码树：https://github.com/zacmememe/solar-system-explorer/tree/23e1271c23cc3144632c2bcd55d29991c0e5489a

原文模板：`https://raw.githubusercontent.com/zacmememe/solar-system-explorer/23e1271c23cc3144632c2bcd55d29991c0e5489a/<path>`。

完整已跟踪源码归档（工具支持下载解包时才用）：https://github.com/zacmememe/solar-system-explorer/archive/23e1271c23cc3144632c2bcd55d29991c0e5489a.zip 。公开不代表全仓自动进入上下文，报告实际覆盖范围。

## 当前进展与边界

| 领域 | 已有实现/已记录验证 | 后续尚待 |
| --- | --- | --- |
| 导航与着陆 | 可打断转场、球外绕行、中途放弃从当前位置升空、卫星前景母星背景；相机统一权属 | 新候选的受影响路径仍需实测；不要先假定当前仍有老 bug |
| 地形与石块 | 实际孔边桥接、显示三角面接触/法线、CPU 双精度局部定位；程序石块明确示意 | 近地源影像物理分辨率、接触阴影和质感仍可提高；不重新改错 datum 来“美化” |
| 顺畅度 | 正射排序改等价直方图，原始 RGBA 哈希一致；历史静海准备阻塞下降 | 历史启动最长任务约 6 秒、首次换星长任务尚待归因。这是旧基线线索，不能当当前新测数据 |
| 航天器 | ISS、Cassini、Voyager1、Juno、Shuttle 五款；空间阶段限定、严格失败/取消、ISS细化及太阳翼修整 | Apollo 要完整 CSM+LM，合格模型未齐；不凑数，不恢复淘汰款 |
| 太阳 | 用户选定红黄活动增强视图、辉光、模拟时间驱动的局部活动 | 是增强示意而非太阳可见光自然色；保留选择，准确说明 |
| HUD17 | 用户选 A：左时间，中央图/阶段弧及其下沿动作，右天体/阶段主读数，轻透视 | 方向已选；作者实现自测完成，用户对实现的体验接受不能代填 |

最新 HUD17 报告记录：63 文件 434 单测通过、build 通过；月火正常 UI 各82条检查/测量记录、绕行7项、时间14采样，共59图，错误0。只证明该候选与报告覆盖的路径；不是本轮重新执行，也不是所有天体/所有体验全通过。作者实际看图8张，独立批准仍缺。

## 最小阅读集

先读 `README.md`、`docs/experience-foundations.md`、`docs/hud-classic-a-17.md`、`docs/sun-appearance-14.md`、`docs/system-polish-10.md`、`docs/selected-vehicles-10.md`、`docs/vehicle-reliability-09.md`。再按结论追读相关源码、测试和 runner。

入口：`src/app/App.tsx`、`src/engine/SolarEngine.ts`、`src/camera/CameraController.ts`、`src/app/hud/store.ts`、`src/contracts/hud.ts`、`src/assets/AssetManager.ts`、`src/surface/`、`src/rendering/`、`src/vehicles/`。不要只读入口文件就宣称完成深审，也不要为了覆盖率抄全仓文件清单。

本机 `review-exports/coordination/queue.md` 被忽略，GitHub 不提供它；不能让网页 Pro 假装读到了实时作者/进程状态。Pro 提议任务，执行者读取本机队列再领取。本快照用于选方向，不代替本机调度。

## 画面证据不在 GitHub

本地证据集中在 `D:/solar-evidence/`，网页 Pro 不能通过这些路径访问图片。需要视觉判断时，由用户向同一 Pro 会话附上少量图，或 Anti 输出带候选/机位的真实前后图。不能仅凭旧报告文字判断视觉已经通过。

可供本轮补充的既有图（都绑定 HUD17 产品候选；没有重新生成）：

- `D:/solar-evidence/hud-classic-a-17/final/moon/01-observe.png`：地球观星/左右 HUD。
- `D:/solar-evidence/hud-classic-a-17/final/moon/08b-hold-2560.png`：静海上空 HOLD。
- `D:/solar-evidence/hud-classic-a-17/final/mars/12-surface-desktop.png`：耶泽罗近地/石块/天空。
- `D:/solar-evidence/hud-classic-a-17/final/site-travel/02-site-travel.png`：同天体绕行阶段。

静态截图不能证明转场顺畅、无瞬时穿模或性能改进；这些需要时间线、轨迹/净空数值和正常 UI 连续过程。
