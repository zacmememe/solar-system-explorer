# HUD 时间仪表与切星倍率复核

用户希望直接在底部调速、删除重复的“位置”入口，并明确要求保留 SpaceX 启发的数字仪表感，不用下拉框。现已常驻白色倍率读数、轻量左右箭头及相邻暂停按钮；不改变天体模拟、相机或下降状态机。

- 任务：F-HUD-TIME-15，Codex 本会话唯一代码作者。
- 分支：`codex/hud-time-controls-15`。
- Base：`7878fe93dd24e7724f5b9dfb161f98d72c17bc97`，包含太阳14最终增强视图。
- 产品候选：`e7734b44d3a755be15c1acdeaa3a241017927da9`；随后仅补文档。
- 最终生产构建：`index-NiYQwq26.js` / `index-CxqX7Vwh.css`。

## 行为与源码

`src/app/hud/MissionHUD.tsx` 读取引擎发布的倍率。箭头在既有 1、10、50、200、1000、21600、86400 档之间调节，边界禁用对应箭头；暂停时改倍率不会自动恢复时间。自定义存档倍率按相邻档处理，不用展示索引冒充真实倍率。操作仍调用原来的 `onSpeed → setUserTimeScale`。高级时间面板保留白昼选时与解释，日常调速不再依赖该面板。

删除“位置”按钮、弹窗及其系统范围状态；中央空间关系小图保留。地表详情中的北向视向透镜用途不同，继续保留。CSS 调整横向空间，资料按钮不拆成两行；手机也保留暂停。大屏仍是薄底栏，未加高来容纳控件。

## 倍率叠加：本轮未复现

先测旧生产构建，再测最终候选，都通过正常 UI 选择倍率和换星，只读引擎状态作诊断。1000× 连续切 Earth→Jupiter→Venus→Mercury→Saturn→Earth，六段实际模拟时间增量均约1000×；随后200×仍约200×，暂停切到Sun、选择50×再恢复仍约50×。同一Earth自转角增量/模拟小时约0.262521，未随切星次数上升。

源码 `SolarEngine.setTimeScale` 是绝对赋值；`animate` 仅以 `deltaSec * timeScale / 3600` 积分时钟，自转从模拟时间和各天体周期计算。本轮没有依据修改这个引擎链路，也不能把“调查未复现”写成“已修复累计加速”。不同天体自转周期会造成视觉快慢差异，但是否就是用户此次感觉的根因尚未确定。

下降自动临时减速与普通跨星是两种情形：既有下降准备会临时设为1×；主动改速释放该临时覆盖。最终正常UI验证哈德利下降→HOLD→主动200×→返轨，HOLD与返轨均约200×，没有恢复旧值覆盖用户选择。

## 本轮验证与证据

- `npm run build`：tsc/Vite通过；已有fs/path外部化与大包警告保留。
- `npm test -- --reporter=dot`：63文件430项通过；不是视觉批准。
- `scripts/verify-hud-time-15.mjs`：最终生产构建正常UI验证通过，0 pageerror/console error。包括上述10段倍率采样、暂停选速、两端禁用、常驻控件、月面HOLD/返轨。
- 桌面2560/1920/1440/1024与390手机视窗截图；月面已准备好落区按钮后检查控件可点击、在视窗内且不覆盖中央图。1024/1440/1920实测内容高98px。
- 最终证据：`D:/solar-evidence/hud-time-15/instrument-final/`。主报告`report.json`；代表图`moon-1920.png`、`moon-1440.png`、`clock-upper-limit.png`、`moon-hold-time.png`。
- 作者实际看图：以上四张，确认数字/箭头仪表、资料不折行、与小图分离、窄屏最大倍率可读、HOLD操作完整。其余最终图尚未逐一做视觉判定，仍是NOT_OBSERVED；脚本报告的visualAcceptance不会自动升级。
- 旧版基线在`baseline/`。`iteration-01/`及`final/`是下拉框中间尝试，其中`final/`在落区按钮准备好后的1440宽测试检测到小图重叠并失败；均不是交付候选。新仪表布局已在相同检查通过，不覆盖旧失败证据。
- `verify-hud-arc-controls.mjs`与`verify-hud-phases.mjs`移除旧“位置”入口依赖；本轮未另跑其完整月火流程。未重验所有地表、载具/地形视觉或性能，不扩张本轮结论。

独立批准/用户体验接受仍待完成，仅交付任务分支。重跑先`npm run build`，PowerShell设置新的`$env:EVIDENCE_DIR='D:/solar-evidence/hud-time-15/recheck-日期'`，再`node scripts/verify-hud-time-15.mjs`；脚本自行关闭专用preview与Edge。日常试玩关闭旧窗口后运行原根目录BAT，构建当前本地源码。

回退仅revert产品提交`e7734b4`后重新构建；不要回退太阳14或清理其他作者文件。下一作者先看本报告、接力指引与唯一queue，从包含本候选的交付HEAD开新分支。
