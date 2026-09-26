# Codex 接手：现有观察与地表体验系统收口

用户本轮明确将主力实现交给 Codex。起点 `adae9e9f8c4212838454833057dd7d8ff830dd40`，沿用 `codex/restore-observation-experience`；其他作者未跟踪文件保留。任务 ID：F-CODEX-SYSTEM-POLISH。不是新增天体/部署或框架升级。

执行顺序：
1. 复核 zcode 的光照同步、toast 和静海过渡；修正无效测量。已发现 probe-fsurface-evidence 的 rAF 回调引用未定义 label，Promise 悬挂不能证明产品卡死；renderer.info.render.frame 是 render 调用计数，分段渲染下不能作用户帧率分母。
2. 用当前生产版本正常 UI 实测静海下降、停驻、拖动、返轨和帧间隔；记录 errors/机位/模拟时间/构建指纹，重资产在 D:\solar-evidence\codex-system-polish\。
3. 修复实证问题：材质异步就绪/切站、贴图混合边界与地形连续性、触地交互；必要的移动端 HUD 和载具裁剪收口。现有数据的清晰度上限如实保留。
4. 相关单测、生产构建、六站基础旅程与观星遮挡回归；查看代表图，区分作者自验与独立批准。没有证据的推断不标 PASS。
5. 分项提交和任务分支推送（沿用用户已有授权），不合 main、不部署；留下重置后可读 checkpoint、源码入口、准确候选、验证与已知限制。

遇到共享物理/LOD 架构需要重构，先落具体设计；不通过挪动天体、抬高真实地形或关闭深度隐藏缺陷。主目录仅 Codex 写代码，队列由本会话串行维护。
