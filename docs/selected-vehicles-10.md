# 五款载具接入：构图、选择与可靠性

本轮起点`26bf7ed`，载具子任务base `857a975`，任务分支`codex/restore-observation-experience`。用户已确认五款和阿波罗赴月三舱组合，并明确授权按系统优化计划依次完成。根会话唯一代码作者；并行子代理只读复核，无并行代码改写。此处为作者交付，不替代跨工具独立批准；未合main或部署。

## 可体验的结果

机库仅提供ISS、Cassini、Voyager 1、Juno和Space Shuttle。四份外部模型按需加载，沿用06轮装配与材质候选，保留ISS 07–09轮太阳翼、舱段与资源生命周期改进。航天飞机默认尾部斜后方伴飞。模型按构图展示，参考尺寸与模型测量分开；没有通过米制标定的模型不展示1:1网格和米制热点。无质量合格的完整Apollo CSM+LM，故第六席继续留空。

旧书签中的阿波罗LM、Webb、Hubble、天宫和未知载具引用归零，保留天体、位置和时刻，不偷换为另一款。地表书签继续清除载具。下降、HOLD、地面和返轨途中禁止选择、显示或恢复伴飞，回到太空需主动重选。

## 资产与实现

`public/assets/models/selected/provenance.json`保存来源URL、源/派生SHA、许可链接和变换说明；`scripts/import-selected-vehicles.mjs`仅从既有D盘06轮包导入，经固定SHA检查，不重新下载。四份GLB共25,536,656字节，纹理/二进制均内嵌，无隐藏外部依赖。

|模型|字节|SHA-256|
|---|---:|---|
|Cassini|5,951,756|52c0211f47ebe0bbd6304672d3642ab74ff348097b1caf37d30ead47561b7cc5|
|Voyager 1|3,271,116|5c83c0af8a7ef08f992caac3572b02c98156f25be94445982d7e2f21d627055b|
|Juno|9,727,448|7e16e9494fe65c3c4ac058a65a02cf0f890f3c613a1d3c051597337b123b5af4|
|Space Shuttle|6,586,336|948ccb7e7a15f830eff9029f8f8dd993b99f4d50d31e96dc53533085d8a0a221|

来源姿态在派生包中已烘焙一次，运行时不重复旋转；保留材质单/双面与透明语义。加载器分离`metricRoot`与外层展示wrapper，实际模型缩放不被伴飞构图覆盖。主场景继续由CameraController控制相机，独立展示裁剪pass保持。

Juno与航天飞机资料使用[NASA/JPL Juno facts](https://www.jpl.nasa.gov/news/press_kits/juno/facts/)、[NASA Juno尺寸图](https://www.nasa.gov/wp-content/uploads/2015/05/jul2016.pdf)、[NASA Shuttle技术资料](https://ntrs.nasa.gov/api/citations/19940023701/downloads/19940023701.pdf)。Juno展开尺寸约20m/高4.5m、发射质量3625kg；Shuttle尺寸按轨道器跑道构型，模型是轨道构型，未猜填质量。NASA来源不等于NASA对项目或修改的认可。

## 实测暴露并修复的两个取景问题

1. 原主场景伴飞锚点`x=.48,z=-2.1`在390×844竖屏偏出右边，真实几何投影最大NDC x达2.34。新锚点随水平FOV收纳，旋转包围盒含上下浮动包络计算展示缩放并缓存，窗口变化才重算。以太阳翼和天线完整优先；桌面Voyager/Juno因保守包围盒分别约保留原跨度81%/76%，作者实看最终图，仍能辨识结构与模型特征。
2. Juno机库默认自转最低顶点NDC y=-1.03382，确实裁断底翼。固定maxDim倍数镜距改为绕旋转原点包围球、真实宽高比和90%留边计算安全镜距；旋转中距离固定，避免呼吸缩放。换包时立即到安全距离，避免从旧模型近机位穿过新包；ResizeObserver覆盖容器改变并在销毁时断开。原无wheel实现，删去“滚轮缩放”误导提示。

## 验证和接受范围

生产包`index-1LuvLXhH.js`，CSS`index-Bt8Ba0lj.css`。最终证据根`D:/solar-evidence/selected-vehicles-10`。

- `final/report.json`：正常UI五款机库双光照、伴飞、同时开预览再关闭、结束伴飞；Juno三次拖动；五款390×844预览/伴飞及恢复1920×1080，共33图、错误0。投影断言只证明入框，作者另看Juno日光/伴飞、Voyager伴飞与Shuttle竖屏。较小机库取景为保留自转余量的取舍，不是细节增加。
- `reliability/verification.json`：12项通过/非预期错误0。注入Cassini模型503、缺纹理503、请求延迟；失败不能伴飞，重试恢复，成功预览后的主加载失败仍如实报错，关闭重开与快速切ISS不会被迟到包覆盖，取消主加载后不会复活。注入网络错误单列。
- 单元/回归：63文件430项通过，包括资产实际字节/内嵌完整性、非1模型尺度、材质语义、历史书签、宽窄屏投影、预览完整旋转包络、ResizeObserver清理与迟到加载。
- 同工具只读复核：实际五款三种aspect、完整浮动范围的所有顶点均在NDC ±.92内；Juno三aspect×36自转角×三俯仰在±.90内。无GPU复核；不把这份检查当独立视觉批准。
- `space-only/report.json`：Cassini真实外部包正常UI火星下降→HOLD→触地→返轨→重新伴飞→地球/月球切换→月球下降取消，11项/10图、错误0。地面直接setter与旧地表书签另外作为明确标记的防御诊断，均不能恢复载具；太空书签可以恢复选中的Cassini。
- tsc/Vite构建通过，保留既有fs/path browser external与大包警告。没有实施全量32天体新一轮视觉验收或低端设备性能验收。

## 重跑与回退

先`npm test`和`npm run build`，冻结dist后串行运行`node scripts/verify-selected-vehicles-10.mjs`、`node scripts/verify-vehicle-reliability.mjs`、`CHECK_FIXED=1 VEHICLE_ID=cassini node scripts/verify-vehicle-space-only.mjs`（Windows用`$env:`设置）。脚本自建临时preview，正常退出/finally关闭浏览器与服务；`EVIDENCE_DIR`指定新的D盘目录，保留旧失败证据。

本项作为单独提交可revert，三项地形/石块/性能提交保留。不要删除用户书签，退回旧代码后旧引用仍可由历史程序处理。未来作者先读唯一queue与本报告，沿用素材哈希，不重新旋转/归一化源包，不以照明补丁掩盖模型边界问题。
