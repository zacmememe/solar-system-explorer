/**
 * 相机控制器契约
 * 依据 01-REBUILD-PLAN.zh-CN.md 第 8 节定义
 * 铁律：唯一主人，禁止隐式自动回正，支持打断，单调递增 commandId
 */

import type { BodyId } from './body';

export type CameraMode = 'OVERVIEW' | 'ORBIT_TARGET' | 'TRANSITION' | 'SURFACE_LOOK';

export type CameraAnchor =
  | { kind: 'body'; bodyId: BodyId }
  | { kind: 'free'; pivotScene: [number, number, number] }
  | { kind: 'surface'; bodyId: BodyId; lat: number; lon: number; eyeHeightM: number };

export type CameraLookTarget =
  | { kind: 'center' }
  | { kind: 'body'; bodyId: BodyId }
  | { kind: 'point'; point: [number, number, number] };

export interface CameraStateSnapshot {
  mode: CameraMode;
  anchor?: CameraAnchor;
  lookTarget?: CameraLookTarget;
  surfaceOrientation?: {
    yawDeg: number;
    pitchDeg: number;
  };
  targetBodyId: BodyId | null;
  selectedBodyId: BodyId | null;
  sourceBodyId?: BodyId | null;
  transitionProgress?: number;
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
  | { type: 'flyTo'; bodyId: BodyId; durationSec?: number; targetPos?: [number, number, number]; lookTarget?: CameraLookTarget }
  | { type: 'cancelFlight' }
  | { type: 'orbit'; deltaPhi: number; deltaTheta: number }
  | { type: 'zoom'; deltaDist: number }
  | { type: 'zoomInput'; logDelta: number }
  | { type: 'overview' }
  | { type: 'setLookTarget'; lookTarget: CameraLookTarget }
  | {
      type: 'restoreBookmark';
      targetBodyId: BodyId;
      spherical: { radius: number; phi: number; theta: number };
      durationSec?: number;
      lookTarget?: CameraLookTarget;
    }
  | {
      type: 'focusRegion';
      bodyId: BodyId;
      lat: number;
      lon: number;
      altitude?: number;
      durationSec?: number;
    }
  | {
      type: 'enterSurfaceLook';
      bodyId: BodyId;
      lat: number;
      lon: number;
      eyeHeightM?: number;
      initialYawDeg?: number;
      initialPitchDeg?: number;
    }
  | {
      type: 'setSurfaceLook';
      yawDeg: number;
      pitchDeg: number;
    }
  | {
      type: 'lookAtSkyTarget';
      targetBodyId: BodyId;
    };


