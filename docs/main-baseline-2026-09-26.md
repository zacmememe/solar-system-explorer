# 用户授权的主线基准与接力

用户本轮明确授权将Codex当前成果合入主线，并由zcode / GLM-5.3 Flash接力。执行方式为快进合并，保留全部提交，不删除任务分支、不改写历史、不运行部署命令。

|对象|固定值|
|---|---|
|原main|`2a21586045215471a41db55d41f941ed3ae681a1`|
|产品基线|`b98e909686adf174014177a1d0ddf2271d44f59e`|
|产品提交tree|`d189c54aed3ac56590690ed9fb6df97541d687e7`|
|范围|原main后46个提交，包含此前HUD/导航/下降/地形/载具改进；保留其中其他作者提交|
|交接文件|`docs/zcode-glm53-flash-handoff.md`；实际作者、main head与后续任务只认唯一queue|

这是用户指定的继续建设基准，不声称所有天体、设备或独立审查已全面通过。历史报告的“未合main”保留为当时状态；本记录说明本次用户授权后的变化。未来候选仍按实际风险与适用授权处理，不从这次授权推导永久自动合并/部署许可。

## 本次核对

- fetch后确认`origin/main...b98e909`为`0 / 46`，没有分叉。main快进后的Git tree与b98e909完全一致。
- 本次新增变化限于AGENTS入口、README、接手/工作流文档和此接力记录，`src/`、`public/`、`scripts/`、`tests/`、package与lock相对b98e909无差异。
- 本机`core.autocrlf=true`。切main后旧工作区SHA核对中32文件字节一致、58文件可直接归因于统一换行，4个原有源码的旧混合换行不能仅靠全LF/全CRLF转换复原原字节。没有因此修改业务代码或覆盖旧manifest；Git规范化内容diff为零。
- 在main上重新执行`npm run build`，tsc/Vite通过；既有fs/path external与大包警告保留。重建输出以下三份文件SHA均与已验证产品包逐字节一致，消除了换行转换对产物漂移的疑问。

|文件|SHA-256|
|---|---|
|`dist/index.html`|`da29558aeb1bde62b7955de9dfb99adc49029f67899692abef291c1f9d0fdef9`|
|`dist/assets/index-1LuvLXhH.js`|`6d14af3a7c603294249dd1c504cc1fbd685839d2c3593c8c7f087887c9f1fe13`|
|`dist/assets/index-Bt8Ba0lj.css`|`b1e9b7210fdea198d0c9eff6eb75792598df64d9cbea16463a5c7252a64882f1`|

产品基线已有63文件430测试通过，五款33图、故障12项、月火空间限定11项/10图通过；本次检查三份证据报告SHA仍匹配且均PASS。因产品树和重建包一致，本次不重复执行全量测试/WebGL流程，不将历史结果写成新运行。

## 保留与后续

其他作者的`.zcodeignore`、旧review/plan/prompt、diag脚本均原样留在本地且未提交。证据继续在`D:/solar-evidence/`，原BAT继续构建当前源码。下一作者从实际main创建短任务分支，先做`F-STARTUP-RESPONSIVENESS-11`，不要直接改main。当前已知余项与最小验证见详细接力文档。

本基线没有追溯补写独立批准；已有缺口与未验内容仍可在后续专项复核中补齐。需要回退时按具体任务commit做revert，先说明影响，不用reset/force把整轮用户认可的成果一起抹掉。
