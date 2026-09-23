/**
 * 天体数据表与轨道几何计算
 * 遵循 01-REBUILD-PLAN.zh-CN.md：
 * 1. 保留双精度公里物理数据，给 GPU 局部坐标；
 * 2. 宏观太阳系全景使用对数/开普勒导航压缩，局部特写采用高精度线性坐标；
 * 3. 卫星独立于行星自转网格，公转采用真实开普勒倾角与周期。
 */

import type { CelestialBodyData, BodyId } from '../contracts/body';

export const BODIES: Record<string, CelestialBodyData> = {
  sun: {
    id: 'sun',
    name: '太阳',
    nameEn: 'Sun',
    type: 'star',
    parentId: null,
    radiusKm: 696340.0,
    axialTiltDeg: 7.25,
    rotationPeriodHours: 609.12, // 约 25.4 天
    orbitSemiMajorAxisKm: 0,
    orbitPeriodDays: 0,
    colorHex: 0xffaa22,
    observationTip: '太阳是太阳系的能量源泉，它的质量占了整个太阳系的 99.86%！',
    description: '太阳是一颗黄矮星（G2V），核心通过剧烈的核聚变将氢融合成氦，源源不断向太阳系辐射光与热。表面有米粒组织与太阳黑子。',
    funFact: '太阳肚子里可以装下大约 130 万个地球！',
    colorAssetId: 'sun-sss-2k',
    sourceRef: 'Solar System Scope / NASA SDO',
  },
  mercury: {
    id: 'mercury',
    name: '水星',
    nameEn: 'Mercury',
    type: 'planet',
    parentId: 'sun',
    radiusKm: 2439.7,
    axialTiltDeg: 0.034,
    rotationPeriodHours: 1407.6, // 58.65 天
    orbitSemiMajorAxisKm: 57909050, // 0.387 AU
    orbitPeriodDays: 87.969,
    orbitalInclinationDeg: 7.00,
    colorHex: 0x9e9e9e,
    observationTip: '水星表面密密麻麻全是撞击坑，像极了月球；它离太阳最近，白天热得能熔化铅！',
    description: '水星是太阳系最小且最靠近太阳的行星。几乎没有大气层包裹，昼夜温差高达 600°C（白天 430°C，夜晚 -180°C）。本模型采用信使号探测器数据加工的 2K 纹理。',
    funFact: '在水星上过一年（公转一圈）只需要 88 天，但过一天（昼夜交替）要等 176 个地球日！',
    colorAssetId: 'mercury-sss-2k',
    sourceRef: 'Solar System Scope / NASA MESSENGER',
  },
  venus: {
    id: 'venus',
    name: '金星',
    nameEn: 'Venus',
    type: 'planet',
    parentId: 'sun',
    radiusKm: 6051.8,
    axialTiltDeg: 177.36, // 逆向自转
    rotationPeriodHours: -5832.5, // 243 天逆向自转
    orbitSemiMajorAxisKm: 108208000, // 0.723 AU
    orbitPeriodDays: 224.701,
    orbitalInclinationDeg: 3.39,
    colorHex: 0xe3bb76,
    hasAtmosphere: true,
    observationTip: '金星裹着一层厚厚的金色棉袄（二氧化碳浓厚大气），点击“穿透地表”能看到它下方的火山熔岩！',
    description: '金星由于极端的温室效应，表面温度常年高达 465°C，是全太阳系最热的行星。它还是唯一太阳“从西边升起、东边落下”的自转逆行大行星。',
    funFact: '金星上的大气压相当于地球 900 米深的海底，下着的雨是浓硫酸！',
    colorAssetId: 'venus-atmosphere-sss-2k',
    secondaryAssetId: 'venus-surface-sss-2k',
    sourceRef: 'Solar System Scope / NASA Magellan',
  },
  earth: {
    id: 'earth',
    name: '地球',
    nameEn: 'Earth',
    type: 'planet',
    parentId: 'sun',
    radiusKm: 6371.0,
    axialTiltDeg: 23.44,
    rotationPeriodHours: 23.934,
    orbitSemiMajorAxisKm: 149598023, // 1.000 AU
    orbitPeriodDays: 365.256,
    orbitalInclinationDeg: 0.00,
    colorHex: 0x3a82f6,
    hasAtmosphere: true,
    observationTip: '看大洋与大陆的轮廓；注意南极与北极的白色冰盖和流动的白色云层。',
    description: '地球是人类与无数生命唯一的摇篮，表面约 71% 被液态水覆盖。本应用支持地表白昼、城市夜景灯光、独立自旋云层与薄大气散射边缘微光。',
    funFact: '地球正在带着我们以每秒约 30 公里的惊人速度在太空中绕着太阳飞奔！',
    colorAssetId: 'earth-day-sss-2k',
    sourceRef: 'Solar System Scope / NASA Blue Marble',
  },
  moon: {
    id: 'moon',
    name: '月球',
    nameEn: 'Moon',
    type: 'moon',
    parentId: 'earth',
    radiusKm: 1737.4,
    axialTiltDeg: 1.54,
    rotationPeriodHours: 655.72,
    orbitSemiMajorAxisKm: 384400,
    orbitPeriodDays: 27.321,
    orbitalInclinationDeg: 5.14,
    colorHex: 0xb0b0b0,
    observationTip: '观察正面的深色平原（月海），转到背面看密密麻麻的撞击坑。',
    description: '月球是地球唯一的天然卫星，处于潮汐锁定状态，永远只有同一面朝向地球。本模型采用 NASA CGI Moon Kit (2025/2026) LROC 广角相机多光谱正射拼图。',
    funFact: '月球上没有风也没有雨，宇航员半个世纪前留下的脚印现在依然完好无损！',
    colorAssetId: 'moon-svs-2025-2k',
    sourceRef: 'NASA SVS CGI Moon Kit / LRO',
  },
  mars: {
    id: 'mars',
    name: '火星',
    nameEn: 'Mars',
    type: 'planet',
    parentId: 'sun',
    radiusKm: 3389.5,
    axialTiltDeg: 25.19,
    rotationPeriodHours: 24.623,
    orbitSemiMajorAxisKm: 227939200, // 1.524 AU
    orbitPeriodDays: 686.98,
    orbitalInclinationDeg: 1.85,
    colorHex: 0xef4444,
    hasAtmosphere: true,
    observationTip: '火星全身锈红（氧化铁沙尘），南北极有雪白的干冰极冠，中间横跨着巨大的水手大峡谷！',
    description: '火星是人类未来行星际移民最受瞩目的目的地。表面拥有全太阳系最高的火山“奥林匹斯山”（高 21.9 公里）与长达 4000 公里的“水手号大峡谷”。',
    funFact: '奥林匹斯山足足有近 3 个珠穆朗玛峰那么高，大到站在山脚都看不到山顶！',
    colorAssetId: 'mars-sss-2k',
    sourceRef: 'Solar System Scope / NASA Viking & MRO',
  },
  phobos: {
    id: 'phobos',
    name: '火卫一',
    nameEn: 'Phobos',
    type: 'moon',
    parentId: 'mars',
    radiusKm: 11.26,
    dimensionsKm: [27.0, 22.0, 18.0],
    shapeType: 'irregular',
    axialTiltDeg: 0,
    rotationPeriodHours: 7.65,
    orbitSemiMajorAxisKm: 9376,
    orbitPeriodDays: 0.3189,
    orbitalInclinationDeg: 1.09,
    colorHex: 0x7c7365,
    observationTip: '火卫一就像一颗飞在火星头顶的土豆小石块，上面有一个超级巨大的斯蒂克尼陨石坑！',
    description: '火卫一是火星两颗天然卫星中较大也较靠近火星的一颗，平均半径仅约 11 公里，轨道极低，正在以每百年约 2 米的速度缓缓向火星靠近。',
    funFact: '火卫一绕火星一圈只要 7 个多小时，在火星上一天能看到它升起落下三次！',
    colorAssetId: 'moon-svs-2025-2k',
    sourceRef: 'NASA MRO / HiRISE',
  },
  deimos: {
    id: 'deimos',
    name: '火卫二',
    nameEn: 'Deimos',
    type: 'moon',
    parentId: 'mars',
    radiusKm: 6.2,
    dimensionsKm: [15.0, 12.2, 10.4],
    shapeType: 'irregular',
    axialTiltDeg: 0,
    rotationPeriodHours: 30.3,
    orbitSemiMajorAxisKm: 23463,
    orbitPeriodDays: 1.263,
    orbitalInclinationDeg: 0.93,
    colorHex: 0x8b8277,
    observationTip: '火卫二比火卫一更小更远，表面覆盖着一层厚厚的松散尘埃，看起来更加光滑。',
    description: '火卫二是火星外侧的微小天然卫星，可能是一颗被火星引力捕获的富碳小行星。',
    funFact: '从火星上看，火卫二小得就像一颗格外明亮的小星星！',
    colorAssetId: 'moon-svs-2025-2k',
    sourceRef: 'NASA Viking / MRO',
  },
  jupiter: {
    id: 'jupiter',
    name: '木星',
    nameEn: 'Jupiter',
    type: 'planet',
    parentId: 'sun',
    radiusKm: 69911.0,
    axialTiltDeg: 3.13,
    rotationPeriodHours: 9.925,
    orbitSemiMajorAxisKm: 778570000, // 5.204 AU
    orbitPeriodDays: 4332.589,
    orbitalInclinationDeg: 1.30,
    colorHex: 0xd97706,
    hasAtmosphere: true,
    observationTip: '找到木星南半球标志性的大红斑风暴！再数数它身边排着队的四颗伽利略大卫星。',
    description: '木星是太阳系行星之王，质量是其他所有行星总和的 2.5 倍。它主要由氢和氦组成，没有坚硬的固态地表。著名的大红斑是一个已经刮了数百年的超级反气旋风暴。',
    funFact: '木星的大红斑非常巨大，里面轻松塞得下一整个地球！',
    colorAssetId: 'jupiter-sss-2k',
    sourceRef: 'Solar System Scope / NASA Cassini & Juno',
  },
  io: {
    id: 'io',
    name: '木卫一',
    nameEn: 'Io',
    type: 'moon',
    parentId: 'jupiter',
    radiusKm: 1821.6,
    axialTiltDeg: 0,
    rotationPeriodHours: 42.46,
    orbitSemiMajorAxisKm: 421700,
    orbitPeriodDays: 1.769,
    orbitalInclinationDeg: 0.05,
    colorHex: 0xeab308,
    observationTip: '木卫一全身黄澄澄红彤彤，像一张超级大比萨，表面有 400 多座活跃的活火山！',
    description: '木卫一是全太阳系地质活动最剧烈的天体，由于木星与其他卫星的潮汐引力拉扯反复挤压摩擦其内部，产生剧烈的高温岩浆与硫磺喷发，羽流高达数百公里。',
    funFact: '木卫一的火山喷泉能喷出 500 公里高的硫磺气体，直接冲进太空！',
    colorAssetId: 'moon-svs-2025-2k',
    sourceRef: 'NASA Galileo & Voyager / USGS',
  },
  europa: {
    id: 'europa',
    name: '木卫二',
    nameEn: 'Europa',
    type: 'moon',
    parentId: 'jupiter',
    radiusKm: 1560.8,
    axialTiltDeg: 0.1,
    rotationPeriodHours: 85.23,
    orbitSemiMajorAxisKm: 670900,
    orbitPeriodDays: 3.551,
    orbitalInclinationDeg: 0.47,
    colorHex: 0xd1d5db,
    observationTip: '木卫二像一个雪白的大冰球，表面布满一道道纵横交错的红褐色冰裂痕！',
    description: '木卫二冰层下深藏着一个深度达上百公里的全球液态水海洋，水量甚至超过地球所有海洋的总和，是科学家寻找地外生命最充满希望的天体之一。',
    funFact: '科学家推测木卫二冰下海洋深处的温暖海底火山口，可能正在孕育着奇异的地外生命！',
    colorAssetId: 'moon-svs-2025-2k',
    sourceRef: 'NASA Galileo / USGS',
  },
  ganymede: {
    id: 'ganymede',
    name: '木卫三',
    nameEn: 'Ganymede',
    type: 'moon',
    parentId: 'jupiter',
    radiusKm: 2634.1,
    axialTiltDeg: 0.2,
    rotationPeriodHours: 171.7,
    orbitSemiMajorAxisKm: 1070400,
    orbitPeriodDays: 7.155,
    orbitalInclinationDeg: 0.20,
    colorHex: 0x9ca3af,
    observationTip: '木卫三是全太阳系最大的卫星，个头比水星和冥王星还要大！',
    description: '木卫三是太阳系中已知唯一拥有自身独立偶极磁场的天然卫星，地表呈现古老深色撞击区与年轻浅色沟槽断裂带的复杂混合。',
    funFact: '如果木卫三不是绕着木星转而是直接绕太阳转，它完全可以被当成一颗大行星！',
    colorAssetId: 'moon-svs-2025-2k',
    sourceRef: 'NASA Galileo & Juno / USGS',
  },
  callisto: {
    id: 'callisto',
    name: '木卫四',
    nameEn: 'Callisto',
    type: 'moon',
    parentId: 'jupiter',
    radiusKm: 2410.3,
    axialTiltDeg: 0,
    rotationPeriodHours: 400.5,
    orbitSemiMajorAxisKm: 1882700,
    orbitPeriodDays: 16.689,
    orbitalInclinationDeg: 0.28,
    colorHex: 0x6b7280,
    observationTip: '木卫四是太阳系撞击坑最密集的星球，几乎每一寸土地都被陨石砸了个遍。',
    description: '木卫四表面极度古老，地质构造几乎停滞了 40 亿年。它由等量的岩石和水冰组成，表面有着著名的巨大同心环撞击盆地“瓦尔哈拉”（Valhalla）。',
    funFact: '木卫四就像是一部被冰冻了 40 亿年的太阳系撞击历史日记本！',
    colorAssetId: 'moon-svs-2025-2k',
    sourceRef: 'NASA Galileo & Voyager / USGS',
  },
  amalthea: {
    id: 'amalthea',
    name: '木卫五',
    nameEn: 'Amalthea',
    type: 'moon',
    parentId: 'jupiter',
    radiusKm: 83.5,
    dimensionsKm: [250, 146, 128],
    shapeType: 'irregular',
    axialTiltDeg: 0,
    rotationPeriodHours: 11.95,
    orbitSemiMajorAxisKm: 181400,
    orbitPeriodDays: 0.498,
    orbitalInclinationDeg: 0.37,
    colorHex: 0xb91c1c,
    observationTip: '木卫五是一颗极度拉长的深红色“大红薯”，它是全太阳系最红的天体之一！',
    description: '木卫五是伽利略发现四大卫星后第一颗被发现的木星卫星（爱德华·巴纳德于 1892 年发现）。其微弱的引力无法将其压成球体，外形极度不规则，释放的热量甚至超过它接收的阳光。',
    funFact: '木卫五就像一块被急速烘烤的巨大太空红薯，表面可能覆盖着从木卫一火山喷发漂来的硫化物！',
    colorAssetId: 'moon-svs-2025-2k',
    sourceRef: 'NASA Galileo / Voyager',
  },
  saturn: {
    id: 'saturn',
    name: '土星',
    nameEn: 'Saturn',
    type: 'planet',
    parentId: 'sun',
    radiusKm: 58232.0,
    axialTiltDeg: 26.73,
    rotationPeriodHours: 10.656,
    orbitSemiMajorAxisKm: 1433530000, // 9.582 AU
    orbitPeriodDays: 10759.22,
    orbitalInclinationDeg: 2.49,
    colorHex: 0xf59e0b,
    hasAtmosphere: true,
    ringConfig: {
      innerRadiusRatio: 1.25,
      outerRadiusRatio: 2.35,
      textureAssetId: 'saturn-rings-sss-2k',
    },
    observationTip: '欣赏壮丽的土星光环与卡西尼环缝！注意星环投在行星表面的优雅阴影。',
    description: '土星拥有全太阳系最壮观美丽的光环系统。光环虽宽达近 30 万公里，厚度却平均只有几十米，主要由亿万颗水冰微粒与岩石碎块组成。',
    funFact: '土星的平均密度比水还要小！如果有一个足够大的宇宙超级大浴缸，土星真的可以漂浮在水面上！',
    colorAssetId: 'saturn-sss-2k',
    sourceRef: 'Solar System Scope / NASA Cassini',
  },
  mimas: {
    id: 'mimas',
    name: '土卫一',
    nameEn: 'Mimas',
    type: 'moon',
    parentId: 'saturn',
    radiusKm: 198.2,
    axialTiltDeg: 0,
    rotationPeriodHours: 22.62,
    orbitSemiMajorAxisKm: 185520,
    orbitPeriodDays: 0.942,
    orbitalInclinationDeg: 1.57,
    colorHex: 0xcbd5e1,
    observationTip: '土卫一上面有一个占据整颗星球三分之一的巨型赫歇尔陨石坑，酷似《星球大战》里的“死星”！',
    description: '土卫一几乎全由水冰组成。其表面的赫歇尔撞击坑直径达 130 公里，坑壁高达 5 公里，当年形成该坑的撞击几乎将整颗土卫一彻底粉碎。',
    funFact: '土卫一在红外热成像图中呈现出经典的“吃豆人 (Pac-Man)”热点形状！',
    colorAssetId: 'moon-svs-2025-2k',
    sourceRef: 'NASA Cassini / Voyager',
  },
  enceladus: {
    id: 'enceladus',
    name: '土卫二',
    nameEn: 'Enceladus',
    type: 'moon',
    parentId: 'saturn',
    radiusKm: 252.1,
    axialTiltDeg: 28.5,
    rotationPeriodHours: 32.88,
    orbitSemiMajorAxisKm: 238000,
    orbitPeriodDays: 1.370,
    orbitalInclinationDeg: 0.01,
    colorHex: 0xf8fafc,
    observationTip: '土卫二就像一颗雪白的洁净珍珠，南极有一道道“虎纹”裂缝，正在不断向太空喷出巨大的冰喷泉！',
    description: '土卫二拥有全太阳系最高的光反照率（反射几乎 99% 的阳光）。卡西尼号飞掠时发现了其南极水冰羽流，证实其冰壳下拥有温暖的碱性地下海洋与海底热液活动。',
    funFact: '土卫二南极喷发的水冰碎屑不仅落回自身表面，还一路喷进太空，织成了土星美丽的 E 环！',
    colorAssetId: 'moon-svs-2025-2k',
    sourceRef: 'NASA Cassini PIA18435',
  },
  tethys: {
    id: 'tethys',
    name: '土卫三',
    nameEn: 'Tethys',
    type: 'moon',
    parentId: 'saturn',
    radiusKm: 531.1,
    axialTiltDeg: 0,
    rotationPeriodHours: 45.31,
    orbitSemiMajorAxisKm: 294660,
    orbitPeriodDays: 1.888,
    orbitalInclinationDeg: 1.12,
    colorHex: 0xe2e8f0,
    observationTip: '土卫三有一个横贯大半个星球的巨型“伊萨卡大裂谷”，深度达数百公里！',
    description: '土卫三是一颗低密度的纯冰质卫星。表面拥有直径 400 公里的奥德修斯巨型撞击坑，以及一条几乎环绕卫星四分之三周的古老扩张裂谷系统——伊萨卡峡谷（Ithaca Chasma）。',
    funFact: '土卫三也有一个与土卫一极为相似的“吃豆人”表面热分布图！',
    colorAssetId: 'moon-svs-2025-2k',
    sourceRef: 'NASA Cassini / Voyager',
  },
  dione: {
    id: 'dione',
    name: '土卫四',
    nameEn: 'Dione',
    type: 'moon',
    parentId: 'saturn',
    radiusKm: 561.4,
    axialTiltDeg: 0,
    rotationPeriodHours: 65.69,
    orbitSemiMajorAxisKm: 377400,
    orbitPeriodDays: 2.737,
    orbitalInclinationDeg: 0.02,
    colorHex: 0x94a3b8,
    observationTip: '土卫四背半球覆盖着一层层宛如羽毛般的明亮冰崖断层，在深空泛着银光。',
    description: '土卫四后半球布满由构造断裂形成的巨大明亮冰崖（Chasmata），当年早期望远镜曾将其误认为纤细的卷云。冰崖高达数百米，暴露出内部高反照率的纯净水冰。',
    funFact: '土卫四的轨道上还带着两颗特洛伊卫星（土卫十二与土卫十三），它们共用一条轨道永远伴飞！',
    colorAssetId: 'moon-svs-2025-2k',
    sourceRef: 'NASA Cassini / Voyager',
  },
  rhea: {
    id: 'rhea',
    name: '土卫五',
    nameEn: 'Rhea',
    type: 'moon',
    parentId: 'saturn',
    radiusKm: 763.8,
    axialTiltDeg: 0,
    rotationPeriodHours: 108.43,
    orbitSemiMajorAxisKm: 527040,
    orbitPeriodDays: 4.518,
    orbitalInclinationDeg: 0.35,
    colorHex: 0x64748b,
    observationTip: '土卫五是土星第二大卫星，外表布满密密麻麻的古老陨石撞击坑，像一位饱经沧桑的老人。',
    description: '土卫五由约 75% 的水冰与 25% 的硅酸盐岩石组成，就像一个巨大的脏雪球。卡西尼探测器曾测得其表面拥有极为稀薄的氧气与二氧化碳散逸外逸层。',
    funFact: '土卫五的大气氧气来源于带电粒子轰击其水冰表面，将水分子强行电离分解产生！',
    colorAssetId: 'moon-svs-2025-2k',
    sourceRef: 'NASA Cassini / Voyager',
  },
  titan: {
    id: 'titan',
    name: '土卫六',
    nameEn: 'Titan',
    type: 'moon',
    parentId: 'saturn',
    radiusKm: 2574.7,
    axialTiltDeg: 0,
    rotationPeriodHours: 382.68,
    orbitSemiMajorAxisKm: 1221870,
    orbitPeriodDays: 15.945,
    orbitalInclinationDeg: 0.35,
    colorHex: 0xf97316,
    hasAtmosphere: true,
    observationTip: '土卫六是太阳系唯一拥有浓厚大气的卫星，裹着一层橘黄色迷雾，上面有液态甲烷河流和海洋！',
    description: '土卫六的大气以氮气为主，表面气压比地球还高 50%。它是除地球外太阳系唯一地表拥有稳定液态湖泊的天体（液态甲烷和乙烷）。卡西尼-惠更斯号曾成功在其表面着陆。',
    funFact: '在土卫六上你只要在手臂上绑一对轻便的人造翅膀，凭借超密的大气和微弱的重力就能像鸟一样轻松飞起来！',
    colorAssetId: 'moon-svs-2025-2k',
    sourceRef: 'NASA Cassini / Huygens',
  },
  hyperion: {
    id: 'hyperion',
    name: '土卫七',
    nameEn: 'Hyperion',
    type: 'moon',
    parentId: 'saturn',
    radiusKm: 135.0,
    dimensionsKm: [360, 266, 205],
    shapeType: 'irregular',
    axialTiltDeg: 0,
    rotationPeriodHours: 0, // 混沌混乱自转
    orbitSemiMajorAxisKm: 1481100,
    orbitPeriodDays: 21.277,
    orbitalInclinationDeg: 0.57,
    colorHex: 0xd97706,
    observationTip: '土卫七是一颗多孔极度坑洼的“太空大海绵”，并在宇宙中进行不可预测的混沌翻滚！',
    description: '土卫七密度仅为水的一半左右，呈现极度多孔的蜂窝状多面体构造。因为受到土卫六强大的共振潮汐扰动，它是太阳系唯一自转轴和自转速度完全处于物理混沌状态的大卫星。',
    funFact: '在土卫七上你根本没办法制造日历，因为你永远不知道下一秒太阳会从哪个诡异方向升起！',
    colorAssetId: 'moon-svs-2025-2k',
    sourceRef: 'NASA Cassini / Voyager',
  },
  iapetus: {
    id: 'iapetus',
    name: '土卫八',
    nameEn: 'Iapetus',
    type: 'moon',
    parentId: 'saturn',
    radiusKm: 734.5,
    axialTiltDeg: 0,
    rotationPeriodHours: 1903.9,
    orbitSemiMajorAxisKm: 3561300,
    orbitPeriodDays: 79.330,
    orbitalInclinationDeg: 15.47,
    colorHex: 0x475569,
    observationTip: '土卫八是一颗神奇的“阴阳脸”卫星：一面比沥青还要乌黑，另一面却洁白如雪，赤道还隆起一条 20 公里高的巨型山脊！',
    description: '土卫八的前导半球（卡西尼区）反射率仅 3%（比煤炭还黑），而后随半球（龙塞斯瓦列斯高原）却洁白明亮。其赤道几乎完美环绕着一条高达 20 公里的巨大山脊，使整颗卫星看起来像一颗巨大的核桃。',
    funFact: '土卫八为什么一面黑一面白？科学家发现黑面会吸收更多阳光升华水冰，冰汽跑到冷半球凝结，形成恶性温室循环！',
    colorAssetId: 'moon-svs-2025-2k',
    sourceRef: 'NASA Cassini / Voyager',
  },
  uranus: {
    id: 'uranus',
    name: '天王星',
    nameEn: 'Uranus',
    type: 'planet',
    parentId: 'sun',
    radiusKm: 25362.0,
    axialTiltDeg: 97.77, // 躺平自转
    rotationPeriodHours: -17.24, // 逆行
    orbitSemiMajorAxisKm: 2872460000, // 19.201 AU
    orbitPeriodDays: 30685.4,
    orbitalInclinationDeg: 0.77,
    colorHex: 0x06b6d4,
    hasAtmosphere: true,
    ringConfig: {
      innerRadiusRatio: 1.45,
      outerRadiusRatio: 2.15,
      textureAssetId: 'uranus-rings',
    },
    observationTip: '天王星是一颗淡青色的冰巨星，它是全太阳系最懒的星球——“躺着”绕太阳打滚！',
    description: '天王星是一颗富含水、氨和甲烷冰的冰巨星，大气中的甲烷吸收红光使它呈现淡雅的青绿色。其自转轴倾角高达 97.77°，几乎横躺在公转轨道面上横滚运行。',
    funFact: '因为天王星是躺着自转的，它的南极和北极各自有长达 42 年的极昼和 42 年的连续黑夜！',
    colorAssetId: 'uranus-sss-2k',
    sourceRef: 'Solar System Scope / NASA Voyager 2',
  },
  miranda: {
    id: 'miranda',
    name: '天卫五',
    nameEn: 'Miranda',
    type: 'moon',
    parentId: 'uranus',
    radiusKm: 235.8,
    axialTiltDeg: 0,
    rotationPeriodHours: 33.92,
    orbitSemiMajorAxisKm: 129390,
    orbitPeriodDays: 1.413,
    orbitalInclinationDeg: 4.34,
    colorHex: 0xa1a1aa,
    observationTip: '天卫五是太阳系最古怪的“弗兰肯斯坦拼图星球”，拥有深达 20 公里的维罗纳断崖——太阳系最高悬崖！',
    description: '天卫五的地表由不同地质板块粗暴拼凑而成，呈现巨大的梯形断层冠状物（Coronae）。其维罗纳悬崖（Verona Rupes）垂直落差高达 20 公里，是珠穆朗玛峰高度的两倍多！',
    funFact: '如果你从天卫五的维罗纳悬崖顶上跳下去，在微重力下你需要慢悠悠漂浮 12 分钟才会落到底部！',
    colorAssetId: 'moon-svs-2025-2k',
    sourceRef: 'NASA Voyager 2',
  },
  ariel: {
    id: 'ariel',
    name: '天卫一',
    nameEn: 'Ariel',
    type: 'moon',
    parentId: 'uranus',
    radiusKm: 578.9,
    axialTiltDeg: 0,
    rotationPeriodHours: 60.48,
    orbitSemiMajorAxisKm: 191020,
    orbitPeriodDays: 2.520,
    orbitalInclinationDeg: 0.04,
    colorHex: 0xe4e4e7,
    observationTip: '天卫一是天王星最明亮年轻的卫星，表面密布着纵横交错的巨大冰质裂谷与地堑。',
    description: '天卫一拥有天王星所有卫星中最高的光反照率，地表广泛分布着深达数公里的断层地堑裂谷，底部被平坦的冰火山熔岩流填平。',
    funFact: '天卫一曾经历过剧烈的潮汐加热，其大裂谷延伸上千公里，曾有液态水和氨水在表面如同岩浆般流淌！',
    colorAssetId: 'moon-svs-2025-2k',
    sourceRef: 'NASA Voyager 2',
  },
  umbriel: {
    id: 'umbriel',
    name: '天卫二',
    nameEn: 'Umbriel',
    type: 'moon',
    parentId: 'uranus',
    radiusKm: 584.7,
    axialTiltDeg: 0,
    rotationPeriodHours: 99.46,
    orbitSemiMajorAxisKm: 266300,
    orbitPeriodDays: 4.144,
    orbitalInclinationDeg: 0.13,
    colorHex: 0x52525b,
    observationTip: '天卫二是天王星最暗黑的卫星，赤道附近有一个不可思议的荧光亮白圆环撞击坑“翁达”（Wunda）！',
    description: '天卫二表面均匀覆盖着一层极暗的碳质风化层，几乎没有地质活动更新。然而在其接近赤道处，却突兀地存在着一个直径 131 公里的明亮白色光环环形山（Wunda）。',
    funFact: '天卫二的 Wunda 亮坑至今仍是未解之谜，科学家推测可能是一颗彗星撞穿了暗黑表皮激出了底下的纯白冰晶！',
    colorAssetId: 'moon-svs-2025-2k',
    sourceRef: 'NASA Voyager 2',
  },
  titania: {
    id: 'titania',
    name: '天卫三',
    nameEn: 'Titania',
    type: 'moon',
    parentId: 'uranus',
    radiusKm: 788.4,
    axialTiltDeg: 0,
    rotationPeriodHours: 208.94,
    orbitSemiMajorAxisKm: 435910,
    orbitPeriodDays: 8.706,
    orbitalInclinationDeg: 0.08,
    colorHex: 0x71717a,
    observationTip: '天卫三是天王星家族最大的卫星，横跨着一条深邃壮观的“墨西拿大峡谷”。',
    description: '天卫三由等量的岩石和水冰组成，表面被一条长达 1500 公里的巨型断裂谷（Messina Chasma）劈开，曾测量出可能拥有微弱的二氧化碳稀薄大气层。',
    funFact: '天卫三的名字来源于莎士比亚戏剧《仲夏夜之梦》中的仙后提泰妮娅！',
    colorAssetId: 'moon-svs-2025-2k',
    sourceRef: 'NASA Voyager 2',
  },
  oberon: {
    id: 'oberon',
    name: '天卫四',
    nameEn: 'Oberon',
    type: 'moon',
    parentId: 'uranus',
    radiusKm: 761.4,
    axialTiltDeg: 0,
    rotationPeriodHours: 323.14,
    orbitSemiMajorAxisKm: 583520,
    orbitPeriodDays: 13.463,
    orbitalInclinationDeg: 0.06,
    colorHex: 0x3f3f46,
    observationTip: '天卫四是天王星最外侧的大卫星，表面带有一抹淡淡的暗红，伫立着一座高达 11 公里的神秘孤峰。',
    description: '天卫四是天王星卫星中撞击坑最密集、最古老的星球。其许多大型撞击坑的底部都被神秘的深黑色碳质物质所填满，并有一座高达 11 公里的巨型独立山峰。',
    funFact: '天卫四表面 11 公里高的孤峰比地球的珠穆朗玛峰还要高出整整两千多米！',
    colorAssetId: 'moon-svs-2025-2k',
    sourceRef: 'NASA Voyager 2',
  },
  neptune: {
    id: 'neptune',
    name: '海王星',
    nameEn: 'Neptune',
    type: 'planet',
    parentId: 'sun',
    radiusKm: 24622.0,
    axialTiltDeg: 28.32,
    rotationPeriodHours: 16.11,
    orbitSemiMajorAxisKm: 4495060000, // 30.047 AU
    orbitPeriodDays: 60189.0,
    orbitalInclinationDeg: 1.77,
    colorHex: 0x2563eb,
    hasAtmosphere: true,
    ringConfig: {
      innerRadiusRatio: 1.65,
      outerRadiusRatio: 2.60,
      textureAssetId: 'neptune-rings',
    },
    observationTip: '海王星呈现深邃迷人的湛蓝色，它是太阳系风暴最狂暴的星球，拥有暗色光环弧与超音速风暴！',
    description: '海王星是太阳系已知最远离太阳的大行星，拥有 Galle、Le Verrier 与著名的 Adams 暗色光环弧。大气层中蕴藏着时速超过 2100 公里的超级超音速飓风与特征白色卷云。',
    funFact: '海王星绕太阳公转一圈需要整整 165 年，自 1846 年被人类发现以来，它才刚刚完整过完一个“海王星年”！',
    colorAssetId: 'neptune-sss-2k',
    sourceRef: 'Solar System Scope / NASA Voyager 2',
  },
  triton: {
    id: 'triton',
    name: '海卫一',
    nameEn: 'Triton',
    type: 'moon',
    parentId: 'neptune',
    radiusKm: 1353.4,
    axialTiltDeg: 0,
    rotationPeriodHours: -141.04, // 逆行公转与自转
    orbitSemiMajorAxisKm: 354760,
    orbitPeriodDays: -5.877, // 逆行
    orbitalInclinationDeg: 156.8, // 逆行轨道倾角
    colorHex: 0x67e8f9,
    hasAtmosphere: true,
    observationTip: '海卫一是太阳系唯一逆行公转的大卫星，地表像哈密瓜皮一样奇特，正在向太空喷发零下 235 度的液氮黑冰喷泉！',
    description: '海卫一是被海王星从柯伊伯带引力捕获的矮行星，拥有全太阳系最冷的地表（-235°C）。表面呈现特有的“哈密瓜皮”（Cantaloupe）构造冰凹陷，旅行者 2 号探测器拍摄到了高达 8 公里的氮气与有机黑烟柱冰火山喷发。',
    funFact: '因为海卫一是倒着（逆行）绕海王星转的，潮汐力正在使它越来越靠近海王星，预计 36 亿年后它将被撕碎，化作环绕海王星的无敌超大光环！',
    colorAssetId: 'moon-svs-2025-2k',
    sourceRef: 'NASA Voyager 2',
  },
  proteus: {
    id: 'proteus',
    name: '海卫八',
    nameEn: 'Proteus',
    type: 'moon',
    parentId: 'neptune',
    radiusKm: 210.0,
    dimensionsKm: [424, 390, 396],
    shapeType: 'irregular',
    axialTiltDeg: 0,
    rotationPeriodHours: 26.9,
    orbitSemiMajorAxisKm: 117647,
    orbitPeriodDays: 1.122,
    orbitalInclinationDeg: 0.55,
    colorHex: 0x525252,
    observationTip: '海卫八是一颗巨大的“方盒状”不规则暗色巨石，它是物体在不被自身重力压成球体下的物理极限尺寸！',
    description: '海卫八是海王星第二大卫星，表面极度深暗（反射率仅 6%）。其直径约 420 公里，物理学家认为它是天体在不坍塌为流体静力平衡圆球体前提下的理论最大尺寸极限。表面有巨大的法罗斯（Pharos）撞击坑。',
    funFact: '海卫八比著名的死星土卫一还要大，但因为长相太不规则太黑，当年人类一直没发现它，直到旅行者 2 号近距飞掠才现出真容！',
    colorAssetId: 'moon-svs-2025-2k',
    sourceRef: 'NASA Voyager 2',
  },
};

/**
 * 局部场景单位换算：1 Scene Unit = 1000 km (局部特写模式)
 */
export const KM_PER_SCENE_UNIT = 1000.0;

export interface RenderTransform {
  renderPosition: [number, number, number];
  renderRadius: number;
}

/**
 * 将双精度公里物理坐标转换为 GPU 局部渲染坐标（局部特写模式）
 */
export function computeRenderTransform(
  physicalPosKm: [number, number, number],
  focusOriginKm: [number, number, number],
  radiusKm: number
): RenderTransform {
  const relX = (physicalPosKm[0] - focusOriginKm[0]) / KM_PER_SCENE_UNIT;
  const relY = (physicalPosKm[1] - focusOriginKm[1]) / KM_PER_SCENE_UNIT;
  const relZ = (physicalPosKm[2] - focusOriginKm[2]) / KM_PER_SCENE_UNIT;
  const renderRadius = radiusKm / KM_PER_SCENE_UNIT;

  return {
    renderPosition: [relX, relY, relZ],
    renderRadius,
  };
}

/**
 * 导航尺度（宏观太阳系全景）轨道半长轴换算
 * 使用平方根对数混合压缩算法，使水星到海王星在视口中均匀舒适展开
 * Mercury (0.39 AU) -> ~18 units
 * Earth (1.00 AU)   -> ~32 units
 * Jupiter (5.20 AU) -> ~72 units
 * Saturn (9.58 AU)  -> ~98 units
 * Neptune (30.0 AU) -> ~175 units
 */
export function getNavOrbitRadius(semiMajorAxisKm: number): number {
  if (semiMajorAxisKm <= 0) return 0;
  const au = semiMajorAxisKm / 149598023.0;
  // 基础半径 12 + 平方根扩散
  return 12.0 + Math.sqrt(au) * 20.0 + Math.log10(au + 0.1) * 8.0;
}

/**
 * 导航尺度（宏观全景与微观特写）下的天体展示视觉半径
 * 采用视觉感知幂律缩放 (Perceptual Power-Law, γ = 0.52)，以地球 (6371km) = 1.35 为基准：
 *   太阳 (696340km) → 8.50 (中心霸主，光辉灿烂)
 *   木星 (69911km)  → 4.70 (气态巨行星霸主，盘面面积约为地球 12 倍)
 *   土星 (58232km)  → 4.27 (含光环延伸至 10.03，宏伟震撼)
 *   天王星(25362km) → 2.77 (冰巨星，清晰介于气态巨星与类地行星之间)
 *   海王星(24622km) → 2.73 (冰巨星)
 *   地球 (6371km)   → 1.35 (类地行星基准)
 *   金星 (6052km)   → 1.31 (地球姊妹星)
 *   火星 (3390km)   → 0.97 (袖珍红色星球)
 *   水星 (2440km)   → 0.82 (最内侧致密岩石星)
 *   月球 (1737km)   → 0.69 (卫星自然层级)
 *   微卫星          → 最小保底 0.38-0.42，确保拾取命中与亲子辨识
 */
export function getNavDisplayRadius(radiusKm: number, type: string): number {
  if (type === 'star') {
    return 8.5; // 太阳在宏观全景中具有绝对统领感，同时不遮挡水星轨道 (半长轴 ~18.0)
  }

  // 幂律映射：R_display = 1.35 * (radiusKm / 6371.0) ^ 0.52
  // 在保留天文学真实体积量级层级的同时，压缩过大的物理动态范围
  const normalized = Math.max(10.0, radiusKm) / 6371.0;
  const computed = 1.35 * Math.pow(normalized, 0.52);

  // 约束范围：微小卫星保底 0.38，巨行星上限 4.70
  return Math.max(0.38, Math.min(4.70, computed));
}

export const PLANET_INITIAL_PHASES: Record<string, number> = {
  mercury: 0.85,  // ~49°
  venus: 2.25,    // ~129°
  earth: 3.65,    // ~209°
  mars: 5.25,     // ~301°
  jupiter: 1.45,  // ~83°
  saturn: 3.15,   // ~180°
  uranus: 4.60,   // ~264°
  neptune: 0.25,  // ~14°
};

/**
 * 计算行星绕太阳公转的导航坐标（含轨道倾角与自然黄道初相）
 */
export function getPlanetNavPosition(
  bodyId: BodyId,
  simTimeHours: number
): [number, number, number] {
  const body = BODIES[bodyId];
  if (!body || body.type === 'star' || body.orbitPeriodDays <= 0) {
    return [0, 0, 0];
  }

  const orbitRadius = getNavOrbitRadius(body.orbitSemiMajorAxisKm);
  const periodHours = body.orbitPeriodDays * 24.0;
  const initialPhase = PLANET_INITIAL_PHASES[bodyId] || 0;
  const angleRad = ((2.0 * Math.PI) / periodHours) * simTimeHours + initialPhase;
  const inclinationRad = ((body.orbitalInclinationDeg || 0) * Math.PI) / 180.0;

  const x = orbitRadius * Math.cos(angleRad);
  const y = orbitRadius * Math.sin(angleRad) * Math.sin(inclinationRad);
  const z = orbitRadius * Math.sin(angleRad) * Math.cos(inclinationRad);

  return [x, y, z];
}

/**
 * 计算卫星相对母星的局部物理距离与方位（单位：km）
 */
export function getMoonPositionKm(timeHours: number): [number, number, number] {
  const moonOrbitPeriodHours = 27.3216 * 24.0;
  const angleRad = ((2 * Math.PI) / moonOrbitPeriodHours) * timeHours;
  const distanceKm = 384400.0;
  const inclinationRad = (5.14 * Math.PI) / 180.0;

  const x = distanceKm * Math.cos(angleRad);
  const y = distanceKm * Math.sin(angleRad) * Math.sin(inclinationRad);
  const z = distanceKm * Math.sin(angleRad) * Math.cos(inclinationRad);

  return [x, y, z];
}

export const SATELLITE_INITIAL_PHASES: Record<string, number> = {
  moon: 0.6,
  phobos: 0.3,
  deimos: 3.5,
  io: 0.8,
  europa: 2.4,
  ganymede: 4.1,
  callisto: 5.6,
  amalthea: 1.8,
  mimas: 0.4,
  enceladus: 4.5,
  tethys: 1.7,
  dione: 3.1,
  rhea: 5.0,
  titan: 1.2,
  hyperion: 2.8,
  iapetus: 4.2,
  miranda: 0.9,
  ariel: 2.1,
  umbriel: 3.6,
  titania: 4.8,
  oberon: 0.3,
  triton: 1.5,
  proteus: 3.9,
};

/**
 * 局部场景坐标系下卫星相对母星的视觉位置（单位：场景 3D 单位）
 * 依据开普勒真实物理周期、真实轨道倾角与审美缩放，
 * 既保证空间上层次分明绝不相互穿模，又忠实呈现开普勒公转动态（如海卫一逆行）
 */
export function getSatelliteNavPosition(
  satelliteId: BodyId,
  timeHours: number
): [number, number, number] {
  const sat = BODIES[satelliteId];
  if (!sat || !sat.parentId || Math.abs(sat.orbitPeriodDays) <= 0) {
    return [0, 0, 0];
  }

  const parent = BODIES[sat.parentId];
  const parentR = parent ? getNavDisplayRadius(parent.radiusKm, parent.type) : 3.0;

  // 基础净距：行星半径加上额外安全观察间距（避免被光环遮挡，或与特写相机视界穿模挤压）
  const baseClearance = parent?.ringConfig
    ? parentR * (parent.ringConfig.outerRadiusRatio + 0.38)
    : parentR * 2.65;

  // 依据真实半长轴平滑幂次扩展，卫星从内到外错落有致
  const normDist = Math.pow((sat.orbitSemiMajorAxisKm || 100000) / 100000.0, 0.52);
  const visualOrbitR = baseClearance + normDist * (parentR * 1.35);

  const periodHours = Math.abs(sat.orbitPeriodDays) * 24.0;
  const initialPhase = SATELLITE_INITIAL_PHASES[satelliteId] || 0;
  // 逆行公转由大于 90 度的轨道倾角（如海卫一 156.8°）自然表达，周期统一取绝对值避免重复反转
  const angleRad = ((2.0 * Math.PI) / periodHours) * timeHours + initialPhase;
  const incRad = ((sat.orbitalInclinationDeg || 0) * Math.PI) / 180.0;

  const x = visualOrbitR * Math.cos(angleRad);
  const y = visualOrbitR * Math.sin(angleRad) * Math.sin(incRad);
  const z = visualOrbitR * Math.sin(angleRad) * Math.cos(incRad);

  return [x, y, z];
}

/**
 * 通用卫星相对母星的局部物理位置（单位：km）
 */
export function getSatelliteRelativePositionKm(
  satelliteId: BodyId,
  timeHours: number
): [number, number, number] {
  const sat = BODIES[satelliteId];
  if (!sat || Math.abs(sat.orbitPeriodDays) <= 0) {
    return [0, 0, 0];
  }

  const periodHours = Math.abs(sat.orbitPeriodDays) * 24.0;
  const angleRad = ((2.0 * Math.PI) / periodHours) * timeHours;
  const distKm = sat.orbitSemiMajorAxisKm;
  const incRad = ((sat.orbitalInclinationDeg || 0) * Math.PI) / 180.0;

  const x = distKm * Math.cos(angleRad);
  const y = distKm * Math.sin(angleRad) * Math.sin(incRad);
  const z = distKm * Math.sin(angleRad) * Math.cos(incRad);

  return [x, y, z];
}

/**
 * 行星与卫星地质/风暴标志性景观初始观赏相位偏置表 (弧度)
 * 确保相机飞抵天体时，标志性特征（如海王星大暗斑、月球正面月海、火卫一斯蒂克尼巨坑、木卫一熔岩湖）处于向阳正面黄金视线
 */
export const PLANET_SPIN_OFFSETS: Record<string, number> = {
  neptune: 2.65, // 将海王星标志性大暗斑 (Great Dark Spot) 与伴生滑行者白卷云正对向阳正面黄金视线
  uranus: 0.85,  // 优化极地烟雾帽与同心喷流带的立体晨昏侧光
  moon: 0.0,     // 确保月球正面（风暴洋、雨海、澄海与第谷辐射纹）正对进场黄金视角
  phobos: -0.46, // 确保火卫一斯蒂克尼巨型陨石坑处于向阳受光立体构图面
  deimos: -0.46, // 火卫二伏尔泰/斯威夫特撞击坑与浅色碎屑流受光面
  io: 0.65,       // 木卫一 Loki 熔岩湖与 Pele 巨型同心红环正对向阳黄金视角
  europa: -0.85,  // 木卫二 Conamara 混沌碎冰区与 Pwyll 冰裂纹放射核心受光面
  ganymede: 0.85, // 木卫三古老暗区 Galileo Regio 与年轻冰槽 Uruk Sulci 交界受光面
  callisto: 3.14, // 木卫四瓦尔哈拉 (Valhalla) 巨型同心环多重断崖盆地受光面
};
