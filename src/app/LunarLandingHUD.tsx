import type { SolarEngine } from '../engine/SolarEngine';
import type { HudLandingFrame } from '../contracts/hud';

/** Landing entry consumes the same published frame as the journey instruments. */
export function LandingDockRow({engine,landing}: {engine: SolarEngine | null;landing: HudLandingFrame | undefined}) {
  if (!engine || !landing) return null;
  const {telemetry,availability,sites}=landing;
  if (telemetry.state!=='ORBIT' && availability.action!=='exit-observe') return null;
  if (!sites.length && availability.action==='none') return null;
  return <div className="hud-landing-row" data-testid="hud-landing-row">
    {telemetry.state==='ORBIT' && sites.length>0 && availability.siteId && <>
      <label className="hud-landing-label" htmlFor="landing-site">着陆点</label>
      <select id="landing-site" data-testid="landing-site-select" aria-label="选择着陆地点" value={availability.siteId}
        onChange={event=>engine.selectLandingSite(event.target.value)}>
        {sites.map(site=><option key={site.id} value={site.id}>{site.name}</option>)}
      </select>
    </>}
    {availability.action==='land' && <button data-testid="lunar-landing-start-btn" className="hud-landing-action is-primary" onClick={()=>engine.startLunarLanding()}>降落 ↘</button>}
    {availability.action==='travel-to-site' && <button data-testid="lunar-landing-travel-site-btn" className="hud-landing-action" onClick={()=>engine.travelToLandingSite()} title="先绕行前往着陆区上空">前往落区 ↗</button>}
    {availability.action==='wait' && <span data-testid="lunar-landing-wait" className="hud-landing-wait" title={availability.detail}>{availability.detail ?? '准备中…'}</span>}
    {availability.action==='exit-observe' && <button data-testid="mars-observe-exit-btn" className="hud-landing-action" onClick={()=>engine.exitJezeroSurfaceObserve()}>返回高空 ↗</button>}
  </div>;
}
