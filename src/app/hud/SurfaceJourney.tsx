import { useRef } from 'react';
import type { HudFrame } from '../../contracts/hud';
import type { SolarEngine } from '../../engine/SolarEngine';
import { BODIES } from '../../astronomy/bodies';
import { altitudeAxis, altitudeStage, bearingLabel, formatAltitude, formatCoordinates, hudPhase, observedAltitude } from './phase';

export function SurfaceReadouts({frame}: {frame: HudFrame}) {
  const phase=hudPhase(frame), height=observedAltitude(frame);
  const telemetry=frame.landing?.telemetry;
  const rate=telemetry?.verticalSpeedMps;
  return <>
    <div className="hud-eyebrow">{phase==='preparing'?'任务准备':phase==='surface_look'?'观察眼高':'离地高度'}</div>
    <div className="hud-hero-reading" data-testid="telemetry-agl-value">{formatAltitude(height)}</div>
    {phase==='preparing' ? <div className="hud-secondary-reading">就绪后从当前机位出发</div>
      : <div className="hud-secondary-reading">
        <span>{phase==='surface_look'?'原地环顾':'导引升降率'}</span>
        {phase!=='surface_look' && <strong data-testid="telemetry-vspeed-value" title="下降/升空曲线的高度变化率，不是航天器惯性速度">
          {rate==null?'—':`${rate>0?'+':''}${rate.toLocaleString('en-US',{maximumFractionDigits:1})} m/s`}
        </strong>}
      </div>}
  </>;
}

function Compass({frame}: {frame: HudFrame}) {
  const pose=frame.surface;
  if(!pose)return <div className="hud-no-data">等待观察方向</div>;
  const yaw=(pose.yawDeg%360+360)%360, base=Math.floor(yaw/15)*15;
  const labels:Record<number,string>={0:'北',90:'东',180:'南',270:'西'};
  return <div className="hud-compass" data-testid="hud-surface-compass" data-yaw={yaw} data-pitch={pose.pitchDeg}>
    <div className="hud-direction-reading"><span>面向 <strong>{bearingLabel(yaw)} {Math.round(yaw)%360}°</strong></span>
      <span>{pose.pitchDeg>=0?'仰角':'俯角'} <strong>{Math.abs(pose.pitchDeg).toFixed(1)}°</strong></span></div>
    <svg viewBox="0 0 500 54" role="img" aria-label={`实际视线朝向${bearingLabel(yaw)}${yaw.toFixed(1)}度，仰角${pose.pitchDeg.toFixed(1)}度`}>
      <path d="M 12 39 H 488" className="hud-instrument-line" />
      {Array.from({length:15},(_,i)=>base+(i-7)*15).map(angle=>{
        const x=250+(angle-yaw)*2.7, bearing=(angle%360+360)%360;
        return x>10 && x<490 && <g key={angle} transform={`translate(${x},0)`}>
          <path d={`M 0 ${labels[bearing]?21:30} V 39`} className="hud-instrument-line" />
          {angle%30===0 && <text y="15" textAnchor="middle">{labels[bearing]??bearing}</text>}
        </g>;
      })}
      <path d="M 245 46 L 250 40 L 255 46" className="hud-instrument-active" />
    </svg>
    <div className="hud-instrument-caption">拖动环顾 · 上下拖动仰望天空</div>
  </div>;
}

export function SurfaceGraphic({frame}: {frame: HudFrame}) {
  const phase=hudPhase(frame), height=observedAltitude(frame), prep=frame.landing?.preparation;
  const axisCeiling=useRef<number|null>(null);
  if(height!=null && axisCeiling.current===null)axisCeiling.current=Math.max(1000000,height);
  const ceiling=axisCeiling.current??1000000;
  const ticks=[ceiling,...[10000000,1000000,100000,10000,1000,100,10,1].filter(h=>h<ceiling/3)];
  if(phase==='surface_look')return <Compass frame={frame}/>;
  if(phase==='preparing')return <div className="hud-preparation" role="status">
    <span className="hud-preparation-dot" />
    <div><strong>{prep?.phase==='lighting'?'选择落区白昼':prep?.phase==='capture'?'确认当前机位':prep?.phase==='policy'?'准备当地观察':'准备地形数据'}</strong>
      <p>{prep?.lightingAdjustedSimHours!=null ? <span data-testid="landing-prep-lighting-notice">已调整模拟时刻至站点白昼 · T+{Math.round(prep.lightingAdjustedSimHours)} h</span> : '准备就绪后开始下降，可随时取消。'}</p>
    </div>
  </div>;
  const progress=frame.landing?.telemetry.progress ?? 0;
  return <div className="hud-altitude-profile" data-testid="hud-altitude-profile" data-altitude={height??''}>
    <div className="hud-profile-summary"><span>{phase==='hold'?'位置保持 · 可自由环顾':phase==='ascending'?'返回观星机位':altitudeStage(height)}</span>
      <span>本段导览 {Math.round(progress*100)}%</span></div>
    <svg viewBox="0 0 500 62" role="img" aria-label={`离地高度${formatAltitude(height)}，对数高度刻度，非地理轨迹`}>
      <path d="M 18 35 H 482" className="hud-instrument-line" />
      {ticks.map((h,i)=><g key={h} transform={`translate(${18+altitudeAxis(h,ceiling)*464},0)`}>
        <path d="M 0 31 V 40" className="hud-instrument-line" />
        <text y="57" textAnchor={i===0?'start':i===ticks.length-1?'end':'middle'}>{i===0?'高空':h>=1000?`${h/1000} km`:`${h} m`}</text>
      </g>)}
      {height!=null && <g transform={`translate(${18+altitudeAxis(height,ceiling)*464},0)`}>
        <path d="M -5 22 L 0 29 L 5 22 Z" fill="currentColor" />
        <path d="M 0 29 V 41" className="hud-instrument-active" />
      </g>}
    </svg>
    <div className="hud-instrument-caption">高度按数量级分段 · {phase==='hold'?'悬停不暂停天体时间':'导览移动与天体时间独立'}</div>
  </div>;
}

export function SurfaceActions({frame,engine}: {frame: HudFrame;engine: SolarEngine | null}) {
  if(!engine)return null;
  const state=frame.landing?.telemetry.state;
  return <div className="hud-mission-actions" aria-label="当前阶段操作">
    {state==='PREPARING' && <button data-testid="landing-btn-cancel-prep" onClick={()=>engine.getLandingController().cancelPreparation()}>取消准备</button>}
    {state==='DESCENDING' && <>
      <button className="is-primary" data-testid="landing-btn-hold" onClick={()=>engine.pauseLanding()}>Ⅱ 悬停环顾</button>
      <button data-testid="landing-btn-cancel" onClick={()=>engine.returnToLunarOrbit()}>取消下降 · 返回</button>
    </>}
    {state==='HOLD' && <>
      <button className="is-primary" data-testid="landing-btn-resume" onClick={()=>engine.resumeLanding()}>▷ 继续下降</button>
      <button data-testid="landing-btn-reguide" onClick={()=>engine.requestLandingReguide()}>恢复导引视线</button>
      <button data-testid="landing-btn-return-hold" onClick={()=>engine.returnToLunarOrbit()}>返回高空 ↗</button>
    </>}
    {hudPhase(frame)==='surface_look' && <>
      {frame.surface?.bodyId==='moon' && <button className="is-primary" data-testid="landing-btn-look-earth" onClick={()=>engine.lookAtEarthFromMoon()}>仰望地球 ↗</button>}
      <button data-testid="landing-btn-reset-look" onClick={()=>engine.resetMoonSurfaceLook()}>重设地平线</button>
      <button data-testid="landing-btn-return-orbit" onClick={()=>state==='SURFACE_LOOK'?engine.returnToLunarOrbit():frame.surface && engine.executeCameraCommand({type:'flyTo',bodyId:frame.surface.bodyId})}>返回高空 ↗</button>
    </>}
    {state==='ASCENDING' && <span className="hud-return-hint">可拖动调整视线，也可从顶部切换目标</span>}
  </div>;
}

export function SurfaceLocation({frame}: {frame: HudFrame}) {
  const telemetry=frame.landing?.telemetry, pose=frame.surface;
  const site=telemetry?.state!=='ORBIT'?telemetry?.site:undefined;
  const phase=hudPhase(frame), enroute=phase==='preparing'||phase==='descending'||phase==='hold';
  return <>
    <div className="hud-eyebrow">{BODIES[pose?.bodyId??site?.bodyId??'moon'].name} · {enroute?'目标落区':phase==='ascending'?'离开落区':'当地观察'}</div>
    <div className="hud-site-name">{site?.name.split(' · ')[0] ?? '地表观察点'}</div>
    <div className="hud-local-coordinates" data-testid="telemetry-coord-value">{pose?<>{enroute||phase==='ascending'?'当前位置 ':''}{formatCoordinates(pose.lat,pose.lon)}</>:'准备完成后显示位置'}</div>
  </>;
}

export function SurfaceDetails({frame}: {frame: HudFrame}) {
  const t=frame.landing?.telemetry, pose=frame.surface;
  if(!t)return null;
  if(t.state==='ORBIT')return <>
    <p className="hud-body-tip">{pose ? BODIES[pose.bodyId].name+' · 地表观察点' : '地表观察点'}</p>
    <p>{pose ? formatCoordinates(pose.lat,pose.lon) : '等待位置'} · 眼高 {formatAltitude(observedAltitude(frame))}</p>
    <p>拖动环顾，上下拖动仰望天空。这是独立观察机位，未关联正在执行的着陆任务。</p>
  </>;
  return <>
    <p className="hud-body-tip">{t.site.description}</p>
    <dl>
      <div><dt>当前离地高度</dt><dd>{formatAltitude(observedAltitude(frame))}</dd></div>
      <div><dt>相对基准面高度</dt><dd>{formatAltitude(pose?.datumHeightM??null)}</dd></div>
      <div><dt>视线方位 / 仰角</dt><dd data-testid="telemetry-orientation-value">{pose?`${pose.yawDeg.toFixed(1)}° / ${pose.pitchDeg.toFixed(1)}°`:'—'}</dd></div>
    </dl>
    <p>本旅程是虚拟观察导览。下降和升空的速率来自导引曲线，未模拟航天器动力学；模拟时间只控制天体运动。</p>
    <p className="hud-source-note">{t.site.provenance}</p>
    <p>当前地面高程：{t.state==='PREPARING'?'准备中':t.terrain.fidelity==='measured-dem'?'站区实测地形':t.terrain.fidelity==='datum-sphere'?'基准球面（站区数据范围之外）':'尚未取得'}。
      {t.terrain.sourceId && <> 数据标识：{t.terrain.sourceId}。</>}</p>
    {frame.landing?.preparation.lightingAdjustedSimHours!=null && <p>本次降落准备曾选择站点白昼 · 模拟 T+{Math.round(frame.landing.preparation.lightingAdjustedSimHours)} h。</p>}
  </>;
}
