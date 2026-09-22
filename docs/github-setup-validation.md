# GitHub 接入与审查导出验证

日期：2026-09-21（本机时区）；原有 HEAD：`fbdb3b22671d15d2e87ded11346f987603c5e616`。

本次保存了接入前已有的 HUD、材质、相机回归与截图等本地开发改动，并增加仓库说明、协作约定、审查提示词、执行计划模板和导出工具。原有开发改动并非本次接入操作重新实现。

| 检查 | 结果 |
| --- | --- |
| `npm test` | 8 个测试文件、37 项测试通过 |
| `npm run build` | 通过；现有主 JS 包约 918 kB，Vite 提示大于 500 kB |
| `node scripts/verify-review-export.mjs` | 通过：提交快照与工作区快照区分、新增文件、中文路径、哈希、ZIP、资产清单、差异、缺失图片提示、常见凭据拦截、参数校验 |
| 当前提交的浏览器/WebGL 画面验收 | 本次未执行；已有截图和旧报告不能视为本次验收 |
| ChatGPT Pro 实际调用 GitHub | 需在用户 ChatGPT 网页完成连接后验证 |

导出试运行暴露了测试发现范围问题：Vitest 会重复执行导出目录中的测试副本。新增 `vitest.config.ts`，保留默认排除规则并排除 `review-exports/**`；重新运行后仅执行原项目的 37 项测试，全部通过。

本地保留 `review-exports/pre-github-history.bundle` 和 `pre-github-working-tree.patch` 作为接入前历史及已跟踪文件差异备份；它们不会推送。原始备份目录与未纳入仓库的历史交接包保留在原位置。
