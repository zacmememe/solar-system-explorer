# 火卫一真实形状：资产接入前核验

本轮只读调查，未替换产品资产。目的：用同一重建版本的形状与反照率替代程序近似；不要把不匹配的全球纹理硬贴到新形状上。当前细化工作先完成 HUD 与盖尔候选，后续串行领取。

## 可用的成套数据

官方 [SBMT shared files](https://sbmt.jhuapl.edu/shared-files/) 提供 Ernst v004 约296m网格及匹配逐面反照率：

- [OBJ](https://sbmt.jhuapl.edu/shared-files/files/phobos_g_296m_spc_obj_0000n00000_v004.obj.zip)：压缩733308字节，展开3615949字节；24578顶点、49152面。此次在内存读取核对，未入库。
- [逐面CSV](https://sbmt.jhuapl.edu/shared-files/files/phobos_g_296m_spc_obj_0000n00000_v004.csv.zip)：约8.7MB压缩，本轮只读取头段，未整包验证。末列是Albedo，不是RGB照片或UV贴图。
- [PDS标签](https://sbmt.jhuapl.edu/shared-files/files/phobos_g_296m_spc_obj_0000n00000_v004.lbl)；[方法论文](https://doi.org/10.1186/s40623-023-01814-7)。论文与2026年外部产品不是同一版权对象。

OBJ头记2026-01-31、PCK10→PCK11及已移除COM–COF offset。顶点单位km，坐标范围X[-13.333,12.753]、Y[-11.423,11.987]、Z[-9.4611,9.9922]，全长约26.086×23.410×19.453km。实算网格闭合，73728条唯一边、Euler=2、没有非流形边；文件头某些边数/Euler注释与实算不符，应采用网格实算结果，保留原头文本用于审计。

头段CSV第一面中心与OBJ第一面的三个顶点均值吻合；纬度为asin(z/r)，经度为atan2(y,x)，+Z北、+X零经线、+Y东经90°。接入Three可用保持手性的 `(x,y,z)→(x,z,-y)`，法线同变换。此处只核对首面配对，正式接入必须验证全表面数、索引、中心、无效值和范围。

## 准入前仍需解决

[SBMT条款](https://sbmt.jhuapl.edu/Terms-and-Conditions.php)要求引用和致谢，当前没有充分依据把这套外部v004模型/CSV标为CC0或NASA公有领域，也不能由论文CC BY 4.0直接推导外部资产许可。先查清原产品再分发许可，再导入公开仓库；不额外发送许可询问信件，除非用户授权。

现有Phobos有 `spinOffset=-0.46` 的展示设定，`BodyPoseProvider` 的同步自转仍为近似。替换形状后，必须分别核对数据经线和当前姿态，不能仅以模型看着正确就称IAU精确朝向。保留“卫星前景、母星背景”的构图，相机和天体真实相对位置不为素材适配而改变。

建议正式实现：保存原资产哈希和许可；离线将OBJ与逐面反照率转换成紧凑本地资产；逐面反照率通过属性或明确索引实现，不编造RGB探测器照片；记录全量校验、无纹理回退、法线/接缝/面绕序；正常UI验证火卫一远近/拖动/日夜/母星遮挡/快速切换。禁止从原形状直接假设包围半径仍正确。

备选土卫七：[PDS形状](https://sbnarchive.psi.edu/pds4/cassini/saturn_satellite_shape_models_V1_0/data/hyperion_30k_plt.tab)约2.2MB、14636顶点/29268面，[说明文档](https://sbnarchive.psi.edu/pds4/cassini/saturn_satellite_shape_models_V1_0/document/hyperion_document.pdf)。匹配纹理和混沌自转的具体时刻约定未解决，不与火卫一混为同一批已就绪资产。

2026-09-26续查：JHU/APL条款仍未明确授予外部v004再分发权；本轮先完成有明确公共领域许可的土卫三Cassini PIA14931。来源、坐标矛盾处理、渲染接入和验证见 [本轮报告](../mars-materials-body-assets-report.md)。火卫一未入库。
