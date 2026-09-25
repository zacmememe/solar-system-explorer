# 普通观星与地表体验恢复

用户反馈：拖动观察时其他星球位置异常、穿模遮挡、黑碎片；土星球体与星环遮挡不一致；降落后地形像方块。用户已确认 zcode 停止并授权 Codex 接手修复。

- 任务：F-OBSERVATION-RECOVERY；作者/临时值班：本次 Codex 会话。
- 目录：原项目目录；分支 `codex/restore-observation-experience`。
- base：`2a21586045215471a41db55d41f941ed3ae681a1`。保留 zcode 所有未跟踪文件。
- 先分别核对 4173 旧预览包与 5199 当前源码，使用真实页面截图与鼠标操作复现；不得布置白昼/隐藏其他天体后冒充普通旅程。
- 修复顺序：普通观察的遮挡/空间 → 地表方块实际成因 → 启动版本一致性。每项依据当前实现重新判断，不直接套用旧版 Pro 片段。
- 重资产与浏览器 profile：`D:\solar-evidence\codex-observation-20260924\`。
- 验证：数学/几何反例 + 真实页面拖动切换 + 地表下降环顾 + 适当单测/build。记录已观察与未观察边界；作者自测不替代独立批准。
- 回退：独立分支保留候选，不推送/部署/改写历史；原 main 与原 dist 可作对照，勿覆盖用户改动。

## 已定位：用户入口读取旧 dist

用户明确日常使用根目录 `启动太阳系漫游.bat`。它与 `双击启动.bat` 内容相同，均调用 `scripts/launch.mjs`。原启动器默认 3 秒后走极速模式，只检查 `dist/index.html` 存在，没有源码更新检查。

旧 dist 的主包 `index-BelIaCYZ.js` 不含 `renderFrame()` 与 `lastFrameRenderInfo`，仍含不同投影共用深度的旧 `renderLayered()`。在独立旧包预览中用鼠标拖动，实际复现土星球体盖住地球而星环不一致（`04-old-orbit-3.png`）；当前源码默认轨道距离走单 pass。这个证据不能外推为所有黑片和所有地表问题均已修好。

原 dist 已完整备份到 `D:\solar-evidence\codex-observation-20260924\before-launcher-dist\`，不再用于日常启动。用户要求先保证入口正确，以便公平复验 zcode 交付；本批因此只改启动链和说明，保留当前业务源码作为对照基线。

启动修复：保留 `启动太阳系漫游.bat`，移除重复 `双击启动.bat`；取消旧包默认路径，每次先执行 npm run build，失败不启动预览；通过 Vite API 打开实际可用端口并禁止预览缓存。保留独立功能的导出 BAT。代价是每次启动多等待一次本地构建。

## 本批验证与剩余范围

- 启动回归测试 2/2 PASS（Vitest）：每次先构建再预览；构建失败绝不启动旧包。
- 真实启动链 `node scripts/launch.mjs --no-open` PASS：TypeScript 与 Vite 构建成功，实际打开服务 `http://127.0.0.1:4173/`，当前包 `index-DboTpksh.js`。构建有既有 fs/path 浏览器 externalization 与大 chunk 提示，未称零警告。
- 浏览器实际加载新包，`renderFrame` 存在，普通地球观察 `layered=false`。在同样起始球坐标和同样四次水平鼠标拖动后，`06-new-build-same-drag.png` 中地球正常挡住土星球体及环，旧图 `04-old-orbit-3.png` 则球体错误覆到地球前。两次实时时钟未锁定，不能当作逐像素冻结帧比较；两图均已人工观察。
- 页面错误收集为空；原始记录 `launcher-runtime.json`。图和旧包都位于本任务外部证据目录。
- 未修改 `src/`、贴图或地形资产。本批修的是交付入口，不认领 zcode 已完成的渲染修复。
- 普通观察的示意布局仍会让地球/土星在近景同框，这是新包也存在的空间体验缺口；近表面分层与地表方块尚未完成复现/修复（NOT_OBSERVED），不宣称整体体验验收通过。应以本批统一入口重新核定剩余缺陷。
