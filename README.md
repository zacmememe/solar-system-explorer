# 太阳系漫游 · Solar System Explorer

仓库：[zacmememe/solar-system-explorer](https://github.com/zacmememe/solar-system-explorer)。

使用 React、TypeScript、Three.js 和 Vite 构建的浏览器太阳系探索项目。包含行星与卫星观察、镜头转场、时间控制、航天器展示、书签和探索明信片，以及六个站点的真实地形着陆闭环（月面陶拉斯—利特罗/哈德利月溪/静海基地，火星耶泽罗/维多利亚/盖尔）——着陆与地表观察消费真实 DTM（NAC 2–5m / HiRISE 2m）与 LOLA/MOLA 区域地形，遥测标注高程溯源与准入状态。

普通观星采用以当前行星系统为基准的统一线性尺度，远方天体与本系统保持模型中的方向、视大小和前后关系；“全景”采用便于导航的示意比例，切换系统的转场也属于导航展示。轨道仍是解析近似，不代表精确星历。观测来源贴图与程序生成示意应分别标明，资产出处见 `sources/production-assets.json`。

底部仪表采用大屏优先的银白任务弧：左侧地点、中央阶段与一个主读数、右侧当前操作。时间倍率以白色数字仪表常驻右侧，左右箭头直接减速/加速，旁边可暂停；中央保留空间关系示意，不再重复提供“位置”菜单。下降显示实际机位高度，落地切换方位弧；北向视向、完整仪表、白昼选时和科普资料按需展开。大屏常驻内容约98px，保留中央视野。实现与验证见[任务弧报告](docs/hud-task-arc-report.md)和[时间控件补充](docs/hud-time-15.md)。

中途放弃降落会从当前位置升空，结束后保留同侧观察位置；换落区先沿星球外侧绕行。降落保持当前昼夜，需要白昼时可在底部“··· → 时间倍率 → 切换到所选落区的白昼”主动选时。

载具仅用于太空观察。进入落区绕行或降落后自动结束伴飞，下降、悬停、地面和升空期间不显示机库或载具视角；返回高空后可重新选择，不自动带回上次的飞船。

当前机库提供ISS、卡西尼、旅行者1号、朱诺与航天飞机，模型按构图展示；阿波罗完整赴月组合仍待合格素材。接入、来源与验证见[五款载具报告](docs/selected-vehicles-10.md)，本轮地形与首次准备优化见[系统打磨记录](docs/system-polish-10.md)。

## 本地开发

日常游玩只需双击根目录的 **`启动太阳系漫游.bat`**。每次启动先执行当前项目的 `npm run build`，成功后才打开新生成的版本；无需选择模式。首次出现页面前请等待构建完成。构建失败会停在窗口显示错误，不启动旧包。端口被占用时自动使用下一个可用端口，并打开对应的新地址。

`双击启动.bat` 重复入口已移除。`导出Pro审查材料.bat` 仅导出审查材料，不启动游戏。这里的“最新”指当前本地文件；启动器不会自动拉取 GitHub 或改动尚未提交的代码。

项目继续在原来的 D 盘目录中本地开发，GitHub 保存提交后的版本。

zcode / GLM-5.3 Flash 当前接力入口：[详细接力指引](docs/zcode-glm53-flash-handoff.md)。Codex历史接手入口：[接手索引](docs/codex-resume.md)。用户已授权将产品基线`b98e909`合入main；实际作者与任务状态仍以本机 `review-exports/coordination/queue.md` 为准。

```powershell
# 已有 node_modules 时无需重复安装。
# 首次安装在 Windows 上把 npm 缓存放到 D 盘：
npm ci --cache D:\Caches\npm
npm run dev
```

- `npm run build`：TypeScript 检查和生产构建。
- `npm test`：Vitest 单元与回归测试。
- `npm run verify:foundations`：已有交互、书签/载具、六站地表 UI 回归（需先启动本地预览并设置 TEST_URL）。
- `npm run verify:hud`：全景与书签、切星/取消、准备/下降/悬停/地面/返轨的阶段仪表；默认耶泽罗，`SITE_ID=tranquility-base` 查静海；含大屏占高、手机横竖屏、二级菜单、收起/恢复焦点与跨阶段关闭。证据默认写 D 盘；冻结构建后串行运行。
- `npm run verify:realism`：火星下降/地面/天空与全部现有天体外观证据；用 `REALISM_CASE=bodies` 查32天体，`SKY_CYCLE=1` 查耶泽罗昼夜；生产验证期间禁止重建 dist。
- `npm run verify:observation`：普通观星空间比例与代表下降 UI 回归。
- `npm run preview`：预览生产构建，默认端口 4173。
- `npm run launch`：与唯一启动 BAT 相同，构建最新本地源码后打开预览。
- `npm run review:export`：导出 HEAD 提交的审查材料，不提交、不推送、不部署。

现有 `npm run test:e2e` 默认访问线上地址。测试当前本地构建时，先运行 build 和 preview，再设置 `$env:TEST_URL = 'http://localhost:4173'`。该脚本使用本机已有 Chrome / Edge，浏览器测试前应检查脚本配置。`verify-assets` 涉及外部资产下载；它不是离线检查命令。

普通观星与下降专项回归：设置 `TEST_URL` 指向本地预览后运行 `node scripts/verify-observation-recovery.mjs`。它用真实 UI 完成拖动、切星、全景、月球/火星下降及返轨；默认截图和报告写入 `D:\solar-evidence\observation-recovery`，可用 `EVIDENCE_DIR` 修改。报告中的行为检查不代替人工看图与体验验收。

## 代码阅读入口

| 路径 | 作用 |
| --- | --- |
| `src/main.tsx` → `src/app/App.tsx` | React 入口、界面与引擎联动 |
| `src/engine/SolarEngine.ts` | Three.js 场景、渲染循环、天体与 HUD 状态发布 |
| `src/camera/CameraController.ts` | 相机控制、转场、跟随与取消 |
| `src/astronomy/bodies.ts` | 天体参数、轨道位置和展示尺度 |
| `src/app/hud/`、`src/contracts/hud.ts` | HUD 界面、订阅状态、位置示意及数据契约 |
| `src/rendering/`、`src/astronomy/MoonTextures.ts` | 材质、光照与程序纹理 |
| `src/assets/`、`sources/` | 资产加载、来源和校验清单 |
| `src/vehicles/`、`src/utils/` | 航天器、明信片与书签 |
| `tests/`、`scripts/` | 回归测试、浏览器验收和开发脚本 |

`前置方案打磨/` 包含早期讨论和交接材料，不能当作当前实现的事实。当前代码、实际测试和已确认的任务方案优先。

## Pro 审视 → Antigravity 执行

后续作者先读 [体验底线与执行边界](docs/experience-foundations.md)，包含 zcode/Anti 的职责、常见反例和最小交接格式。

操作方法和 ChatGPT 连接验证见 [协作流程](docs/review-workflow.md)。可直接复用 [审查提示词](docs/review-prompt.md) 和 [执行计划模板](docs/implementation-plan-template.md)。

每轮讨论固定 commit 编号；Antigravity 执行已确认的方案，测试后提交和推送；重大审查同时提供代码材料和相应版本的画面证据。

Windows 可双击 `导出Pro审查材料.bat`，将当前已提交版本与预选截图导出到 `review-exports/`。
