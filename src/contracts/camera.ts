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
  /** Intended framing on arrival; observing the Sun and overview are different intents. */
  destinationMode?: 'OVERVIEW' | 'ORBIT_TARGET';
  distanceToTarget: number;
  minDistance: number;
  maxDistance: number;
  commandId: number;
  isTransitioning: boolean;
  navigationBlocked?: boolean;
  spherical: {
    radius: number;
    phi: number;
    theta: number;
  };
}

export type CameraCommand =
  | { type: 'select'; bodyId: BodyId }
  | { type: 'flyTo'; bodyId: BodyId; durationSec?: number; targetPos?: [number, number, number]; viewDirection?: [number, number, number]; lookTarget?: CameraLookTarget; /** Destination framing, independent of a small distant sky proxy. */ framingRadius?: number; /** P3b-A：true 时 targetPos 为精确相机终点（世界系）；缺省沿用向阳面构图导引 */ exact?: boolean }
  | { type: 'cancelFlight' }
  | { type: 'orbit'; deltaPhi: number; deltaTheta: number }
  | { type: 'zoom'; deltaDist: number }
  | { type: 'zoomInput'; logDelta: number }
  | { type: 'overview' }
  | { type: 'setLookTarget'; lookTarget: CameraLookTarget }
  | {
      type: 'restoreBookmark';
      destinationMode?: 'OVERVIEW' | 'ORBIT_TARGET';
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
      /** P3b-A：完整世界系四元数（含滚转）。提供时直接采用，绕过 yaw/pitch 重建——
       * 轨道相机的 up 是世界 Y，yaw/pitch 重建用局部 up，两者滚转不同，
       * 无法用 yaw/pitch 表达任意起始姿态（首帧 q0 保持的关键）。 */
      orientationQuat?: [number, number, number, number];
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
