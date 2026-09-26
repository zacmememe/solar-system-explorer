# 火星远景、石块与土卫三素材

本轮按用户授权继续三项，base `b22c76bf1c8b1dea34ec6315a729e1e21e7ecae4`，分支 `codex/restore-observation-experience`。Codex 根会话单一写作者；两个子代理只读检查代码、精度反例和资产来源。没有改相机控制、物理半径、源 DEM、降落状态机或 HUD 布局。

## 远景色差

正常 UI 进入盖尔，连续下降到实际表面锚点低于550m后 HOLD。固定相机和模拟时间，分别隐藏 MOLA 区域地形、外裙和内过渡环带。偏粉平板的主体属于内过渡环带，后方轮廓属于 MOLA 区域地形。证据在 `D:\solar-evidence\mars-materials-body-assets\baseline\`，不能用之前地面机位的“隔离无差异”否定本次低空复现。

旧近景用 MeshStandardMaterial，远景用轨道球体散射及掠射边缘加光；内缘仅给全球图去饱和，没有接续 HiRISE 影像。现在区域地表近处共享 HiRISE 的光照、夜间遮光和线性雾；40–160km片元视距连续回到原轨道外观，轨道与地形共用 `marsOrbitalRadiance`，避免维护两份远距公式。这是展示过渡参数，不是气象测量。

内圈从同一 HiRISE 正射边缘渐变。局部 UV 在 CPU double 中计算，避免全球 Float32 UV 相减带来的约1m取样误差。第一版直接延长边缘行，产生公里长条纹，已判定不接受（`iteration1`保留）。修正后滤波宽度随实测覆盖之外距离按约0.5倍递增，同时保留屏幕足迹滤波；2.5km外完全交给区域图。纹理延伸只表示过渡，不增加实测覆盖或地形。

## 石块

尖片的首要原因是 GPU Float32 精度，而非岩石材质。原实例矩阵先将厘米级顶点加到行星级平移，再乘 modelView 抵消相机，细节已丢失。现在每站的 InstancedMesh 位于站点原点，CPU double先相减再写实例缓冲；径向姿态仍用绝对位置计算。月球与火星全部现有站点共用此修复，实例数、源位置、尺度、下埋比例和绘制次数不变。

独立浮点模型复现：4cm量级石块在绝对坐标下可压成零面积三角形，局部坐标保留三角形。单测另检查完整岩石的退化面以及变换前后世界位置/姿态等价。浏览器同机位旧坐标重建对照见 `iteration1/02-ground-normal.png` 与 `diag-ground-legacy-rock-coordinates.png`，可直接看到尖片恢复为闭合轮廓。

材质新增温和程序风化颗粒，固定于石块局部米制空间，按屏幕足迹衰减；无位移、假接触黑斑或新增光源。法线扰动上限约3.2°，颜色只做小幅变化。石块仍是示意分布和外观，不能称实测岩石；黑色背光面也不等于真实投影阴影。

## 土卫三

把实际程序示意外观替换为 [NASA PIA14931](https://science.nasa.gov/photojournal/map-of-tethys-june-2012/) Cassini 2012全球灰度拼图。原始地图11520×5760，本项目使用官方服务4096×2048 JPEG，1,439,555字节，未自行锐化、镜像或改色。SHA-256 `5056170fe5bcde03934c48d77db3af356e44053c3595a0d25850b494e62f9a77`。

[USGS对应产品页](https://astrogeology.usgs.gov/search/map/tethys_cassini_global_mosaic_293m)注明 Public domain / Please cite authors；署名NASA/JPL-Caltech/Space Science Institute，Roatsch、Kersten、Hoffmeister、Wahlisch。完整字段在 `sources/production-assets.json`。

网页摘要Positive West与[PDS3标签](https://astrogeology.usgs.gov/ckan/dataset/e40296c1-b4bf-46d8-86af-4b6cf0301b0c/resource/daf2b5a1-cbde-4309-9281-6e0f2d765c4b/download/tethys_cassini_mosaic_global_293m_pds3.lbl) EAST有矛盾。采用标签及地标交叉核对：中心0°，东经向右、北向上，offset=0、repeat=1、flipY=true。保持531.1km物理半径；地图投影基准536.3km不用于改天体大小。影像保留拍摄阴影、极区拉伸，非自然彩色、纯反照率或坑深模型。HUD明确这些边界，未加载时显示中性球体。

火卫一 Ernst v004 成套数据仍缺明确再分发许可。[SBMT条款](https://sbmt.jhuapl.edu/Terms-and-Conditions.php)与其链接的[JHU/APL条款](https://www.jhuapl.edu/privacy)不能用公开下载或论文许可替代资产许可；此次未入库。调查转为有明确许可的现有土卫三，并未扩展天体数量。

## 验证与交接

最终产品候选 `03b6220f2161301c9207f9a110a5b1c38ba5fd54`。生产包 `index-DFTktD8V.js`，SHA-256 `e066efe07648eef98f432e6ec8ffe78c23ad41c7c49f5e3d191e4b3ec2a82393`；CSS `index-CH4BTTPh.css`，SHA-256 `b96710955a8e3f985e8ceed9f6dfa95167b70f427139ffe871c208cd9a74cd3a`。14个产品文件、两个包、五个验证脚本/辅助文件和52个证据文件的哈希见 `D:\solar-evidence\mars-materials-body-assets\verification-manifest.json`。文本以LF归一化核对Git，防止CRLF误报漂移。

代码/自动验证：53文件343/343测试通过，tsc与生产构建通过。构建仍提示既有fs/path浏览器外置和大chunk警告，未把“构建通过”写成零警告或GPU批准。

| 冻结包行为验证 | 证据目录 | 结果 |
| --- | --- | --- |
| 盖尔正常UI下降→实际490m低空HOLD→触地→环顾→返轨停稳；同机位旧着色/旧石块坐标对照 | frozen-gale | 6张正常UI、2张明确诊断；相机/时间对照断言通过，0页面/控制台/HTTP错误 |
| 耶泽罗昼间下降/停驻、暮光/夜间、大气开关、返轨，再进入静海下降/环顾/返轨 | final-surface | 33张正常UI；0页面/控制台/HTTP错误，两站返轨相机均ORBIT_TARGET、非转场 |
| 土卫三观测图、近看、四向拖动、快速切换，以及故意注入贴图503 | tethys-final | 7张正常UI＋1张故障回退；纹理4096×2048、UV变换正确，故障时中性球体且资源状态error；3条预期故障记录，0非预期错误 |

总计49张主要证据图（46正常UI、2诊断、1故障），浏览器串行运行。`final-gale`为最后视觉迭代包CAQztaVn，与冻结包只差土卫三releaseApproved登记true→false；准确最终证据以`frozen-gale`为准。该登记保持false，待独立准入与低内存验证。旧`06-returned-normal`曾在转场中途取图，已收紧为相机ORBIT_TARGET稳定1.2秒；旧帧保留但不能当返轨完成证据。

作者视觉实际查看：冻结盖尔低空/旧着色对照/触地/返轨；此前同渲染代码的左右环顾与旧石块坐标对照；耶泽罗HOLD、地面、暮光/夜间地平线；静海HOLD、地面、返轨；土卫三默认母星背景、近看、拖动、故障回退。接受范围是粉色色差和公里条纹的减少、石块碎片恢复实体、观测图接入及日夜未出现亮岩漏光。其余未逐图查看的证据为NOT_OBSERVED，不能推广为全景视觉接受。

遗留：盖尔远坡仍宽阔平滑、局部层次断开；近地正射仍低细节，右向存在网格折面；石块仍偏椭圆光滑，未建立真实接触阴影。耶泽罗暮光右侧仍见细薄地形轮廓，尚未逐层定位，不能宣称消除全部地形破片。静海地面存在大面积低细节亮面和折面，本轮只验证石块共享路径和旅程可用，不将月面整体视觉标PASS。真实设备低内存、移动GPU、全部六站与32体本轮未重跑。

本机单浏览器、1440×900、2秒RAF采样：耶泽罗平均22.71ms/P95 34.7ms，静海19.80ms/P95 28ms。仅描述当次采样，不构成相对旧版性能改善或全设备帧率保证。

不合main的依据是 `docs/review-workflow.md:36`：“可实现、测试、冻结候选并推任务分支供 Pro/后续审查读取；不能自审合 main”。当前作者自测与子代理检查不替代适用跨工具独立批准。用户此前授权推送任务分支；本轮询问不合main原因不解释为取消该门禁。独立批准 BLOCKED；用户完整体验接受待复玩。唯一 BAT 每次构建当前工作目录源码，是否合main不影响本机看到本轮代码。

回退：revert `03b6220` 原子产品提交，证据和说明单独保留；不改写历史、不删除证据、不回滚其他作者文件。后续优先提高过渡带真实区域影像/地形覆盖，现有 MOLA 和正射分辨率上限仍存在。
