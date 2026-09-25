# F-LANDING-HUD-01 修复记录：着陆入口融入底部 HUD 当前天体区

任务/作者：F-LANDING-HUD-01 / zcode sess_625dc0df。基于项 2 commit（4b1dd7c）之上。证据目录 `D:\solar-evidence\F-LANDING-HUD-01\`。

## 改动

1. `LunarLandingHUD.tsx`：抽出并导出 `LandingDockRow`——ORBIT 态（含火星 observe 兜底）的着陆选择+前往/降落/等待合成一行：`着陆：<六站原生 select> [🚀降落|🧭前往|⏳等待原因]`。复用引擎权威可用性轮询（300ms），保留全部既有 data-testid（`landing-site-select`、`lunar-landing-start-btn`、`lunar-landing-travel-site-btn`、`lunar-landing-wait`、`mars-observe-exit-btn`）与引擎调用语义（selectLandingSite/startLunarLanding/travelToLandingSite/exitJezeroSurfaceObserve）。长英文名、数据徽章、出处说明不进入常驻行（选择下拉与任务遥测面板内保留）。
2. 原四个绝对定位悬浮块（bottom:180/234 的选择器、降落、前往、等待）全部移除——中央不再有常驻面板；原 `.landing-site-picker` CSS 一并删除。
3. `MissionHUD.tsx`：新增可选 `landingSlot` 属性，渲染进底部 `.hud-target`（当前天体区），行容器由 LandingDockRow 自带（无着陆语义时不产生空节点）。
4. `App.tsx`：以 `landingSlot={<LandingDockRow engine={...}/>}` 接线真实布局。
5. `hud.css`：`.hud-landing-row` 紧凑行样式（右对齐、32px 控件高、focus-visible、等待态省略）；≤1100px 收窄 select；≤760px（手机）整行换行左对齐、36px 可点高度、等待文案允许换行。
6. 任务中遥测面板（PREPARING 取消/DESCENDING 悬停/取消返轨/HOLD 继续/恢复导线/SURFACE_LOOK 仰望/返轨）原样保留；HUD 不触碰相机与时钟。

## 检查记录

- PASS：`tsc --noEmit` 零错误；`r5-lunar-landing`、`s4c-descent-generalization`、`m1-experience` 回归 23 项通过。
- PASS（行为，正常 UI 探针 `scripts/probe-flhud03-hud-merge.ts`）：
  - 桌面 1440×900：行位于 `.hud-target` 内（rect 1048,788 360×52），选择切站即时生效；hadley（背面）显示前往/等待态；点降落→任务遥测面板出现（语义保留）；中央拖动无面板拦截。
  - 手机 390×844：行换行右下（rect 200,679 176×113，bottom 792 ≤ 844），无 safe-area 重叠，按钮 ≥36px 可点。
  - 全程 0 页面错误。
- 截图：`01-desktop-landing-row`、`02-desktop-row-tranquility`、`03-desktop-row-hadley`（等待态）、`04-desktop-center-drag-free`、`05-desktop-descent-telemetry`、`06-mobile-landing-row`。
- NOT_OBSERVED（作者不自封视觉结论）：行内排版观感、手机双行占比是否可接受——待 Codex 看图。

## 回退

单项 commit revert（UI 层改动，不涉及引擎/渲染路径）。
