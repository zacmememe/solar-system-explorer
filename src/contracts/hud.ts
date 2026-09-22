import type { BodyId } from './body';
import type { CameraStateSnapshot } from './camera';

export type HudVector = readonly [number, number, number];

/** Read-only visualization coordinates. Never present them as km or live ephemerides. */
export interface HudFrame {
  readonly sequence: number;
  readonly simTimeHours: number;
  readonly isPaused: boolean;
  readonly timeScale: number;
  readonly camera: CameraStateSnapshot;
  readonly observerPosition: HudVector;
  readonly bodies: readonly { readonly id: BodyId; readonly position: HudVector }[];
}
