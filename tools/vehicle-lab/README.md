# 载具隔离样机

用途：同机位比较素材、材质、反面、真实光照和伴飞占屏，不是六款正式上线。最新舱体和伴飞方向见 `docs/vehicle-detail-08.md`；五款接入范围见 `docs/vehicle-preflight-06.md`。ISS舱体/太阳翼已同步当前游戏；Shuttle等新款仍为样机。

08轮验证：`node scripts/verify-vehicle-detail.mjs`；对照页：`node scripts/report-vehicle-detail.mjs`（需已有baseline和game证据）。Shuttle `formationRotation`只作用于展示根节点，不可烘焙或再次叠加源轴向；ISS后续导出使用08新包。

从项目根目录运行：

```powershell
npm run vehicles:lab
```

打开终端显示的 `http://127.0.0.1:5212`。关闭终端服务用 Ctrl+C。第一次缺少缓存时：

```powershell
npm run vehicles:lab -- --fetch
```

缓存默认在 `D:/solar-evidence/vehicle-lineup-plan/models`，可用 `VEHICLE_MODEL_DIR` 指定外部目录。逐个校验 `assets.json` 的 SHA-256；已有文件指纹错误时停止，不自动覆盖。NASA 舱门图片从同套旧版源归档中提取，使用系统自带 `tar`，不安装工具。文件完整性校验失败不会使用白模或替代载具。

验证与静态比较页：

```powershell
npx vitest run tests/vehicle-lab.test.ts
node scripts/verify-vehicle-lab.mjs
node scripts/report-vehicle-lab.mjs
```

证据默认 `D:/solar-evidence/vehicle-prototypes-05`，可用 `EVIDENCE_DIR` 覆盖。验证启动现有 Edge，使用证据目录中的独立浏览器配置并在完成后退出；可用 `EDGE_PATH` 指向其他已安装的 Chromium。验证通过后生成 `载具样机评审.html`，可直接双击，无需开服务。

样机的“原文件”不装 Shuttle 附件，“装配版”包含舱门和五个喷管但保留原材质，“仅改材质”方便隔离错误法线的影响。两组对照不能互换解释。单太阳光关闭环境反射与辅助灯；伴飞辅助光是展示照明，并非航天器实测照度。单模型静帧的 draw calls 不等于游戏帧率。

生产接入前仍须核对米制尺度、载具 ID 与旧书签、机库入口、只在稳定太空允许显示、实际游戏光照/性能与独立审查。这里的相机只属于独立实验页，不控制游戏 `CameraController`。

06轮：朱诺修正与五款贴图内嵌包（仍是接入准备）：

```powershell
node scripts/verify-vehicle-preflight.mjs
node scripts/report-vehicle-preflight.mjs
```

默认输出 `D:/solar-evidence/vehicle-preflight-06`，包含 `载具进度与朱诺对比.html`、定向截图、`models/*.glb` 和来源/派生哈希记录。导出与重新导入必须保持几何和外观；不是仅凭成功写出GLB就通过。所有模型仍保留源单位，轴向与居中已烘入，不可重复应用原始profile旋转。ISS包作外观复现，生产优先沿用原程序模型。
