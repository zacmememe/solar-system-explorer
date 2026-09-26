import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { BODIES } from '../../astronomy/bodies';
import type { BodyId } from '../../contracts/body';
import type { ViewCameraMode } from '../../contracts/vehicle';
import type { HudFrame } from '../../contracts/hud';
import type { HudStore } from './store';
import { buildContextMap, clamp01, formatPeriod, hasMoons, materialNote, orbitMetric, parentSystem, SPEEDS, speedLabel } from './model';
import './hud.css';
import type { SolarEngine } from '../../engine/SolarEngine';
import { LandingDockRow } from '../LunarLandingHUD';
import { PHASE_LABEL, hudPhase, isSurfacePhase } from './phase';
import { SurfaceReadouts, SurfaceGraphic, SurfaceActions, SurfaceLocation, SurfaceDetails } from './SurfaceJourney';

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

function ContextGraphic({ frame, centerId, selectedId }: { frame: HudFrame; centerId: BodyId; selectedId: BodyId }) {
  const root = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(400);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(120, entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const height = 88;
  const map = buildContextMap(frame, centerId, width, height);
  return <div className="hud-context-graphic" ref={root}>
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} role="img"
      aria-label={`${BODIES[centerId].name}系统相对位置示意，圆点为天体，三角为观察机位`}
      data-testid="hud-context-map" data-sequence={frame.sequence} data-center={centerId}>
      {map.paths.map(p => <path key={p.id} d={p.d} className={p.id === selectedId ? 'hud-orbit is-selected' : 'hud-orbit'} />)}
      {map.points.map(p => <g key={p.id} data-body={p.id} transform={`translate(${p.at.x},${p.at.y})`}>
        {p.id === selectedId && <circle r="9" className="hud-selection-ring" />}
        <circle r={p.id === centerId ? 4 : p.id === selectedId ? 3.8 : 2.3} className={p.id === selectedId ? 'hud-body is-selected' : 'hud-body'} />
        {(p.id===selectedId || p.id===centerId) && <text x={p.at.x>width-60?-10:10} y={p.id===centerId?16:-12} textAnchor={p.at.x>width-60?'end':'start'} className="hud-map-label">{BODIES[p.id].name}</text>}
      </g>)}
      <path d="M 0,-7 L 5,5 L 0,2 L -5,5 Z" transform={`translate(${map.observer.x},${map.observer.y})`}
        className="hud-observer" data-testid="hud-observer" />
    </svg>
    <div className="hud-map-caption">○ 天体　△ {map.observerOutside ? '观察机位在图外（边缘指示）' : '观察机位'}　·　示意比例</div>
  </div>;
}

function TransferGraphic({ progress, name, source }: { progress: number; name: string; source: string }) {
  const value = clamp01(progress);
  return <div className="hud-transfer" role="progressbar" aria-label={`切换观测目标至${name}`}
    aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)} data-testid="hud-transfer">
    <div className="hud-transfer-label"><span>{source}</span><span>{name}</span></div>
    <svg width="100%" height="48" viewBox="0 0 400 48" preserveAspectRatio="none" aria-hidden="true">
      <path d="M 8,36 Q 200,-8 392,36" pathLength="1" className="hud-transfer-track" />
      <path d="M 8,36 Q 200,-8 392,36" pathLength="1" className="hud-transfer-progress" strokeDasharray="1" strokeDashoffset={1 - value} />
    </svg>
    <div className="hud-transfer-caption"><span>镜头转场 · 非航天器轨道</span><strong>{Math.round(value * 100)}%</strong></div>
  </div>;
}

export function MissionHUD(props: MissionHUDProps) {
  const frame = useSyncExternalStore(props.store.subscribe, props.store.getSnapshot, props.store.getServerSnapshot);
  const [panel, setPanel] = useState<Panel>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [solarScope, setSolarScope] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const lastTrigger = useRef<HTMLButtonElement | null>(null);
  const body = BODIES[props.selectedBodyId] || BODIES.earth;
  const system = parentSystem(body.id);
  const phase = hudPhase(frame);
  const surfaceMode = isSurfacePhase(phase);
  const center = phase==='overview' || solarScope || !hasMoons(system) ? 'sun' : system;
  const destinationId = frame?.camera.targetBodyId;
  const destinationName = frame?.camera.destinationMode==='OVERVIEW' || !destinationId ? '太阳系全景' : BODIES[destinationId].name;
  const sourceName = frame?.camera.sourceBodyId ? BODIES[frame.camera.sourceBodyId].name : '当前机位';
  const ready = frame !== null;
  const isPaused = frame?.isPaused ?? false;
  const timeScale = frame?.timeScale ?? 50;
  const transitioning = !!frame?.camera.isTransitioning;
  const orbit = orbitMetric(body.id);
  const closePanel = (restoreFocus = false) => {
    setPanel(null);
    if (restoreFocus) lastTrigger.current?.focus();
  };
  const openPanel = (value: Panel, event: React.MouseEvent<HTMLButtonElement>) => {
    lastTrigger.current = event.currentTarget;
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
  useEffect(() => { if (!surfaceMode && panel==='mission') setPanel(null); }, [surfaceMode, panel]);

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
        <section className="hud-flight" aria-label="时间与观测控制">
          {surfaceMode && frame && <SurfaceReadouts frame={frame} />}
          <div className="hud-eyebrow hud-time-eyebrow">天体时间</div>
          <div className="hud-time-line">
            <button className="hud-pause" aria-label={isPaused ? '继续模拟' : '暂停模拟'} onClick={props.onPause} disabled={!ready}>
              {isPaused ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5L19 12L8 19Z" fill="currentColor" /></svg>
                : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5V19M17 5V19" stroke="currentColor" strokeWidth="3" /></svg>}
            </button>
            <button className="hud-rate" aria-label="调整时间流速" aria-expanded={panel === 'time'} aria-controls="hud-time-panel"
              onClick={e => openPanel('time', e)} disabled={!ready}>
              <span className={timeScale > 1000 ? 'hud-rate-large' : ''}>{timeScale.toLocaleString('en-US')}</span><small>×</small>
            </button>
          </div>
          <div className="hud-flight-actions">
            <button onClick={e => openPanel('observe', e)} aria-expanded={panel === 'observe'} aria-controls="hud-observe-panel">观测选项</button>
            <button onClick={() => { closePanel(); setCollapsed(true); }}>收起仪表</button>
          </div>
        </section>

        <section className="hud-context" aria-label={surfaceMode ? '当前旅程' : '空间关系'} data-testid={surfaceMode ? 'lunar-landing-telemetry-hud' : undefined}>
          <div className="hud-context-heading">
            <span data-testid="landing-state-tag" data-state={frame?.landing?.telemetry.state}>{surfaceMode || phase==='free' || transitioning ? PHASE_LABEL[phase] : center === 'sun' ? '太阳系 · 示意' : BODIES[center].name+'系 · 示意'}</span>
            {!surfaceMode && !transitioning && phase!=='overview' && hasMoons(system) && <button className="hud-scope" aria-label={solarScope ? '查看本行星系统' : '查看太阳系位置'}
              onClick={() => setSolarScope(v => !v)}>{solarScope ? '本系统' : '太阳系'} ↗</button>}
          </div>
          {!frame ? <div className="hud-no-data">等待 3D 场景数据</div>
            : surfaceMode ? <SurfaceGraphic frame={frame}/>
            : transitioning ? <TransferGraphic progress={frame.camera.transitionProgress || 0} name={destinationName} source={sourceName} />
            : <ContextGraphic frame={frame} centerId={center} selectedId={phase==='overview'?'sun':body.id} />}
          {surfaceMode && frame && <SurfaceActions frame={frame} engine={props.engine}/>}
          {!surfaceMode && transitioning && <div className="hud-mission-actions"><button onClick={props.onCancelTransition} data-testid="hud-cancel-transfer">停止在当前机位</button></div>}
        </section>

        <section className="hud-target" aria-label={surfaceMode ? '当前观察地点' : '当前天体'}>
          {surfaceMode && frame ? <>
            <SurfaceLocation frame={frame}/>
            <button className="hud-explain" data-testid="hud-site-details" onClick={e=>openPanel('mission',e)} aria-expanded={panel==='mission'} aria-controls="hud-mission-panel">地点与数据 ↗</button>
          </> : <>
            <div className="hud-target-heading"><strong>{phase==='overview'?'太阳系':phase==='free'?'自由机位':transitioning?destinationName:body.name}</strong><span>{phase==='observe'?body.nameEn:''}</span></div>
            {phase==='observe' ? <div className="hud-radius"><span>{Math.round(body.radiusKm).toLocaleString('en-US')}</span><small>km</small></div>
              : <p className="hud-target-note">{phase==='overview'?'选择天体开始探索':phase==='free'?'拖动环顾，或选择新的目标':'镜头导览 · 可随时停止'}</p>}
            <LandingDockRow engine={props.engine} landing={frame?.landing}/>
            <div className="hud-target-footer">{phase==='observe' && <span>平均半径</span>}
              <button onClick={e=>openPanel('details',e)} aria-expanded={panel==='details'} aria-controls="hud-details-panel">{body.name}资料 ↗</button>
            </div>
          </>}
        </section>
      </div>

      {panel && <section className={`hud-popover hud-popover-${panel}`} ref={panelRef} role="dialog" aria-modal="false"
        aria-label={panel === 'time' ? '调整模拟时间' : panel === 'observe' ? '观测选项' : panel === 'mission' ? '地点与数据' : `${body.name}资料`}
        id={`hud-${panel}-panel`}>
        <div className="hud-popover-heading"><h2>{panel === 'time' ? '天体时间' : panel === 'observe' ? '观测选项' : panel === 'mission' ? '地点与数据' : `${body.name} · ${body.nameEn}`}</h2>
          <button aria-label="关闭面板" onClick={() => closePanel(true)}>×</button></div>
        {panel === 'time' && <>
          <p>只改变天体运动与自转；镜头转场、下降和升空独立推进。想停住下降，请使用“悬停环顾”。</p>
          <div className="hud-speed-grid">{SPEEDS.map(speed => <button key={speed} data-speed={speed} aria-pressed={speed === timeScale}
            onClick={() => props.onSpeed(speed)} disabled={!ready}>{speedLabel(speed)}</button>)}</div>
          {frame && <p>模拟已推进 {(frame.simTimeHours / 24).toFixed(2)} 天{isPaused ? ' · 已暂停' : ''}。初始方位为演示设定，不对应今天的真实星空。</p>}
        </>}
        {panel === 'observe' && <>
          <div className="hud-view-modes">{([
            ['PLANET_OBSERVE', '观星'], ['VEHICLE_FORMATION', '伴飞'], ['VEHICLE_ONBOARD', '随船'],
          ] as const).map(([mode, label]) => <button key={mode} disabled={!ready || (mode !== 'PLANET_OBSERVE' && !props.vehicleName)} aria-pressed={props.viewCameraMode === mode}
            onClick={() => props.onViewMode(mode)}>{label}</button>)}</div>
          <p>载具：{props.vehicleName || '未选择'}。伴飞模型是视觉呈现；下方三角指示观察机位，不冒充独立航天器轨道。</p>
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
        </>}
        {panel === 'mission' && frame && <SurfaceDetails frame={frame}/>}
        {panel === 'details' && <>
          <p className="hud-body-tip">{body.observationTip}</p>
          <p>{body.description}</p>
          <dl><div><dt>{orbit.label}</dt><dd>{orbit.value}</dd></div>
            <div><dt>公转周期{body.orbitPeriodDays < 0 ? '（逆行）' : ''}</dt><dd>{formatPeriod(body.orbitPeriodDays)}</dd></div>
            <div><dt>自转周期</dt><dd>{Math.abs(body.rotationPeriodHours).toFixed(1)} 小时</dd></div></dl>
          <p className="hud-source-note">{materialNote(body.id, props.titanInfraredMode)}<br />原项目标注来源：{body.sourceRef}</p>
          <button className="hud-action" disabled={!ready} onClick={transitioning ? props.onCancelTransition : props.onReframe}>
            {transitioning ? '取消镜头转场' : '重新取景'}</button>
        </>}
      </section>}
    </>}
  </div>;
}
