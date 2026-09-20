/**
 * 书签与观察点存档数据契约
 * 遵循 01-REBUILD-PLAN.zh-CN.md 第 8.2 节规范
 * 记录用户主动收藏的观察视角，杜绝依赖不可靠的绝对全局坐标
 */

import type { BodyId } from './body';
import type { ViewCameraMode, VehicleId } from './vehicle';

export interface BookmarkLayers {
  showClouds: boolean;
  showAtmosphere: boolean;
  teachingLight: boolean;
  showOrbits: boolean;
  venusRadarMode: boolean;
}

export interface BookmarkItem {
  id: string; // 唯一 UUID
  schemaVersion: 1;
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

export interface BookmarkExportPackage {
  app: 'solar-system-explorer';
  schemaVersion: 1;
  exportedAtIso: string;
  bookmarks: BookmarkItem[];
}
