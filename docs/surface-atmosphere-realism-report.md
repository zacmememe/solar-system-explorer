# 火星地表、天空与非地月天体外观

任务 F-REALISM-SURFACE-ATMOSPHERE-01。作者 Codex；base 069526e4034a7fbac656aad660aa801642f58ae6；原目录、分支 codex/restore-observation-experience。用户明确要求本轮检查现有全部天体，不新增站点。产品候选1353cf5f3cfc616872f11b991daa204734491f59；生产包index-0Mgg-RVp.js。生产包 SHA-256：401659cd5b52c71c5292bb9241f98d66ffda1d9d4bfc46b6e1f92fb7c1735f62。

## 已实施

火星天空由纯色浸染改为随高度、当地天顶方向、太阳方向及太阳高度变化的尘埃近似。白天遮住星空；日落的蓝色只限太阳附近；夜间天空变暗但尘埃消光仍在。地面与天空在曝光/色调映射之前共享线性空气色，避免地平线色带。下降、地表、返轨继续由原相机和时间系统控制。

HiRISE 单波段影像保留原字节和高程，仅加温和的风化层示意色。CPU 用双精度位置计算法线，再上传 float 几何。碎石尺寸改用有上下界的分布，减少大块堆积；触地点净空从20m缩到3m，接触位置仍取实际渲染三角形。火星石块使用更连贯的形状及180三角面；月面既有80面路径不变。站区固定米制细砂只有5/19cm两档、亮度最多±4%、法线扰动限制约2°，15–40m淡出，像素足迹过滤；没有位移、假沙丘或伪造实测细节。

夜间截图暴露了旧点光源穿过行星照亮石块侧面的问题。DTM、碎石、L1和过渡圈现在共享站区径向地平线遮光；全球火星球保留独立光照，避免观察者入夜导致另一面白昼一起熄灭。此近似不包含山体遮挡和各座远山自己的日出时刻。教学补光单列，不能用来证明自然夜景。

木卫一、土卫一、土卫二用3张官方观测拼图替换程序纹理（合计2,787,349字节）。木卫一和土卫二为增强色，土卫一为灰度；HUD明确说明，加载失败保留纯色球体。资产清单保留下载字节哈希、经纬度约定、署名与许可；新资产releaseApproved=false，等待独立准入。

太阳取消额外UV滑动、减弱日冕并用中性亮色；海王星降低旧拼图的过强蓝色，取消按亮度把几乎全图误判成暗斑的着色；木卫一移除“暗像素就是夜间熔岩”的假发光；木卫三/四和火卫一/二去掉无依据的额外染色。火卫一假沟槽位移减弱，但当前示意大坑仍有轮胎/圆环观感，不能记为真实形状验收。天王星10条主要窄环、海王星2条主要窄环按实际中心半径和宽度的代表值生成，像素覆盖率避免将窄环夸宽；反照率、光学厚度显示参数为近似，没有模拟偏心变化、Neptune弧段或极弱弥散环。

## 全部现有非地月天体审视与后续顺序

“观测加工图”不等于地形模型；下表的不足不能以测试通过关闭。

| 天体 | 当前基础／本轮处理 | 下一项有价值的工作 |
|---|---|---|
| 太阳 | SSS展示纹理，中性亮色、减晕、取消双重旋转 | 选带明确波段/曝光的光球素材；现细节仍非校准白光 |
| 水星 | SSS 2K观测加工图，保留 | MESSENGER全球图及独立高程，避免烘焙阴影当高度 |
| 金星 | SSS云层/雷达两种图，保留 | 区分紫外增强云纹、自然可见光与雷达地形 |
| 火星 | 全球SSS + 三站HiRISE/MOLA；本轮天空/地表主线 | 中间尺度影像、区域网格密度和地形遮光 |
| 木星 | SSS云带，保留 | 云带历元/色彩来源；扁率需连同遮挡与相机包围体改 |
| 土星 | SSS本体/径向环，保留前轮环影抗锯齿 | 同上，不能只缩放球体破坏环影与碰撞 |
| 天王星 | SSS，取消额外假纬带/双极帽，修主要窄环 | 有来源的季节性极帽与扁率 |
| 海王星 | SSS经验色调校正、修主要窄环 | 换入已校准可见光图；当前不是光谱反演 |
| 火卫一 | 程序图/三轴形，减弱假沟槽、坑方向符号纠正 | 真实形状模型与同坐标反照率；现坑遮罩与图仍有约7°偏差 |
| 火卫二 | 程序图/三轴形，去额外染色 | 同上，勿用规则噪声冒充实测坑 |
| 木卫五 | 程序红色不规则模型 | 真实形状/低覆盖影像，背光图不作细节验收 |
| 木卫一 | 本轮USGS Galileo/Voyager增强色地图 | 更高分辨率版本、极区插值标记；不猜熔岩位置 |
| 木卫二 | 程序冰裂线，仍显规则 | USGS观测图，先处理缺测极区黑块 |
| 木卫三 | 程序槽沟，移除假极冠 | 同上，优先替换均匀波纹 |
| 木卫四 | 程序同心坑，移除额外白霜 | 同上，保留缺测语义 |
| 土卫一 | 本轮Cassini灰度4K图 | 实际坑形；目前Herschel只有图像明暗 |
| 土卫二 | 本轮Cassini增强色4K图 | 真实冰面几何，喷流须有明确示意/波段说明 |
| 土卫三 | 程序坑/裂缝 | Cassini全球地图 |
| 土卫四 | 程序纹理 | Cassini全球地图，先补足明亮相位取证 |
| 土卫五 | 程序纹理 | Cassini全球地图 |
| 土卫六 | 程序橘色霾/近红外示意 | 真实可见光大气与近红外分别接入，检查硬边 |
| 土卫七 | 程序蜂窝不规则体 | 优先真实形状模型；尖锐三角坑壁和锁定自转均未真实复原 |
| 土卫八 | 程序双色/赤道带 | 真实图及赤道山脊，当前默认暗相位不作地表验收 |
| 天卫五 | 程序拼接条带 | Voyager地图，保留未观测区域 |
| 天卫一 | 程序正弦峡谷 | 同上，替换规则沟槽 |
| 天卫二 | 程序Wunda白环 | 同上，白环不是自发光 |
| 天卫三 | 程序长沟 | 同上 |
| 天卫四 | 程序噪声坑 | 同上 |
| 海卫一 | 程序瓜皮/规则喷口 | Voyager地图及极区边界 |
| 海卫八 | 程序箱状形/手绘大坑 | 真实形状+匹配图，避免继续增加噪声 |

地球/月球只作天空公共路径与地表返回回归。剩余19颗非月球卫星仍是程序图；没有宣称32天体都已变成真实测绘模型。

## 来源与颜色、坐标

- 火星日落局部蓝色：[NASA/JPL PIA19400](https://www.jpl.nasa.gov/images/pia19400-sunset-in-mars-gale-crater/)、[PIA00917](https://www.jpl.nasa.gov/images/pia00917-color-variations-in-the-sky-at-sunset/)。晴朗尘埃可见距离不是固定9km：[PIA20333](https://www.jpl.nasa.gov/images/pia20333-northern-portion-of-gale-crater-rim-viewed-from-naukluft-plateau/)。当前10.8km密度尺度及颜色/相函数都是轻量显示近似，非实况天气或完整辐射传输。
- [HiRISE颜色产品说明](https://www.uahirise.org/pdf/color-products.pdf)：当前站区RED单波段不能称自然真彩。砂粒和石块位置也非实测。
- [NASA太阳颜色](https://science.gsfc.nasa.gov/attic/eclipse2017.gsfc.nasa.gov/what-color-sun.html)、[Oxford 2024冰巨星颜色重建](https://www.ox.ac.uk/news/2024-01-05-new-images-reveal-what-neptune-and-uranus-really-look-0)。经验显示修正不冒充重建论文数据。
- Io：[USGS产品](https://astrogeology.usgs.gov/search/map/io_galileo_ssi_global_color_merge_mosaic_1km)，红外756nm/绿/紫增强色、Galileo/Voyager单色融合；两极各约5°含插值。下载1024×512预览，赤道约11km/px，不冒称源产品1km。public domain；NASA/JPL/USGS Astrogeology署名。
- Mimas：[PIA17214](https://science.nasa.gov/photojournal/mimas-global-map-june-2017/)，4096×2048预览约304m/px。NASA/JPL-Caltech/Space Science Institute。
- Enceladus：[PIA18435](https://science.nasa.gov/photojournal/color-maps-of-enceladus-2014/)，4096×2048预览约386m/px，紫外/绿/红外增强色。NASA/JPL-Caltech/Space Science Institute/Lunar and Planetary Institute。两张Cassini图按[JPL图片政策](https://www.jpl.nasa.gov/jpl-image-use-policy/)署名，不改写成CC-BY。
- 三图均北上、右向东；Io/Mimas中央0°、Enceladus中央180°。本项目SphereGeometry UV经度=360(u−.5)，前两者不偏移，Enceladus采样u+.5，flipY=true。Io由官方GeoTIFF头确认；土卫由官方标注图与[Herschel](https://planetarynames.wr.usgs.gov/Feature/2478)/[Dunyazad](https://planetarynames.wr.usgs.gov/Feature/1669)交叉核对。
- 环半径/宽度：[NASA Uranus](https://nssdc.gsfc.nasa.gov/planetary/factsheet/uranringfact.html)、[NASA Neptune](https://nssdc.gsfc.nasa.gov/planetary/factsheet/nepringfact.html)、[PDS表](https://pds-rings.seti.org/uranus/uranus_tables.html)。环半径除本项目平均半径，非照抄按赤道半径算的比值。

## 验证记录

基线：baseline-bodies 32图、baseline-mars 10图，原包index-0Zunqfza.js，均0页面/控制台错误。iteration1-mars=天空/地面初改；其中sky命名图实际是俯地，不能当仰望证据。iteration2-mars=修正仰望+日落/夜间，20图无WebGL错误，末尾大气开关选择器错误使runner失败；这些帧发现夜间漏光，已修。中间final-bodies虽然名字如此，实际上是index-ahifErNd.js：验证期间重建dist造成404及jezero尺寸错误，此批不能算通过，最终候选的单独重跑见下表；污染批次保留。

数值/单元测试321/321通过（49文件）。含太阳高度与密度分离、共同线性雾、碎石分布/封闭拓扑、窄环覆盖和3图字节/尺寸。最初全量有1项旧“资产总数固定15”断言失败，已改为原15资产不丢失且ID不重复，不降低内容门禁。

固定候选的第一组candidate-surface已完成耶泽罗/维多利亚，进入盖尔时探针等待启动按钮超时，不能把整份报告记PASS；已按foundations既有方式等待DOM按钮与引擎availability同步，在candidate-surface-remaining完成盖尔/静海补跑（22图、0页面/控制台/资源错误）。产品源码和bundle未变；只改探针等待并补availability诊断。

作者及同体系只读复核已实看耶泽罗日间/仰望/暮光/夜间和维多利亚、盖尔白天地面/天空：夜间亮石、蓝灰L1带消失，暮光局部冷灰蓝、主体仍暖暗；盖尔岩壁可辨。残留：近地影像宽幅模糊、石块棱面/贴合感弱；盖尔右向前景几何折面、右上远坡浅粉色区域仍明显，来源待分离诊断，不能授予全面视觉通过。盖尔/维多利亚夜间未逐站实看，NOT_OBSERVED。静海最终地面与仰望图也已看：黑色天空/地球方向正常，月面源影像模糊仍很明显；没有把公共天空回归记成月面视觉提升。

天体检查实看全部32张中间图并定向比对基线；最终candidate-bodies的32张亦由作者及同体系只读复核逐张检查，未观察到相较中间批新增的破面、错层或构图回归：3张新地图改善成立；太阳更白但纹理对比下降，天王星环极淡、海王星环此远景不可辨。暗相位的木卫五、土卫四/八、天卫三只检查轮廓与遮挡，表面不能验收。火卫一轮胎状大坑、土卫七三角坑壁、天卫五胶带十字、天卫一经纬网仍是明显遗留问题。

最终证据位于 D:\solar-evidence\surface-realism\，索引为 verification-manifest.json（200份截图/运行报告哈希、20个产品文件哈希与生产包绑定）。冻结产品候选后只修改文档及探针等待/诊断字段，未重建生产包。

| 证据子目录 | 实际范围 | 结果 |
|---|---|---|
| candidate-surface | 耶泽罗完整昼夜/大气开关/返轨22帧；维多利亚下降/环顾/返轨11帧；另1张盖尔启动失败帧 | 前两站流程完成；整次runner因探针等待失败，不能整批记PASS；0页面/控制台/资源错误 |
| candidate-surface-remaining | 盖尔与静海，各11帧，下降/HOLD/三向环顾/天空/返轨 | PASS；22帧，0页面/控制台/资源错误 |
| candidate-bodies | 同一冻结包，32天体正常UI切换 | PASS；32帧，0页面/控制台/资源错误 |

四站累计55帧正常流程证据，加1帧探针失败记录。地表2秒窗口的RAF平均/P95分别为：耶泽罗13.93/20.6ms，维多利亚8.10/14.0ms，盖尔11.95/20.7ms，静海10.94/20.4ms；对应RAF/引擎帧数144/145、247/248、168/169、184/185。只代表本机已有Edge、1440×900、单浏览器的短时采样，不是移动端或整段下降的持续帧率保证。

构建与TypeScript通过；保留既有浏览器外置fs/path及大包警告。当前轮未重复前轮32条路径逐帧避障/六站完整书签故障验收；相机与导航源码未改动，既有数值回归随321测试通过。仍需未来实机手机GPU/触屏及初次加载长帧验证。

独立技术/视觉批准仍未获得；子代理同作者体系只读复核不能替代跨工具批准。用户整体体验接受待复玩。推任务分支用于复核，不合main、不部署。

回退：revert本轮产品提交；不改写历史。后续先做已有真实图的缺测处理与形状匹配；不得以噪声/加锐/强补光掩盖源分辨率、烘焙阴影或几何不足。
