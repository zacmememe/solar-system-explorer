import type { HudFrame } from '../../contracts/hud';
import type { LandingState } from '../../contracts/landing';

export type HudPhase = 'loading' | 'overview' | 'observe' | 'free' | 'transfer' | 'site_travel' | Lowercase<Exclude<LandingState, 'ORBIT'>>;

/** Explicit priority: landing motion owns its display even during a camera reframe. */
export function hudPhase(frame: HudFrame | null): HudPhase {
  if (!frame) return 'loading';
  const state = frame.landing?.telemetry.state;
  if (state && state !== 'ORBIT') return state.toLowerCase() as HudPhase;
  if (frame.landing?.siteTravel) return 'site_travel';
  if (frame.camera.isTransitioning) return 'transfer';
  if (frame.camera.mode === 'SURFACE_LOOK') return 'surface_look';
  if (frame.camera.mode === 'OVERVIEW') return 'overview';
  if (frame.camera.anchor?.kind === 'free') return 'free';
  return 'observe';
}

export const PHASE_LABEL: Record<HudPhase, string> = {
  loading: '连接观察机位', overview: '太阳系全景', observe: '天体观察', free: '自由观察',
  transfer: '切换观测目标', preparing: '准备降落', descending: '正在下降', hold: '悬停环顾',
  surface_look: '地表探索', ascending: '返回观星机位',
  site_travel: '绕行前往落区',
};
export const isSurfacePhase = (p: HudPhase) => ['preparing','descending','hold','surface_look','ascending'].includes(p);

/** Display is based on the actual surface camera. A planner's PREPARING default is not a measurement. */
export function observedAltitude(frame: HudFrame | null): number | null {
  if (!frame || hudPhase(frame) === 'preparing') return null;
  const height = frame.surface?.eyeHeightM;
  return height != null && Number.isFinite(height) ? height : null;
}
export function formatAltitude(m: number | null): string {
  if (m == null || !Number.isFinite(m)) return '—';
  if (Math.abs(m) >= 1000) return `${(m / 1000).toLocaleString('en-US',{maximumFractionDigits: m < 10000 ? 2 : m < 100000 ? 1 : 0})} km`;
  return `${m < 10 ? m.toFixed(1) : Math.round(m)} m`;
}
export function formatCoordinates(lat: number, lon: number): string {
  const lng = ((lon + 180) % 360 + 360) % 360 - 180;
  return `${Math.abs(lat).toFixed(2)}°${lat < 0 ? 'S' : 'N'} · ${Math.abs(lng).toFixed(2)}°${lng < 0 ? 'W' : 'E'}`;
}
export function bearingLabel(yaw: number): string {
  return ['北','东北','东','东南','南','西南','西','西北'][Math.round(((yaw % 360 + 360) % 360)/45)%8];
}
/** Log-height axis, labelled as such in the HUD. Never a geographic path or time estimate. */
export function altitudeAxis(m: number, ceilingM = 1000000): number {
  return Math.max(0, Math.min(1, 1 - Math.log10(Math.max(1, m)) / Math.log10(Math.max(10, ceilingM))));
}
export function altitudeStage(m: number | null): string {
  if (m == null) return '等待机位';
  return m > 100000 ? '高空进近' : m > 10000 ? '接近落区' : m > 100 ? '低空下降' : '近地下降';
}
