import {useEffect,useRef,useState} from 'react';
import type {HudFrame} from '../../contracts/hud';
import {compassTicks,journeyArc} from './arc';
import {bearingLabel,hudPhase} from './phase';

export function useInstrumentWidth(initial=500) {
  const root=useRef<HTMLDivElement>(null),[width,setWidth]=useState(initial);
  useEffect(()=>{const el=root.current;if(!el)return;
    const observer=new ResizeObserver(([entry])=>setWidth(Math.max(180,Math.round(entry.contentRect.width))));
    observer.observe(el);return ()=>observer.disconnect();
  },[]);
  return {root,width};
}

export function TaskArc({frame,destination,source}: {frame:HudFrame;destination:string;source:string}) {
  const {root,width}=useInstrumentWidth(),phase=hudPhase(frame),pose=frame.surface;
  const ground=phase==='surface_look',transfer=phase==='transfer'||phase==='site_travel';
  const model=journeyArc(frame),path=`M24 39 Q${width/2} -9 ${width-24} 39`;
  const point=(t:number)=>({x:24+(width-48)*t,y:15+24*(2*t-1)**2});
  const cursor=point(model.cursor),yaw=pose?.yawDeg;
  const compassValid=ground&&yaw!=null&&Number.isFinite(yaw);
  return <div ref={root} className="hud-task-arc" data-testid={ground?'hud-surface-compass':transfer?'hud-transfer':'hud-altitude-profile'}
    data-yaw={ground?yaw:undefined} data-pitch={ground?pose?.pitchDeg:undefined} data-arc-kind={ground?'compass':model.kind}>
    <svg width="100%" height="46" viewBox={`0 0 ${width} 46`} role="img"
      aria-label={ground?`当地视线方位${compassValid?`${yaw.toFixed(1)}度`:'尚未取得'}`:transfer?`${source}到${destination}，当前转场段`:model.caption}>
      <path d={path} className="hud-arc-track"/>
      {ground ? <>
        {compassValid&&compassTicks(yaw,width).map(t=>{
          const y=point((t.x-24)/(width-48)).y;
          return <g key={t.bearing} transform={`translate(${t.x},${y})`}>
            <path d={`M0 0v${t.major?5:3}`} className="hud-arc-tick"/>
            {t.label&&<text y="-7" textAnchor="middle">{t.label}</text>}
          </g>;
        })}
        {compassValid&&<path d={`M${width/2-3} 22L${width/2} 17L${width/2+3} 22`} className="hud-arc-pointer"/>}
      </> : <>
        <path d={`M24 39 Q${24+(width/2-24)*model.cursor} ${39-48*model.cursor} ${cursor.x} ${cursor.y}`} className="hud-arc-complete"/>
        {model.labels.map((label,i)=>{const p=point(model.positions[i]);return <g key={i} transform={`translate(${p.x},${p.y})`}>
          <circle r={i===1?2.3:1.8} className={model.positions[i]<=model.cursor?'hud-arc-past':'hud-arc-next'}/>
          <text y="-8" textAnchor={i===0?'start':i===model.labels.length-1?'end':'middle'}>{label}</text>
        </g>})}
        <g transform={`translate(${cursor.x},${cursor.y})`} className="hud-arc-cursor"><circle r="4.5"/><circle r="1.7"/></g>
      </>}
    </svg>
    {!ground && model.progress!=null && <span className="hud-sr-only" role="progressbar" aria-label={model.caption} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(model.progress*100)}/>}
    {transfer&&<span className="hud-sr-only">{source} → {destination}</span>}
  </div>;
}

/** North-up horizontal bearing only; no invented terrain, radar range or FOV. */
export function DirectionLens({frame}: {frame:HudFrame}) {
  const pose=frame.surface;
  if(!pose||!Number.isFinite(pose.yawDeg))return null;
  const yaw=((pose.yawDeg%360)+360)%360;
  return <div className="hud-direction-lens" data-testid="hud-direction-lens" data-yaw={yaw}>
    <svg viewBox="0 0 144 124" role="img" aria-label={`北向上的当地视向示意，朝${bearingLabel(yaw)}${yaw.toFixed(1)}度`}>
      <circle cx="72" cy="61" r="41" className="hud-lens-ring"/>
      <circle cx="72" cy="61" r="23" className="hud-lens-ring is-inner"/>
      {[[72,8,'N'],[126,65,'E'],[72,121,'S'],[18,65,'W']].map(([x,y,t])=><text key={t} x={x} y={y} textAnchor="middle">{t}</text>)}
      <g transform={`translate(72 61) rotate(${yaw})`}>
        <path d="M0 0L-17 -37A41 41 0 0 1 17 -37Z" className="hud-lens-sector"/>
        <path d="M0 0V-40M-3 -35L0 -40L3 -35" className="hud-lens-bearing"/>
      </g><circle cx="72" cy="61" r="2.5" fill="currentColor"/>
    </svg>
    <div><span className="hud-eyebrow">当地视向 · 北向上</span><strong>{bearingLabel(yaw)} {Math.round(yaw)%360}°</strong>
      <span>{pose.pitchDeg>=0?'仰角':'俯角'} {Math.abs(pose.pitchDeg).toFixed(1)}°</span><small>方向示意 · 非地形图</small></div>
  </div>;
}
