/**
 * 载具资产准入注册表 VehicleAssetRegistry
 * 遵循第二轮优化审计 R4 要求：
 * 记录出处、许可、source/derived hash、格式、米制变换、实测 bounds 与准入状态。
 */

import type { VehicleId } from '../contracts/vehicle';
import { SELECTABLE_VEHICLE_IDS } from '../contracts/vehicle';
import { VEHICLE_CATALOG } from './VehicleCatalog';

export interface VehicleAssetRecord {
  id: VehicleId;
  name: string;
  nameEn: string;
  format: 'glb' | 'procedural';
  assetPath?: string;
  source: string;
  sourceUrl?: string;
  author?: string;
  license: string;
  fileSize?: number;
  sha256?: string;
  etag?: string;
  isFeatured: boolean;
  metricScale: number; // 统一米制缩放系数
  calibratedMetres?: boolean;
  preserveMaterialSide?: boolean;
  presentation?: {span:number;rotation:[number,number,number]};
  calibratedDimensionsM: {
    lengthM: number;
    widthM: number;
    heightM: number;
  };
  hotspots: Array<{
    id: string;
    name: string;
    localPosM: [number, number, number];
    kidTip: string;
    scienceDetail: string;
  }>;
  approved: boolean;
  approvalDateIso: string;
  notes: string;
}

export const VEHICLE_ASSET_REGISTRY: Record<VehicleId, VehicleAssetRecord> = {
  juno: packagedVehicle('juno','7e16e9494fe65c3c4ac058a65a02cf0f890f3c613a1d3c051597337b123b5af4',9727448,.8),
  'space-shuttle': packagedVehicle('space-shuttle','948ccb7e7a15f830eff9029f8f8dd993b99f4d50d31e96dc53533085d8a0a221',6586336,.6375,[.24,Math.PI+.58,0]),
  hubble: {
    id: 'hubble',
    name: '哈勃太空望远镜',
    nameEn: 'Hubble Space Telescope (HST)',
    format: 'glb',
    assetPath: '/assets/models/hubble-nasa-b.glb',
    source: 'NASA Science / Goddard Space Flight Center (GSFC) 3D Resources',
    sourceUrl: 'https://science.nasa.gov/3d-resources/hubble-space-telescope-b/',
    author: 'Matthew G. Sanders (NASA GSFC)',
    license: 'NASA Open Data / Public Domain',
    fileSize: 5140096,
    sha256: 'FC2690F5806BCBE39EA534735B0AFEA9BD268AB89203A05C46E8C418CEB88489',
    etag: '4e6e80-6308fa13007c0',
    isFeatured: true,
    metricScale: 1.0, // 官方 NASA 模型按标准几何尺度导入
    calibratedDimensionsM: {
      lengthM: 13.2,
      widthM: 4.2,
      heightM: 4.2,
    },
    hotspots: [
      {
        id: 'primary-mirror',
        name: '2.4 米超高精度主镜',
        localPosM: [0, 1.2, 0],
        kidTip: '主镜就像一块巨大的银色聚光盘，表面光滑得如果有一块大陆那么大，最大的颠簸也不超过几厘米！',
        scienceDetail: '有效口径 2.4 米的双曲面反射镜，采用康宁超低膨胀玻璃制成，表面镀有超纯铝和氟化镁反射涂层。',
      },
      {
        id: 'solar-arrays',
        name: '双翼柔性太阳翼',
        localPosM: [3.8, 0, 0],
        kidTip: '左右两面宽大的太阳翼像翅膀一样张开，随着望远镜绕地球飞行自动转动追踪阳光提供电能。',
        scienceDetail: '由欧洲空间局研制的柔性硅光伏电池阵列，经历多次航天飞机太空维护升级，输出稳定充沛的直流电。',
      },
      {
        id: 'aperture-door',
        name: '活动遮光保护门',
        localPosM: [0, 4.8, 0],
        kidTip: '镜筒顶部的翻盖小门！在火箭发射时关得紧紧的，进入太空后才缓缓打开，防止任何杂散光或太阳强光直射！',
        scienceDetail: '电动可开闭式镜筒前端遮光挡板，当望远镜指向接近太阳方向时会自动迅速闭合以保护精密感光元件。',
      },
      {
        id: 'wfc3-camera',
        name: '第三代广角行星相机 (WFC3)',
        localPosM: [0, -3.2, 0],
        kidTip: '望远镜的心脏照相机！宇航员叔叔曾专门坐航天飞机上天给它换上这个最新的超级数码相机！',
        scienceDetail: '安装在望远镜轴向仪器舱，覆盖从近紫外、可见光到近红外的超宽光谱波段，成像锐度极高。',
      },
    ],
    approved: true,
    approvalDateIso: '2026-09-22T18:00:00Z',
    notes: '已核验官方公开 GLB 资源，Draco 解码器离线部署在 /draco/，保留原厂 PBR 材质。',
  },
  iss: {
    id: 'iss',
    name: '国际空间站',
    nameEn: 'International Space Station (ISS)',
    format: 'procedural',
    source: 'NASA International Space Station Facts & Figures (Reference Model)',
    sourceUrl: 'https://www.nasa.gov/international-space-station/',
    author: 'Solar System Explorer Geometry Engine',
    license: 'MIT / Project Custom',
    isFeatured: true,
    metricScale: 1.0,
    calibratedDimensionsM: {
      lengthM: 109.0,
      widthM: 73.0,
      heightM: 20.0,
    },
    hotspots: [
      {
        id: 'solar-arrays',
        name: '巨大太阳能电池翼',
        localPosM: [0, 0, 0],
        kidTip: '展开后长达上百米，像大翅膀一样自动转动追踪太阳，为整个空间站提供源源不断的电能。',
        scienceDetail: '总面积达 2400 平方米，可输出高达 120 千瓦电功率。',
      },
      {
        id: 'cupola',
        name: '穹顶观测舱 (Cupola)',
        localPosM: [0, -1.5, 2.0],
        kidTip: '空间站上的大天窗！拥有 7 扇坚固的防辐射观察窗，宇航员在这里俯瞰美丽的蓝色地球。',
        scienceDetail: '由欧洲空间局建造，是空间站机器人遥控操作与地球光学观测的最佳视窗。',
      },
    ],
    approved: true,
    approvalDateIso: '2026-09-22T18:00:00Z',
    notes: '用户广泛认可的高完成度空间站模型（含桁架、辐射散热板、全舱段与太阳翼）。',
  },
  'apollo-lm': {
    id: 'apollo-lm',
    name: '阿波罗登月舱',
    nameEn: 'Apollo 11 Lunar Module (Eagle)',
    format: 'procedural',
    source: 'NASA Apollo 11 Lunar Module Documentation',
    license: 'MIT / Legacy Procedural',
    isFeatured: false,
    metricScale: 1.0,
    calibratedDimensionsM: { lengthM: 9.4, widthM: 9.4, heightM: 7.04 },
    hotspots: [
      {
        id: 'ascent-stage',
        name: '上升级座舱',
        localPosM: [0, 2.2, 0],
        kidTip: '宇航员叔叔就是站在这个带有两扇三角形小窗户的紧凑舱室里驾驶飞船的！',
        scienceDetail: '上升级包含乘员舱、环境控制系统、反应控制姿态喷管以及起飞推进发动机。',
      },
      {
        id: 'gold-mylar',
        name: '金箔隔热层',
        localPosM: [0, 0.8, 0],
        kidTip: '金灿灿的衣服不是金子做的，而是高科技反光隔热膜，防止太空极度严寒或暴晒！',
        scienceDetail: '由镀铝聚酰亚胺薄膜（Kapton/Mylar）层叠组成的多层隔热层（MLI），用于抵御无大气环境下的极端辐射热。',
      },
    ],
    approved: false,
    approvalDateIso: '2026-09-22T18:00:00Z',
    notes: '归类至全部历史载具分区，保留兼容旧书签，待后续外部高精扫描模型准入。',
  },
  'voyager-1': {
    id: 'voyager-1',
    name: '旅行者 1 号',
    nameEn: 'Voyager 1',
    format: 'procedural',
    source: 'NASA JPL Voyager Interstellar Mission',
    license: 'MIT / Legacy Procedural',
    isFeatured: false,
    metricScale: 1.0,
    calibratedDimensionsM: { lengthM: 3.7, widthM: 3.7, heightM: 2.5 },
    hotspots: [
      {
        id: 'dish-antenna',
        name: '高增益天线大锅',
        localPosM: [0, 1.2, 0],
        kidTip: '直径 3.7 米的巨大白色天线像一把大伞，哪怕隔着 200 多亿公里，依然向地球发回微弱信号！',
        scienceDetail: 'X 波段与 S 波段抛物面高增益天线（HGA），负责在数十天文单位外与地球深空测控网（DSN）保持通信。',
      },
    ],
    approved: false,
    approvalDateIso: '2026-09-22T18:00:00Z',
    notes: '归类至全部历史载具分区，保留兼容旧书签。',
  },
  'james-webb': {
    id: 'james-webb',
    name: '詹姆斯·韦伯太空望远镜',
    nameEn: 'James Webb Space Telescope (JWST)',
    format: 'procedural',
    source: 'NASA / STScI James Webb Space Telescope',
    license: 'MIT / Legacy Procedural',
    isFeatured: false,
    metricScale: 1.0,
    calibratedDimensionsM: { lengthM: 20.2, widthM: 14.2, heightM: 8.0 },
    hotspots: [
      {
        id: 'primary-mirror',
        name: '18 块镀金六边形主镜',
        localPosM: [0, 1.8, 0],
        kidTip: '由超轻的金属铍制成，表面镀着比头发丝还薄 100 倍的真金，因为黄金反射红外线最强！',
        scienceDetail: '总有效口径 6.5 米，由 18 个独立的六边形子镜拼成，每个子镜背面有微米级压电致动器精确校准光轴。',
      },
    ],
    approved: false,
    approvalDateIso: '2026-09-22T18:00:00Z',
    notes: '归类至全部历史载具分区，保留兼容旧书签。',
  },
  tiangong: {
    id: 'tiangong',
    name: '中国天宫空间站',
    nameEn: 'Tiangong Space Station',
    format: 'procedural',
    source: 'CMSA 中国载人航天工程网官方数据',
    license: 'MIT / Legacy Procedural',
    isFeatured: false,
    metricScale: 1.0,
    calibratedDimensionsM: { lengthM: 37.0, widthM: 33.0, heightM: 10.0 },
    hotspots: [
      {
        id: 'tianhe-core',
        name: '天和核心舱',
        localPosM: [0, 0, 0],
        kidTip: '空间站的“大脑”和宇航员起居室，有舒适的独立卧室、卫生间、健身房和太空厨房！',
        scienceDetail: '全长 16.6 米，最大直径 4.2 米，负责空间站组合体统一管理控制、航天员生活起居与出舱活动。',
      },
    ],
    approved: false,
    approvalDateIso: '2026-09-22T18:00:00Z',
    notes: '归类至全部历史载具分区，保留兼容旧书签。',
  },
  cassini: {
    id: 'cassini',
    name: '卡西尼-惠更斯号',
    nameEn: 'Cassini-Huygens',
    format: 'procedural',
    source: 'NASA / JPL Cassini-Huygens Mission Documentation',
    license: 'MIT / Legacy Procedural',
    isFeatured: false,
    metricScale: 1.0,
    calibratedDimensionsM: { lengthM: 6.7, widthM: 4.0, heightM: 4.0 },
    hotspots: [
      {
        id: 'high-gain-dish',
        name: '4 米碳纤维高增益天线',
        localPosM: [0, 2.5, 0],
        kidTip: '不仅是通信大天线，在飞越土星光环时它还被转过来充当盾牌，抵挡微小碎冰尘埃的撞击！',
        scienceDetail: '直径 4 米的高精度双频抛物面反射天线，由意大利航天局研制。',
      },
    ],
    approved: false,
    approvalDateIso: '2026-09-22T18:00:00Z',
    notes: '归类至全部历史载具分区，保留兼容旧书签。',
  },
};

function packagedVehicle(id:VehicleId,sha256:string,fileSize:number,span:number,rotation:[number,number,number]=[.12,-.38,0]):VehicleAssetRecord {
  const def=VEHICLE_CATALOG[id];
  return {id,name:def.name,nameEn:def.nameEn,format:'glb',assetPath:`/assets/models/selected/${id}.glb`,
    source:'NASA 3D Resources · 项目装配与材质修整',sourceUrl:def.sourceRef,
    license:'NASA Media Usage Guidelines',fileSize,sha256,isFeatured:true,metricScale:1,calibratedMetres:false,
    calibratedDimensionsM:def.dimensions,hotspots:[],preserveMaterialSide:true,presentation:{span,rotation},
    approved:false,approvalDateIso:'',notes:'用户选择的集成候选；来源、装配与派生哈希见同目录 provenance.json。未独立批准或米制标定。'};
}
VEHICLE_ASSET_REGISTRY.cassini=packagedVehicle('cassini','52c0211f47ebe0bbd6304672d3642ab74ff348097b1caf37d30ead47561b7cc5',5951756,.82);
VEHICLE_ASSET_REGISTRY['voyager-1']=packagedVehicle('voyager-1','5c83c0af8a7ef08f992caac3572b02c98156f25be94445982d7e2f21d627055b',3271116,.95);
VEHICLE_ASSET_REGISTRY.iss.calibratedMetres=false;
VEHICLE_ASSET_REGISTRY.iss.presentation={span:.6375,rotation:[.12,-.38,0]};
VEHICLE_ASSET_REGISTRY.hubble.isFeatured=false;

export function getFeaturedVehicleIds(): VehicleId[] {
  return [...SELECTABLE_VEHICLE_IDS];
}

export function getAllVehicleIds(): VehicleId[] {
  return Object.keys(VEHICLE_ASSET_REGISTRY) as VehicleId[];
}

export function getVehicleAssetRecord(id: VehicleId): VehicleAssetRecord | undefined {
  return VEHICLE_ASSET_REGISTRY[id];
}
