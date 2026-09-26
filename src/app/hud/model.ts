import { BODIES, getPlanetNavPosition, getSatelliteNavPosition } from '../../astronomy/bodies';
import type { BodyId } from '../../contracts/body';
import type { HudFrame, HudVector } from '../../contracts/hud';

export const SPEEDS = [1, 10, 50, 200, 1000, 21600, 86400] as const;
export function speedLabel(speed: number): string {
  if (speed === 21600) return '6 小时 / 秒';
  if (speed === 86400) return '1 天 / 秒';
  return `${speed.toLocaleString('en-US')}×`;
}
export function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}
export function parentSystem(id: BodyId): BodyId {
  const b = BODIES[id];
  return (b?.type === 'moon' ? b.parentId : b?.id) || 'sun';
}
export function hasMoons(id: BodyId): boolean {
  return Object.values(BODIES).some(b => b.type === 'moon' && b.parentId === id);
}
export function formatPeriod(days: number): string {
  const n = Math.abs(days);
  if (!Number.isFinite(n) || n === 0) return '—';
  if (n < 1) return `${(n * 24).toFixed(1)} 小时`;
  if (n >= 365.25) return `${(n / 365.25).toFixed(1)} 年`;
  return `${n.toFixed(1)} 天`;
}
/** Static catalog quantity, explicitly NOT a live heliocentric range. */
export function orbitMetric(id: BodyId) {
  const b = BODIES[id];
  if (!b || b.type === 'star') return { label: '轨道半长轴', value: '—' };
  return b.type === 'moon'
    ? { label: `绕${BODIES[b.parentId!]?.name ?? '母星'}轨道半长轴`, value: `${Math.round(b.orbitSemiMajorAxisKm).toLocaleString('en-US')} km` }
    : { label: '绕太阳轨道半长轴', value: `${(b.orbitSemiMajorAxisKm / 149598023).toFixed(3)} AU` };
}
export function materialNote(id: BodyId, infrared: boolean): string {
  const observed: Record<string,string> = {
    io:'Galileo / Voyager 增强色拼图 · 非肉眼自然色，两极含插值',
    mimas:'Cassini 灰度观测拼图 · 保留拍摄阴影，球面未重建坑深',
    enceladus:'Cassini 紫外 / 红外增强色拼图 · 非肉眼自然色',
  };
  if (observed[id]) return observed[id] + '；图像未就绪时显示纯色球体';
  if (BODIES[id]?.type === 'moon' && id !== 'moon') {
    return id === 'titan' && infrared ? '近红外外观示意 · 程序纹理，非探测器原图' : '程序纹理示意 · 非探测器原图';
  }
  return '贴图来源见项目资产清单；显示经过光照与色调处理';
}
export interface MapPoint { x: number; y: number }
export interface ContextMap {
  centerId: BodyId;
  points: { id: BodyId; at: MapPoint }[];
  paths: { id: BodyId; d: string }[];
  observer: MapPoint;
  observerOutside: boolean;
}
/** Stable oblique projection of the SAME scene coordinates used by SolarEngine.
 *  x is horizontal; z is foreshortened; elevation contributes slightly.
 *  This is a diagram, not a distance scale and not a JPL ephemeris.
 */
export function buildContextMap(frame: HudFrame, centerId: BodyId, width: number, height: number): ContextMap {
  const w = Math.max(120, width), h = Math.max(60, height);
  const center: HudVector = frame.bodies.find(b => b.id === centerId)?.position ?? [0, 0, 0];
  const ids = Object.values(BODIES)
    .filter(b => centerId === 'sun' ? b.type === 'planet' : b.type === 'moon' && b.parentId === centerId)
    .map(b => b.id);
  const relative = (p: HudVector): HudVector => [p[0] - center[0], p[1] - center[1], p[2] - center[2]];

  // Share the existing position functions; scale tracks dynamically if body is in physical observation mode (R3)
  const tracks = ids.map(id => {
    const body = BODIES[id];
    const bPos = frame.bodies.find(b => b.id === id)?.position;
    const actualDist = bPos ? Math.hypot(...relative(bPos)) : 0;

    return {
      id,
      points: Array.from({ length: 97 }, (_, i) => {
        const t = frame.simTimeHours + Math.abs(body.orbitPeriodDays) * 24 * i / 96;
        if (centerId === 'sun') {
          return getPlanetNavPosition(id, t);
        }
        const navPos = getSatelliteNavPosition(id, t);
        const navDist = Math.hypot(...navPos);
        if (actualDist > 0 && navDist > 0 && actualDist > navDist * 1.5) {
          const scale = actualDist / navDist;
          return [navPos[0] * scale, navPos[1] * scale, navPos[2] * scale] as [number, number, number];
        }
        return navPos;
      }),
    };
  });
  const bodyDists = frame.bodies.filter(b => ids.includes(b.id)).map(b => Math.hypot(...relative(b.position)));
  const extent = Math.max(1, ...tracks.flatMap(t => t.points.map(p => Math.hypot(...p))), ...bodyDists);
  // Fit width and height independently: the diagram intentionally foreshortens depth.
  // A fixed world basis is retained across frames; no idle camera-like rotation.
  const scaleX = (w - 32) / (2 * extent), scaleY = (h - 20) / (2 * extent);
  const project = (p: HudVector): MapPoint => ({ x: w / 2 + p[0] * scaleX, y: h / 2 + (p[2] * .908 - p[1] * .419) * scaleY });
  const rawObserver = project(relative(frame.observerPosition));
  const observerOutside = rawObserver.x < 10 || rawObserver.x > w - 10 || rawObserver.y < 10 || rawObserver.y > h - 10;
  return {
    centerId,
    paths: tracks.map(t => ({ id: t.id, d: t.points.map((p, i) => {
      const q = project(p);
      return `${i === 0 ? 'M' : 'L'}${q.x.toFixed(2)},${q.y.toFixed(2)}`;
    }).join(' ') })),
    points: frame.bodies.filter(b => b.id === centerId || ids.includes(b.id))
      .map(b => ({ id: b.id, at: project(relative(b.position)) })),
    observer: { x: Math.max(10, Math.min(w - 10, rawObserver.x)), y: Math.max(10, Math.min(h - 10, rawObserver.y)) },
    observerOutside,
  };
}
