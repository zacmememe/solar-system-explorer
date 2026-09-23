# 本轮基建验证与未实施事项

验证日期：2026-09-23，Windows，本机现有 Node v24.18.0 和 Git。没有安装工具。

## 实际通过与修复

- `tests/packet.test.mjs`：21/21 通过，覆盖版本过期、自审、必需维度缺失、hash变化、路径越界、H批准缺失等。
- `tests/worktree.test.mjs`：首次9项均在建临时仓库时失败，原因是 Pro 的 Linux 测试用 `os.devNull` 作 Git global config 路径；Node 在 Windows 返回 `\\.\nul`，本机 Git 拒绝。
- 仅修改**本启动包的测试副本**：改用测试目录下独占创建的空 `.gitconfig`，关闭时移除，继续隔离用户全局配置。没有改原 Pro 交接包、产品测试或 Git 全局设置。
- 修复后仅重跑受影响的 worktree 测试：9/9 通过。合计两个测试集最终30项通过；不是声称同一次初跑全绿。

原始日志位于本机忽略目录：

`D:\Game Zac\Personal Projects\太阳系漫游\review-exports\coordination-bootstrap-tests-2026-09-23\combined-tests.tap`

`D:\Game Zac\Personal Projects\太阳系漫游\review-exports\coordination-bootstrap-tests-2026-09-23\worktree-windows-rerun.tap`

初跑日志采用 Node 默认报告格式，文件名虽沿用 tap 后缀，内容不是标准 TAP；复跑显式用了 `--test-reporter=tap`。所有临时 repo、bare remote 和清理目标都在上述已核对的 D 盘测试根下；未访问远端 GitHub。

## 使用只读证据检查器

模板 `templates/packet.json` 故意保持 NOT_RUN、空 SHA 和空 reviews，直接运行必须 BLOCKED。它不是示范已通过的产品报告。

packet里的 `evidence` 每项为 `{ "path": "相对证据根的文件", "sha256": "真实64位hash" }`。每项check引用自己的原始证据，绑定候选。独立review需要真实会话、harness、base/candidate、维度、decision、readOnlyReview和实际证据路径；不要虚构Anti/Codex会话填满字段。

```powershell
# 在项目根目录；变量先从真实候选和可信规则记录中取得。
node docs/collaboration-bootstrap-2026-09-23/tools/check-packet.mjs $PacketFile $TrustedPolicyFile $EvidenceRoot $BaseCommit $CandidateCommit
```

工具不会自动读Git确认HEAD，也不验证身份/签名。调用者独立核对 B/C、工作树和政策来源，不能拿作者修改过的政策自批。H政策还要求 independent-invariants 检查和architecture复核；按适用政策补全真实记录。

CONSISTENT 仅表示给定声明和证据文件内部一致；BLOCKED 是待满足条件，不是让作者删除必要检查。此工具不执行产品测试、不调用模型、不操作Git、不自动合并。

## 检查范围与尚未完成

- 已核对准备时只有原项目一个worktree；既有AGENTS/README/review-workflow在准备结束时与准备前哈希一致。
- 进程查询未取得有效清单，当前服务器/PID/端口未知，交给活跃作者在检查点记录。没有据此推断没有进程。
- 当前 zcode 正在持续改动业务文件，前后工作区不同是预期现场，不能宣称整个工程哈希未变；Codex本轮写入仅限启动包与忽略的实验输出。
- 未运行太阳系单测、构建、浏览器或GPU，未修改业务代码；P1文档的通过结果仅标为作者报告。
- 未建立真实工作worktree、启用队列、改变常驻规则、提交/推送、创建Issue/PR或配置权限；这些需要当前作者自然检查点后按启用步骤实施。
- 作者→独立审查→候选集成的真实项目试运行尚未完成，Anti暂不可用，不伪造通过。30项是机制沙箱测试，不替代这一步。

本次适配已可交给zcode接续；无需Codex常驻跟进。需要Codex再次介入的是具体高风险契约或两轮证据验证仍无法收敛的问题，不是日常队列维护。
