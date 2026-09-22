# 调试经验与回归记录 (Debug Notes)

## [Review export] 双击环境找不到 Git

- 现象：双击 `导出Pro审查材料.bat` 报 `spawnSync git ENOENT`，在首次 `rev-parse` 时退出，本次尚未创建输出目录。
- 根因：Codex 运行环境临时把其内置 Git 加入 PATH，普通 Windows 双击环境没有该路径；此前只在 Codex 环境验证，未覆盖桌面启动。
- 修复：导出器自动探测已有 Git，可用 `REVIEW_GIT_PATH` 指定路径；BAT 在 PATH 缺少 Node.js 时沿用 D 盘现有安装。保留退出码，只在成功后写入 `review-exports/LATEST.txt`。
- 回归：`node scripts/verify-review-export.mjs` 在隔离仓库中用仅含 Windows 系统目录的 PATH 执行实际 BAT，验证 Git 确实不在 PATH、导出成功、ZIP 可读，以及后续失败不会更新成功路径。

本文档依照 `AGENTS.md` 规范建立，用于长期记录工程关键调试经验、根因分析、修复策略与回归用例，防止历史经验在后续迭代中丢失。

---

## [Assets] 资产校验管线中的 ESM 模块与元数据校验顺序

- **现象**：
  1. 运行 `tsx scripts/verify-assets.ts` 时报错 `__dirname is not defined`。
  2. 测试用例 AST-03 期望抛出“缺少必要的署名”错误，但收到 404 网络下载错误。
- **复现条件**：
  在 `package.json` 设置 `"type": "module"` 的现代 Node 环境中直接使用 CommonJS 全局变量 `__dirname`；在下载网络资源之后才进行元数据字段合法性检查。
- **根因**：
  1. Node ESM 环境下原生不存在 `__dirname`，需使用 `fileURLToPath(import.meta.url)` 导出。
  2. 原逻辑先发起 HTTP 下载，再检查 metadata，导致针对非法或缺失字段的资产请求先行触发了外部网络调用。
- **修复**：
  1. 使用 `fileURLToPath` 定义 `__filename` 与 `__dirname`。
  2. 将 `credit`、`licenseUrl` 与 `sourcePage` 的空值守卫逻辑前置到函数最开始，未通过门禁的资产直接阻断，不发起网络请求。
- **回归用例**：
  `tests/assets.test.ts` 中 `AST-03: 缺失关键授权与来源字段必须被拒绝准入`。

---

## [Camera] 相机控制器单一写入与命令单调性

- **现象（历史教训）**：
  在异步纹理加载、模拟时钟推进或用户快速切换时，相机可能会被旧动画拉扯、重置或自作聪明地“自动回正”。
- **根因**：
  多个模块（UI 重渲染、TextureLoader 回调、定时器）并发调用相机 API，缺乏唯一责任人和自增令牌保护。
- **修复**：
  1. 全局只有 `CameraController` 能写入 `camera` 对象。
  2. 引入递增 `commandId`：当用户发起新操作或在飞行途中拖拽/缩放时，旧飞行立即中断，旧的异步 Promise 就算完成也不会夺回视角。
  3. 严禁任何形式的空闲自动归位定时器。
- **回归用例**：
  `tests/camera.test.ts` 中的 `CAM-01`、`CAM-02`、`CAM-03`、`CAM-04`。

---

## [Scale] 坐标系双精度与 GPU 局部化

- **现象（历史教训）**：
  若把太阳系动辄数亿公里的绝对坐标直接送到顶点着色器（Float32），会产生严重的浮点抖动与网格撕裂。
- **根因**：
  GPU 32 位浮点精度在极大数值下有效小数位不足。
- **修复**：
  CPU 端保留双精度公里数值，传给 GPU 前统一减去当前观察区域原点（Focus Origin），再按 `1 unit = 1000 km` 换算为局部渲染坐标。
- **回归用例**：
  `tests/astronomy.test.ts` 中的 `SCALE-01`、`SCALE-02`。

---

## M0 里程碑验收总结记录 (2026-09-20)

| 验收编号 | 验收项 | 预期标准 | 实际执行与结果 | 状态 |
|---|---|---|---|---|
| **ENV-01** | 本地服务构建与运行 | 零报错启动/构建，可见 3D 地球与月球 | `npm run build` 成功通过，生成 dist 生产包 | **PASS** |
| **ENV-02** | 探测 WebGL2 硬件能力 | 获取真实 GPU 渲染器与规格 | 探测到 RTX 4060 Laptop GPU 与 Radeon 780M，支持 WebGL2 | **PASS** |
| **ENV-03** | 依赖锁定与离线可复现 | 固定 lockfile，无外部 CDN 运行时依赖 | 生成 `package-lock.json`，无 CDN 依赖 | **PASS** |
| **AST-01** | 地球/月球 2K 真实贴图核验 | 真实图像解码，尺寸 2048x1024，SHA-256 计算 | Earth (767ee1...) & Moon (f7130a...) 真实解码并写入清单 | **PASS** |
| **AST-02** | 拦截假图片与 HTML 404 | 解析文件头，拦截非图像与截断流 | `tests/assets.test.ts` 拦截测试通过 | **PASS** |
| **AST-03** | 缺少来源/授权强行报错 | 字段不全拒绝准入生产 | `tests/assets.test.ts` 缺失字段拦截通过 | **PASS** |
| **AST-04** | 本地同源离线可用 | 静态资源均在 `public/assets/` | 资产路径与文件实体验证通过 | **PASS** |
| **CAM-01~04** | 相机单调性与防抢控制 | 唯一控制器、支持打断、防竞态 | `tests/camera.test.ts` 4 个测试全数通过 | **PASS** |
