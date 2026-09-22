/**
 * 书签与观察点存档数据契约 (V1/V2 规范)
 * 遵循主方案第 10 节规范：
 * 1. 支持版本升级（V1 保持向后兼容解析，V2 存储展示策略、时间 Epoch 与固连参数）；
 * 2. 杜绝将旧版本标量 radius 误当物理米制高度；
 * 3. 严格类型校验与升级迁移器。
 */

import type { BodyId } from './body';
import type { ViewCameraMode, VehicleId } from './vehicle';
import type { CameraLookTarget } from './camera';

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

export type BookmarkItem = BookmarkItemV2;

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
      showOrbits: raw.layers?.showOrbits ?? true,
      venusRadarMode: raw.layers?.venusRadarMode ?? false,
    },
    simTimeHours: typeof raw.simTimeHours === 'number' ? raw.simTimeHours : 0,
    createdAtIso: raw.createdAtIso || new Date().toISOString(),
    notes: raw.notes,
    isPreset: raw.isPreset,
  };
}

export interface BookmarkExportPackage {
  app: 'solar-system-explorer';
  schemaVersion: 2;
  exportedAtIso: string;
  bookmarks: BookmarkItemV2[];
}
