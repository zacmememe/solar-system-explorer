# F-SUN-APPEARANCE-14：活动太阳增强视图

用户反馈太阳像白球，要求Codex直接修复，并在过程中明确希望看到红黄色、缓慢翻涌、有辉光的太阳。最终以这一要求为准；白光中间版不是最终交付。

- base：`516a3aa07175585a3abc28a11dfb589fa06fced1`。
- 产品candidate：`127b0f408ee9767e66b8a2035f1b0396da6613a0`；分支`codex/sun-appearance-14`。父提交`f821b74`是白光中间版，之后文档提交不改产品。
- 唯一入口仍为根目录`启动太阳系漫游.bat`；关闭旧页面后重新启动。实现、作者验证完成，用户复玩及独立批准待办。任务分支交付，未扩大此前main合并授权。

## 实现与边界

`src/rendering/SunMaterial.ts`把SSS纹理明暗映射为金黄亮区、橙红暗部，增加细颗粒与三组不规则黑子示意。有界局部纹理形变产生缓慢活动感，使用已有模拟时间，暂停即停止；没有另造时钟、额外旋转整张纹理或改相机。

球缘渐暗与局部辉光保留亮度层次。辉光按球体视半径适配近看，继续参与世界深度遮挡。太阳自身细分48×48→128×96；纹理失败时也用同一材质的中性输入。资产字节、SHA、CC BY 4.0许可保留，没有新增下载。太阳半径/空间坐标、CameraController、DepthSliceRenderer、全局曝光1.1、照亮行星的光源及其他业务流程未变。

颜色、流动、黑子为增强展示，不是裸眼真彩、实际温度、实时活动或流体模拟，已在观测提示及资产说明中标明。NASA解释太空中的太阳接近白色，光球具有球缘昏暗、米粒组织与黑子：[颜色说明](https://science.gsfc.nasa.gov/attic/eclipse2017.gsfc.nasa.gov/what-color-sun.html)、[光球说明](https://solarscience.msfc.nasa.gov/surface.shtml)。本轮纹理来源为[SSS](https://www.solarsystemscope.com/textures/)。

## 验证与证据

最终JS：`index-BdDhcEHt.js`；index SHA：`20112d5523788ef95aeefdc35bf528fc8222db3fb22f5470456650835427fdbc`；JS SHA：`941de9c36041cffcadbd17f593e1ea8e8d7aa758be1c7e43722ea5606dd668ab`。完整绑定见`D:/solar-evidence/sun-appearance-14/candidate-manifest.json`。

- `npm test -- --reporter=dot`：63文件430/430通过；最后资产说明文字同步后build再次通过，未重复全量测试。
- `npm run build`：tsc/Vite通过，既有fs/path external与大包警告保留。
- `scripts/verify-sun-appearance-14.mjs`：最终`release/`11帧；正常UI默认、近看、播放两帧、暂停、拖动、远景、390px竖屏、地球/土星回归；另含关辉光诊断和主动503回退。拖动必须实际改变theta/phi；活动推进时间、暂停冻结时间。异常错误0，主动503的3条日志单独列expectedFaults。
- `scripts/verify-sun-shader-14.mjs`：`enhanced-gpu/`13项GPU检查通过。恒定纹理中心RGB约245/221/155、球缘224/183/95；明暗区色差、黑子、无纹理显示、辉光不盖光球、3距离视半径、跨3切片前景遮挡（最大RGB=0）、暂停重复像素一致、模拟时间驱动局部流动（26,405像素变化）、WebGL无错误。诊断不是正常UI日食验收。

作者实看增强版默认/近看/拖动/远景/竖屏与回退，金黄亮区、橙红暗部和辉光可辨；地球/土星定向回归未见新增曝光异常。脚本JSON保留visualAcceptance=NOT_OBSERVED，脚本不自动代替人工判断。真实手机GPU、HDR显示器、完整日食/地表观日全路径未验；用户接受待复玩。

历史证据保留：`baseline/`为原白球；`iteration-*`、`accepted/`是已被新方向取代的白光过程；`final/`的一次FAIL是主动故障日志分类错误，修分类后重跑；`enhanced-final/`的拖动曾从HUD起步，后续将鼠标移回画布并补实际机位断言，在`release/`重跑。不覆盖失败或混称最终通过。用户改选增强视图后，GPU预期相应改为红黄层次可辨，并新增流动检查；不是为修复放宽阈值。

## zcode接力与回退

继续原READY任务F-STARTUP-RESPONSIVENESS-11。先查唯一queue，从包含`127b0f4`的当前交付HEAD创建分支，避免切回旧main丢失本地太阳修复；集成按对应授权。

用户已选增强活动太阳，不能因“真实太阳是白色”擅自改回白光。保留示意说明，不称NASA实时影像。不要通过提高全局曝光、关闭深度测试、移到载具展示层来增强太阳。改太阳/色调映射/分段渲染后，复跑两个runner并实看默认、近看、暂停和拖动。

回退整项时逆序revert `127b0f4`、`f821b74`再构建；只退增强方向则revert前者。保留其他任务与用户文件，不用reset/force覆盖历史。证据、profile均留在D盘项目外。
