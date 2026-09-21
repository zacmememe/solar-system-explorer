/**
 * 相机控制器契约
 * 依据 01-REBUILD-PLAN.zh-CN.md 第 8 节定义
 * 铁律：唯一主人，禁止隐式自动回正，支持打断，单调递增 commandId
 */

import type { BodyId } from './body';

export type CameraMode = 'OVERVIEW' | 'ORBIT_TARGET' | 'TRANSITION';

export interface CameraStateSnapshot {
  mode: CameraMode;
  targetBodyId: BodyId | null;
  selectedBodyId: BodyId | null;
  distanceToTarget: number;
  minDistance: number;
  maxDistance: number;
  commandId: number;
  isTransitioning: boolean;
  spherical: {
    radius: number;
    phi: number;
    theta: number;
  };
}

export type CameraCommand =
  | { type: 'select'; bodyId: BodyId }
  | { type: 'flyTo'; bodyId: BodyId; durationSec?: number; targetPos?: [number, number, number] }
  | { type: 'cancelFlight' }
  | { type: 'orbit'; deltaPhi: number; deltaTheta: number }
  | { type: 'zoom'; deltaDist: number }
  | { type: 'overview' }
  | {
      type: 'restoreBookmark';
      targetBodyId: BodyId;
      spherical: { radius: number; phi: number; theta: number };
      durationSec?: number;
    };

