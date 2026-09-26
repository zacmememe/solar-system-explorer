import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { BODIES } from '../../astronomy/bodies';
import type { BodyId } from '../../contracts/body';
import type { ViewCameraMode } from '../../contracts/vehicle';
import type { HudFrame } from '../../contracts/hud';
import type { HudStore } from './store';
import { buildContextMap, formatPeriod, hasMoons, materialNote, orbitMetric, parentSystem, SPEEDS, speedLabel } from './model';
import './hud.css';
import type { SolarEngine } from '../../engine/SolarEngine';
import { LandingDockRow } from '../LunarLandingHUD';
import { PHASE_LABEL, hudPhase, isSurfacePhase } from './phase';
import { SurfaceReadouts, SurfaceGraphic, SurfaceActions, SurfaceLocation, SurfaceDetails } from './SurfaceJourney';
import {DirectionLens,TaskArc} from './TaskArc';
import {primaryReading} from './primaryReading';

type Panel = 'time' | 'observe' | 'details' | 'mission' | null;
export interface MissionHUDProps {
  store: HudStore;
  selectedBodyId: BodyId;
  viewCameraMode: ViewCameraMode;
  showClouds: boolean;
  showAtmosphere: boolean;
  showLabels: boolean;
  teachingLight: boolean;
  reduceMotion: boolean;
  venusRadarMode: boolean;
  titanInfraredMode: boolean;
  vehicleName: string;
  /** All display state is published by the engine; this reference only invokes explicit user actions. */
  engine: SolarEngine | null;
  onPause(): void;
  onSpeed(speed: number): void;
  onViewMode(mode: ViewCameraMode): void;
  onToggleClouds(): void;
  onToggleAtmosphere(): void;
  onToggleLabels(): void;
  onToggleLight(): void;
  onToggleReduceMotion(): void;
  onToggleVenus(): void;
  onToggleTitan(): void;
  onReframe(): void;
  onCancelTransition(): void;
}

function ContextGraphic({ frame, centerId, selectedId, compact=false }: { frame: HudFrame; centerId: BodyId; selectedId: BodyId; compact?:boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(400);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(120, entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const height = compact?64:150;
  const previewIds=compact&&centerId!=='sun' ? (selectedId!==centerId?[selectedId]:Object.values(BODIES).filter(b=>b.parentId===centerId).sort((a,b)=>b.radiusKm-a.radiusKm).slice(0,2).map(b=>b.id)) : undefined;
  const map = buildContextMap(frame, centerId, width, height,previewIds);
  return <div className={`hud-context-graphic${compact?' is-compact':' is-lens'}`} ref={root}>
    <svg width="100%" height={compact?46:height} viewBox={`0 0 ${width} ${height}`} role="img"
      aria-label={`${BODIES[centerId].name}系统相对位置示意，圆点为天体，三角为观察机位`}
      data-testid={compact?'hud-context-preview':'hud-context-map'} data-sequence={frame.sequence} data-center={centerId}>
      {map.paths.map(p => <path key={p.id} d={p.d} className={p.id === selectedId ? 'hud-orbit is-selected' : 'hud-orbit'} />)}
      {map.points.map(p => <g key={p.id} data-body={p.id} transform={`translate(${p.at.x},${p.at.y})`}>
        {p.id === selectedId && <circle r="9" className="hud-selection-ring" />}
        <circle r={p.id === centerId ? 4 : p.id === selectedId ? 3.8 : 2.3} className={p.id === selectedId ? 'hud-body is-selected' : 'hud-body'} />
        {!compact && (p.id===selectedId || p.id===centerId) && <text x={p.at.x>width-60?-10:10} y={p.id===centerId?16:-12} textAnchor={p.at.x>width-60?'end':'start'} className="hud-map-label">{BODIES[p.id].name}</text>}
      </g>)}
      <path d="M 0,-7 L 5,5 L 0,2 L -5,5 Z" transform={`translate(${map.observer.x},${map.observer.y})`}
        className="hud-observer" data-testid="hud-observer" />
    </svg>
    {!compact&&<div className="hud-map-caption">○ 天体　△ {map.observerOutside ? '观察机位在图外（边缘指示）' : '观察机位'}　·　示意比例</div>}
    {compact&&<span className="hud-preview-caption">{map.observerOutside?'△ 机位在图外 · 示意':'相对位置 · 示意'}</span>}
  </div>;
}

export function MissionHUD(props: MissionHUDProps) {
  const frame = useSyncExternalStore(props.store.subscribe, props.store.getSnapshot, props.store.getServerSnapshot);
  const [panel, setPanel] = useState<Panel>(null);
  const [collapsed, setCollapsed] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const lastTrigger = useRef<HTMLButtonElement | null>(null);
  const body = BODIES[props.selectedBodyId] || BODIES.earth;
  const system = parentSystem(body.id);
  const phase = hudPhase(frame);
  const surfaceMode = isSurfacePhase(phase);
  const previewCenter=phase==='overview'||!hasMoons(system)?'sun':system;
  const destinationId = frame?.camera.targetBodyId;
  const destinationName = phase==='site_travel' ? frame?.landing?.siteTravel?.name.split(' · ')[0]??'落区上空' : frame?.camera.destinationMode==='OVERVIEW' || !destinationId ? '太阳系全景' : BODIES[destinationId].name;
  const sourceName = frame?.camera.sourceBodyId ? BODIES[frame.camera.sourceBodyId].name : '当前机位';
  const ready = frame !== null;
  const isPaused = frame?.isPaused ?? false;
  const timeScale = frame?.timeScale ?? 50;
  const slowerSpeed = [...SPEEDS].reverse().find(speed => speed < timeScale);
  const fasterSpeed = SPEEDS.find(speed => speed > timeScale);
  const transitioning = !!frame?.camera.isTransitioning;
  const orbit = orbitMetric(body.id);
  const siteName=frame?.landing?.telemetry.state!=='ORBIT' ? frame?.landing?.telemetry.site.name.split(' · ')[0] : undefined;
  const heading=surfaceMode ? siteName??'地表观察点' : phase==='overview'?'太阳系':phase==='free'?'自由机位':transitioning?destinationName:body.name;
  const primary=primaryReading(frame,body.id);
  const closePanel = (restoreFocus = false) => {
    setPanel(null);
    if (restoreFocus) lastTrigger.current?.focus();
  };
  const openPanel = (value: Panel, event: React.MouseEvent<HTMLButtonElement>) => {
    if(!panelRef.current?.contains(event.currentTarget))lastTrigger.current = event.currentTarget;
    setPanel(current => current === value ? null : value);
  };
  useEffect(() => {
    if (!panel) return;
    panelRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const keydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setPanel(null); lastTrigger.current?.focus(); }
    };
    const outside = (e: PointerEvent) => {
      if (e.target instanceof Node && !root.current?.contains(e.target)) setPanel(null);
    };
    document.addEventListener('keydown', keydown);
    document.addEventListener('pointerdown', outside);
    return () => { document.removeEventListener('keydown', keydown); document.removeEventListener('pointerdown', outside); };
  }, [panel]);
  useEffect(() => {
    if (!surfaceMode && panel==='mission') {
      const restore=!!panelRef.current?.contains(document.activeElement);
      setPanel(null);
      if(restore)requestAnimationFrame(()=>root.current?.querySelector<HTMLButtonElement>('.hud-explain')?.focus());
    }
  }, [surfaceMode, transitioning, panel]);
  const collapseChanged=useRef(collapsed);
  useEffect(()=>{
    if(collapseChanged.current===collapsed)return;
    collapseChanged.current=collapsed;
    root.current?.querySelector<HTMLButtonElement>(collapsed?'.hud-restore':'.hud-options')?.focus();
  },[collapsed]);

  useEffect(() => {
    const el=root.current;
    if(!el)return;
    const navigation=[...document.querySelectorAll<HTMLElement>('.app-top-container, .app-satellite-bar')];
    const measure=()=>{
      el.style.setProperty('--hud-height',el.offsetHeight+'px');
      const navBottom=Math.max(0,...navigation.map(n=>n.getBoundingClientRect().bottom));
      el.style.setProperty('--hud-top-clearance',`${navBottom+12}px`);
    };
    const observer=new ResizeObserver(measure);
    observer.observe(el);navigation.forEach(n=>observer.observe(n));measure();
    window.addEventListener('resize',measure);
    return ()=>{observer.disconnect();window.removeEventListener('resize',measure);};
  }, [body.id]);

  const toggle = (label: string, pressed: boolean, action: () => void) =>
    <button key={label} className="hud-setting" aria-pressed={pressed} onClick={action} disabled={!ready}>
      <span>{label}</span><span>{pressed ? '开' : '关'}</span>
    </button>;
  return <div ref={root} className={`mission-hud${props.reduceMotion ? ' reduce-motion' : ''}${collapsed ? ' is-collapsed' : ''}${surfaceMode ? ' has-mission' : ''}`}
    data-testid="mission-hud" data-ready={ready} data-phase={phase}
    data-sim-hours={frame?.simTimeHours} data-is-paused={frame?.isPaused} data-time-scale={frame?.timeScale}>
    {collapsed ? <button className="hud-restore" onClick={() => setCollapsed(false)}>显示仪表</button> : <>
      <div className="hud-scrim" aria-hidden="true" />
      <div className="hud-layout">
        <section className="hud-time" aria-label="天体时间">
          <span className="hud-time-caption">{isPaused?'时间暂停':'模拟时间'}</span>
          <div className="hud-time-controls">
            <button className="hud-pause" aria-label={isPaused?'继续模拟':'暂停模拟'} title={isPaused?'继续天体时间':'暂停天体时间'} onClick={props.onPause} disabled={!ready}>{isPaused?'▷':'Ⅱ'}</button>
            <div className="hud-speed-control" role="group" aria-label="天体时间倍率" data-testid="hud-speed-control" title="天体时间倍率；不改变下降导览速度">
              <button className="hud-speed-step" data-testid="hud-speed-down" aria-label="降低时间倍率" disabled={!ready || slowerSpeed === undefined} onClick={() => slowerSpeed !== undefined && props.onSpeed(slowerSpeed)}>‹</button>
              <div className={`hud-speed-reading${timeScale>=1000?' is-large-rate':''}`} data-testid="hud-speed-value" data-speed={timeScale}>
                <span className="hud-speed-number">{timeScale.toLocaleString('en-US', { maximumFractionDigits: 1 })}<small>×</small></span>
              </div>
              <button className="hud-speed-step" data-testid="hud-speed-up" aria-label="提高时间倍率" disabled={!ready || fasterSpeed === undefined} onClick={() => fasterSpeed !== undefined && props.onSpeed(fasterSpeed)}>›</button>
            </div>
          </div>
          <div className="hud-time-options">
            <button className="hud-options" aria-label="观测选项" title="观测选项与时间" aria-controls="hud-observe-panel" aria-expanded={panel==='observe'} onClick={e=>openPanel('observe',e)}>观测选项</button>
            <button onClick={()=>{closePanel();setCollapsed(true);}}>收起仪表</button>
          </div>
        </section>
        <section className="hud-context" aria-label={surfaceMode?'当前旅程':'空间关系'} data-testid={surfaceMode?'lunar-landing-telemetry-hud':undefined}>
          {!frame ? <span className="hud-compact-note">正在连接观察机位</span>
            : surfaceMode||transitioning||phase==='site_travel' ? <TaskArc frame={frame} destination={destinationName} source={sourceName}/>
            : <div className="hud-space-instrument"><ContextGraphic compact frame={frame} centerId={previewCenter} selectedId={phase==='overview'?'sun':body.id}/>
              <span className="hud-system-caption">{previewCenter==='sun'?'太阳系':BODIES[previewCenter].name+'系'} · 示意</span></div>}
          <div className="hud-flight" aria-label="当前阶段操作">
            {!surfaceMode&&!transitioning&&frame&&<LandingDockRow engine={props.engine} landing={frame.landing}/>}
            {surfaceMode && frame && <SurfaceActions frame={frame} engine={props.engine}/>}
            {!surfaceMode && transitioning && <div className="hud-mission-actions"><button onClick={props.onCancelTransition} data-testid="hud-cancel-transfer">停止转场</button></div>}
          </div>
        </section>
        <section className="hud-target" aria-label="当前对象与读数">
          <div className="hud-target-heading">
            <strong className="hud-object-name" title={heading}>{heading}</strong>
            <span className="hud-stage" data-testid="landing-state-tag" data-state={frame?.landing?.telemetry.state}>{PHASE_LABEL[phase]}</span>
          </div>
          <div className={`hud-primary-reading${primary.text?' is-text':''}`} data-testid="hud-primary-reading">
            <strong data-testid={primary.label==='离地高度'?'telemetry-agl-value':undefined}>{primary.value}{primary.unit&&<> <small>{primary.unit}</small></>}</strong>
          </div>
          <div className="hud-target-footer">
            <span className="hud-reading-label">{primary.label}</span>
            <button className="hud-explain" data-testid={surfaceMode?'hud-site-details':'hud-body-details'} onClick={e=>openPanel(surfaceMode?'mission':'details',e)} aria-expanded={panel===(surfaceMode?'mission':'details')} aria-controls={surfaceMode?'hud-mission-panel':'hud-details-panel'}>{surfaceMode?'旅程详情':phase==='overview'?'全景说明':'了解这颗天体'} ↗</button>
          </div>
        </section>
      </div>
      {panel && <section className={`hud-popover hud-popover-${panel}`} ref={panelRef} role="dialog" aria-modal="false"
        aria-label={panel === 'time' ? '调整模拟时间' : panel === 'observe' ? '观测选项' : panel === 'mission' ? '旅程详情' : phase==='overview'?'太阳系全景说明':`${body.name}资料`}
        id={`hud-${panel}-panel`}>
        <div className="hud-popover-heading"><h2>{panel === 'time' ? '天体时间' : panel === 'observe' ? '观测选项' : panel === 'mission' ? '旅程详情' : phase==='overview'?'太阳系全景':`${body.name} · ${body.nameEn}`}</h2>
          <button aria-label="关闭面板" onClick={() => closePanel(true)}>×</button></div>
        {panel === 'time' && <>
          <p>只改变天体运动与自转；镜头转场、下降和升空独立推进。想停住下降，请使用“悬停环顾”。</p>
          <p>倍率表示同一条模拟时钟的速度，切换星球不会叠加。不同天体的自转、公转周期不同，因此画面中的运动快慢会不同。</p>
          <div className="hud-speed-grid">{SPEEDS.map(speed => <button key={speed} data-speed={speed} aria-pressed={speed === timeScale}
            onClick={() => props.onSpeed(speed)} disabled={!ready}>{speedLabel(speed)}</button>)}</div>
          {frame && <p>模拟已推进 {(frame.simTimeHours / 24).toFixed(2)} 天{isPaused ? ' · 已暂停' : ''}。初始方位为演示设定，不对应今天的真实星空。</p>}
          {!!frame?.landing?.sites.length && <>
            <button className="hud-action" data-testid="landing-daylight" onClick={()=>props.engine?.chooseLandingDaylight()}>切换到所选落区的白昼</button>
            <p>此操作会改变模拟时刻。降落与换落区本身保持当前昼夜。</p>
          </>}
        </>}
        {panel === 'observe' && <>
          <div className="hud-menu-time"><span>天体时间{isPaused?' · 已暂停':''}</span>
            <button aria-label={isPaused?'继续天体时间':'暂停天体时间'} onClick={props.onPause}>{isPaused?'继续':'暂停'}</button>
            <button className="hud-rate" aria-label="调整时间流速" aria-controls="hud-time-panel" onClick={e=>openPanel('time',e)}><span>{timeScale.toLocaleString('en-US')}</span><small>×</small></button>
          </div>
          {frame?.vehicle?.allowed && <><div className="hud-view-modes">{([
            ['PLANET_OBSERVE', '观星'], ['VEHICLE_FORMATION', '伴飞'], ['VEHICLE_ONBOARD', '随船'],
          ] as const).map(([mode, label]) => <button key={mode} disabled={!ready || (mode !== 'PLANET_OBSERVE' && !props.vehicleName)} aria-pressed={props.viewCameraMode === mode}
            onClick={() => props.onViewMode(mode)}>{label}</button>)}</div>
          <p>载具：{props.vehicleName || '未选择'}。伴飞模型是视觉呈现；空间关系图中的三角指示观察机位，不冒充独立航天器轨道。</p></>}
          <div className="hud-settings-grid">
            {toggle('天体标识', props.showLabels, props.onToggleLabels)}
            {toggle('地球云层', props.showClouds, props.onToggleClouds)}
            {toggle('大气微光', props.showAtmosphere, props.onToggleAtmosphere)}
            {toggle('暗部补光', props.teachingLight, props.onToggleLight)}
            {toggle('减弱动态', props.reduceMotion, props.onToggleReduceMotion)}
            {body.id === 'venus' && toggle('雷达地表', props.venusRadarMode, props.onToggleVenus)}
            {body.id === 'titan' && toggle('近红外示意', props.titanInfraredMode, props.onToggleTitan)}
          </div>
          <button className="hud-action" disabled={!ready} onClick={transitioning ? props.onCancelTransition : props.onReframe}>
            {transitioning ? '取消镜头转场' : '重新取景'}</button>
          <button className="hud-action" data-testid="hud-collapse" onClick={()=>{closePanel();setCollapsed(true);}}>收起仪表</button>
        </>}
        {panel === 'mission' && frame && <>
          <SurfaceLocation frame={frame}/><SurfaceReadouts frame={frame}/>
          {phase==='surface_look'?<DirectionLens frame={frame}/>:<SurfaceGraphic frame={frame}/>}
          <SurfaceActions frame={frame} engine={props.engine} secondary/>
          <SurfaceDetails frame={frame}/>
        </>}
        {panel === 'details' && <>
          {phase==='overview'?<p>全景使用便于导航的示意比例。切换到具体天体后，可查看它的半径、周期和观测资料。</p>:<><p className="hud-body-tip">{body.observationTip}</p>
          <p>{body.description}</p>
          <dl><div><dt>平均半径</dt><dd className="hud-radius">{Math.round(body.radiusKm).toLocaleString('en-US')} km</dd></div><div><dt>{orbit.label}</dt><dd>{orbit.value}</dd></div>
            <div><dt>公转周期{body.orbitPeriodDays < 0 ? '（逆行）' : ''}</dt><dd>{formatPeriod(body.orbitPeriodDays)}</dd></div>
            <div><dt>自转周期</dt><dd>{Math.abs(body.rotationPeriodHours).toFixed(1)} 小时</dd></div></dl>
          <p className="hud-source-note">{materialNote(body.id, props.titanInfraredMode)}<br />原项目标注来源：{body.sourceRef}</p></>}
          <button className="hud-action" disabled={!ready} onClick={transitioning ? props.onCancelTransition : props.onReframe}>
            {transitioning ? '取消镜头转场' : '重新取景'}</button>
        </>}
      </section>}
    </>}
  </div>;
}
