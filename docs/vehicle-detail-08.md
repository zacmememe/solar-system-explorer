# F-VEHICLE-DETAIL-08：ISS舱体与Shuttle伴飞方向

2026-09-26；base `8a8b5d0bba630b990d96a7a16de25b5293064106`；作者Codex根会话；原工作目录，分支`codex/restore-observation-experience`。仅现有ISS造型细化及独立Shuttle样机构图，不增加载具或修改相机/降落契约。

## 问题与结果

用户反馈ISS主体像光滑大圆桶，Shuttle希望从尾部斜后方伴飞。正常样机UI选择、放大与伴飞能复现：ISS五个基本等长等径圆柱连续排布，接口缺层次；Shuttle在现有源轴向变换后，伴飞实际偏看机鼻。

ISS舱段移到`src/vehicles/ISSModules.ts`：不同长短/粗细、短锥肩、窄连接颈、接合圈、暗色密封层、浅凸弧形护板和凸起EVA扶手；横向实验舱区分尺寸，Cupola用六侧窗加中央窗与实体框架。保留太阳翼材质、原总体展示尺度、机械臂/桁架和相机。白色舱壳用哑光防护层表现，已用于本地游戏ISS。

参考结构：[NASA Destiny](https://www.nasa.gov/international-space-station/destiny-laboratory-module/)、[NASA Harmony](https://www.nasa.gov/international-space-station/harmony-module/)、[NASA Cupola](https://www.nasa.gov/international-space-station/cupola/)。未下载图片资产。本轮是参考真实结构的程序模型，布局、护板分块及俄罗斯段仍简化，不宣称精确在轨构型或测量级复刻。

Shuttle源尾向-X经原`YXZ[-π/2,-π/2,0]`转换后为-Z。新增仅用于伴飞的`formationRotation=[.24, π+.58, 0]`（XYZ），尾喷管、机背与侧面可见，机鼻指向左上星球构图。`profiles.rotation`未改，装配坐标、材质、几何不变。06 GLB无需重导；新伴飞姿态绝不能再次烘到源模型。此设置尚在样机，等待五款游戏接入沿用。

## 验证

- 5个相关测试文件共25/25通过：vehicles、vehicle-lab、iss-modules、vehicle-space-only、vehicle-lifecycle。新增检查实际喷管法向朝观察者、机鼻向画面内/机背可见，及有限几何/尺寸包络/合批预算/8翼保留。
- `npm run build`通过，最终`index-Cy5M-nKB.js`；保留既有fs/path浏览器外置和大chunk警告。
- `BASELINE=1 node scripts/verify-vehicle-detail.mjs`修改前记录正常UI样机7帧；默认运行记录最终7帧。正常UI到达后显式固定基线机位作受控比较，断言相机/光照一致；Shuttle材质、三角数不变，伴飞完整入框。最终浏览器错误0。
- ISS预览41→34 draw calls，2592→25672三角形。细节按6材质合批；几何增多，未用绘制次数下降宣称FPS提升。
- ISS新包`D:/solar-evidence/vehicle-detail-08/final/models/iss.glb`：2662736bytes，SHA256 `75c51981b9e0ee2a9396d16b6b2c4710f69f33756a2fd536944cd54b7199fdeb`。重导三角数一致，覆盖像素RGBA平均差0.00652/255。源单位未校准；游戏仍用程序模型。
- `EVIDENCE_DIR=D:/solar-evidence/vehicle-detail-08/game`、`BASE_SHA=8a8b5d0bba630b990d96a7a16de25b5293064106`运行`node scripts/verify-iss-solar-game.mjs`：冻结生产构建，正常UI机库两光/伴飞/随船拖动/移除7帧通过、错误0；保留上一轮太阳翼单变量诊断。未操作私有相机摆拍。

作者实看最终样机正反放大/腹部/伴飞及游戏机库/伴飞/随船。只读子复核重看最终ISS正反放大、Shuttle伴飞，端盖无碎斑、无可见悬空，无新增缺件。这是同工具定向复核，不代替跨工具批准或完整阶段体验验收。

早期失败已修：样机ESM缺少`three/examples`映射，改用既有`three/addons`；端盖仅.001层距产生碎斑，拉开可见面并用暗色短柱补实；测试误将翼面高5.35当完整包络，原桅杆实际伸到5.4，核对源码修正夹具；Euler测试数组展开类型报错已修。最终候选重新验证，不沿用失败批次。

未执行：完整天体/下降旅程、移动端、全面GPU性能、Shuttle游戏接入与Apollo。生产待视觉2/2不变；本轮是已有ISS缺陷打磨及独立样机，不自授新增功能例外。适用独立批准与用户体验接受仍待。

## 交接

证据在`D:/solar-evidence/vehicle-detail-08/`，入口`ISS舱体与航天飞机伴飞对比.html`；05/06/07页保留历史图并链接最新版。下一轮沿用当前ISS构建器（或08派生包），不要重新带回06/07旧舱体；Shuttle沿用源包和新增展示姿态，两层不能叠加烘焙。

回退本轮提交可恢复旧舱体与样机构图。其他载具、相机及用户未提交文件未改。临时服务/Edge均关闭，未合main、未部署。
