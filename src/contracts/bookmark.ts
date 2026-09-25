/**
 * 书签与观察点存档数据契约 (V1/V2/V3 规范)
 * 遵循主方案规范与 260923 Pro Model 优化审计：
 * 1. 严格支持版本平滑升级（V1 -> V2 -> V3）；
 * 2. V3 规范：增加地表米制站点描述符 (MetricStation)、多重观察模式 (observationMode)、姿态解算品质 (quality) 与数据溯源版本 (sourceVersion)；
 * 3. 杜绝将旧版本标量 radius 误当物理米制高度；
 * 4. 严格类型校验与向下兼容升级迁移器。
 */

import type { BodyId } from './body';
import type { ViewCameraMode, VehicleId } from './vehicle';
import type { CameraLookTarget } from './camera';
import type { MetricStation, PoseQuality } from './physics';

export type PresentationPolicy = 'NAV_SCHEMATIC' | 'PHYSICAL_OBSERVATION';

export interface BookmarkLayers {
  showClouds: boolean;
  showAtmosphere: boolean;
  teachingLight: boolean;
  showOrbits: boolean;
  venusRadarMode: boolean;
}

export interface BookmarkItemV1 {
  id: string;
  schemaVersion?: 1;
  title: string;
  targetBodyId: BodyId;
  spherical: {
    radius: number;
    phi: number;
    theta: number;
  };
  viewCameraMode: ViewCameraMode;
  vehicleId: VehicleId | null;
  layers: BookmarkLayers;
  simTimeHours: number;
  createdAtIso: string;
  notes?: string;
  isPreset?: boolean;
}

export interface BookmarkItemV2 {
  id: string;
  schemaVersion: 2;
  title: string;
  targetBodyId: BodyId;
  presentationPolicy: PresentationPolicy;
  epochIso: string;
  spherical: {
    radius: number;
    phi: number;
    theta: number;
  };
  lookTarget?: CameraLookTarget;
  geographicCoord?: {
    lat: number;
    lon: number;
    altitudeKm: number;
  };
  viewCameraMode: ViewCameraMode;
  vehicleId: VehicleId | null;
  layers: BookmarkLayers;
  simTimeHours: number;
  createdAtIso: string;
  notes?: string;
  isPreset?: boolean;
}

/**
 * 观察意图统一语义 (P1 收窄)：
 * - physical: 物理观测（真实昼夜、云层与时间）
 * - terrain-study: 地貌观察（隐藏云层 + 参考照明，模拟时间不变）
 * 历史遗留标签 ('PHYSICAL'/'TERRAIN'/'RADAR'/'NIGHT_LIGHTS') 仅在迁移时归一映射，不再出现在新数据。
 */
export type ObservationIntent = 'physical' | 'terrain-study';

export function normalizeObservationIntent(raw: unknown): ObservationIntent {
  if (raw === 'terrain-study' || raw === 'TERRAIN' || raw === 'RADAR') return 'terrain-study';
  return 'physical';
}

export interface BookmarkItemV3 {
  id: string;
  schemaVersion: 3;
  title: string;
  targetBodyId: BodyId;
  presentationPolicy: PresentationPolicy;
  epochIso: string;
  spherical: {
    radius: number;
    phi: number;
    theta: number;
  };
  lookTarget?: CameraLookTarget;
  geographicCoord?: {
    lat: number;
    lon: number;
    altitudeKm: number;
  };
  /** 地表米制站点 (仅地面停驻观察时存在；V1/V2 迁移不伪造) */
  surfaceStation?: MetricStation;
  /** 观察意图 */
  observationMode?: ObservationIntent;
  quality?: PoseQuality;
  sourceVersion?: string;
  /** Optional V3 extension. Old bookmarks preserve the current playback controls. */
  simulation?: { isPaused: boolean; timeScale: number };
  viewCameraMode: ViewCameraMode;
  vehicleId: VehicleId | null;
  layers: BookmarkLayers;
  simTimeHours: number;
  createdAtIso: string;
  notes?: string;
  isPreset?: boolean;
}

export type BookmarkItem = BookmarkItemV3;

/**
 * 自动将任何版本的书签平滑升级为 V2 规范
 */
export function upgradeBookmarkToV2(raw: any): BookmarkItemV2 {
  if (raw && raw.schemaVersion === 2) {
    return {
      ...raw,
      presentationPolicy: raw.presentationPolicy || 'NAV_SCHEMATIC',
      epochIso: raw.epochIso || '2026-09-22T00:00:00Z',
      lookTarget: raw.lookTarget,
      vehicleId: raw.vehicleId ?? null,
    };
  }

  // V1 兼容升级
  return {
    id: raw.id || `bm-${Date.now()}`,
    schemaVersion: 2,
    title: raw.title || '未命名观察点',
    targetBodyId: raw.targetBodyId || 'earth',
    presentationPolicy: 'NAV_SCHEMATIC', // 旧书签均为宏观导航模式
    epochIso: '2026-09-22T00:00:00Z',
    spherical: {
      radius: typeof raw.spherical?.radius === 'number' ? raw.spherical.radius : 6.2,
      phi: typeof raw.spherical?.phi === 'number' ? raw.spherical.phi : Math.PI / 2.22,
      theta: typeof raw.spherical?.theta === 'number' ? raw.spherical.theta : Math.PI / 4,
    },
    lookTarget: raw.lookTarget,
    geographicCoord: raw.geographicCoord,
    viewCameraMode: raw.viewCameraMode || 'PLANET_OBSERVE',
    vehicleId: raw.vehicleId ?? null,
    layers: {
      showClouds: raw.layers?.showClouds ?? true,
      showAtmosphere: raw.layers?.showAtmosphere ?? true,
      teachingLight: raw.layers?.teachingLight ?? false,
      showOrbits: raw.layers?.showOrbits ?? false, // S2：轨迹线已移除——字段仅存 v3 兼容，不再消费
      venusRadarMode: raw.layers?.venusRadarMode ?? false,
    },
    simTimeHours: typeof raw.simTimeHours === 'number' ? raw.simTimeHours : 0,
    createdAtIso: raw.createdAtIso || new Date().toISOString(),
    notes: raw.notes,
    isPreset: raw.isPreset,
  };
}

/**
 * 自动将任何版本的书签平滑升级为 V3 规范
 * 保留历史经纬高程与观察意图；V1/V2 本就不含米制地表站点，迁移不伪造 surfaceStation，
 * 旧杂项观察标签归一为 physical/terrain-study 两种语义。
 */
export function upgradeBookmarkToV3(raw: any): BookmarkItemV3 {
  if (raw && raw.schemaVersion === 3) {
    return {
      ...raw,
      presentationPolicy: raw.presentationPolicy || 'NAV_SCHEMATIC',
      epochIso: raw.epochIso || '2026-09-22T00:00:00Z',
      observationMode: normalizeObservationIntent(raw.observationMode),
      quality: raw.quality || 'analytic-approximation',
      sourceVersion: raw.sourceVersion || '2026.09-P1-V3',
      vehicleId: raw.vehicleId ?? null,
    };
  }

  // V1/V2 先平滑升级为 V2，再无损迁移为 V3；不携带旧版本没有的米制地表站点
  const v2 = upgradeBookmarkToV2(raw);
  return {
    ...v2,
    schemaVersion: 3,
    observationMode: normalizeObservationIntent(raw.observationMode),
    quality: 'analytic-approximation',
    sourceVersion: '2026.09-P1-V3',
  };
}

export interface BookmarkExportPackage {
  app: 'solar-system-explorer';
  schemaVersion: 3;
  exportedAtIso: string;
  bookmarks: BookmarkItemV3[];
}
