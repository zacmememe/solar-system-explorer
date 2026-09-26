import type { BodyId } from './body';
import type { CameraStateSnapshot } from './camera';
import type { LandingAvailability, LandingSite, LandingTelemetry } from './landing';

export type HudVector = readonly [number, number, number];

/** One engine sample, after the camera update. No UI polling clock. */
export interface HudLandingFrame {
  readonly telemetry: LandingTelemetry;
  readonly availability: LandingAvailability;
  readonly sites: readonly LandingSite[];
  readonly preparation: {
    readonly active: boolean;
    readonly phase: 'policy' | 'lighting' | 'capture' | null;
    readonly lightingAdjustedSimHours: number | null;
  };
}

/** Actual displayed observer pose, not the descent planner's nominal view. */
export interface HudSurfaceObservation {
  readonly bodyId: BodyId;
  readonly lat: number;
  readonly lon: number;
  readonly eyeHeightM: number;
  readonly datumHeightM: number;
  readonly yawDeg: number;
  readonly pitchDeg: number;
}

/** Read-only visualization coordinates. Never present them as km or live ephemerides. */
export interface HudFrame {
  readonly sequence: number;
  readonly simTimeHours: number;
  readonly isPaused: boolean;
  readonly timeScale: number;
  readonly camera: CameraStateSnapshot;
  readonly observerPosition: HudVector;
  readonly bodies: readonly { readonly id: BodyId; readonly position: HudVector }[];
  readonly landing?: HudLandingFrame;
  readonly surface?: HudSurfaceObservation | null;
}
