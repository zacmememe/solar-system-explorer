import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { BODIES } from '../../astronomy/bodies';
import type { BodyId } from '../../contracts/body';
import type { ViewCameraMode } from '../../contracts/vehicle';
import type { HudFrame } from '../../contracts/hud';
import type { HudStore } from './store';
import { buildContextMap, clamp01, formatPeriod, hasMoons, materialNote, orbitMetric, parentSystem, SPEEDS, speedLabel } from './model';
import './hud.css';

type Panel = 'time' | 'observe' | 'details' | null;
export interface MissionHUDProps {
  store: HudStore;
  selectedBodyId: BodyId;
  isPaused: boolean;
  timeScale: number;
  viewCameraMode: ViewCameraMode;
  showOrbits: boolean;
  showClouds: boolean;
  showAtmosphere: boolean;
  showLabels: boolean;
  teachingLight: boolean;
  reduceMotion: boolean;
  venusRadarMode: boolean;
  titanInfraredMode: boolean;
  vehicleName: string;
  onPause(): void;
  onSpeed(speed: number): void;
  onViewMode(mode: ViewCameraMode): void;
  onToggleOrbits(): void;
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
      </g>)}
      <path d="M 0,-7 L 5,5 L 0,2 L -5,5 Z" transform={`translate(${map.observer.x},${map.observer.y})`}
        className="hud-observer" data-testid="hud-observer" />
    </svg>
    <div className="hud-map-caption">○ 天体　△ {map.observerOutside ? '观察机位在图外（边缘指示）' : '观察机位'}　·　示意比例</div>
  </div>;
}

function TransferGraphic({ progress, name }: { progress: number; name: string }) {
  const value = clamp01(progress);
  return <div className="hud-transfer" role="progressbar" aria-label={`切换观测目标至${name}`}
    aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)} data-testid="hud-transfer">
    <div className="hud-transfer-label"><span>当前机位</span><span>{name}</span></div>
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
  const center = solarScope || !hasMoons(system) ? 'sun' : system;
  const ready = frame !== null;
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

  const toggle = (label: string, pressed: boolean, action: () => void) =>
    <button key={label} className="hud-setting" aria-pressed={pressed} onClick={action} disabled={!ready}>
      <span>{label}</span><span>{pressed ? '开' : '关'}</span>
    </button>;
  return <div ref={root} className={`mission-hud${props.reduceMotion ? ' reduce-motion' : ''}${collapsed ? ' is-collapsed' : ''}`}
    data-testid="mission-hud" data-ready={ready}
    data-sim-hours={frame?.simTimeHours} data-is-paused={frame?.isPaused} data-time-scale={frame?.timeScale}>
    {collapsed ? <button className="hud-restore" onClick={() => setCollapsed(false)}>显示仪表</button> : <>
      <div className="hud-scrim" aria-hidden="true" />
      <div className="hud-layout">
        <section className="hud-flight" aria-label="时间与观测控制">
          <div className="hud-eyebrow">模拟时间</div>
          <div className="hud-time-line">
            <button className="hud-pause" aria-label={props.isPaused ? '继续模拟' : '暂停模拟'} onClick={props.onPause} disabled={!ready}>
              {props.isPaused ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5L19 12L8 19Z" fill="currentColor" /></svg>
                : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5V19M17 5V19" stroke="currentColor" strokeWidth="3" /></svg>}
            </button>
            <button className="hud-rate" aria-label="调整时间流速" aria-expanded={panel === 'time'} aria-controls="hud-time-panel"
              onClick={e => openPanel('time', e)} disabled={!ready}>
              <span className={props.timeScale > 1000 ? 'hud-rate-large' : ''}>{props.timeScale.toLocaleString('en-US')}</span><small>×</small>
            </button>
          </div>
          <div className="hud-flight-actions">
            <button onClick={e => openPanel('observe', e)} aria-expanded={panel === 'observe'} aria-controls="hud-observe-panel">观测选项</button>
            <button onClick={() => { closePanel(); setCollapsed(true); }}>收起仪表</button>
          </div>
        </section>

        <section className="hud-context" aria-label="空间关系">
          <div className="hud-context-heading">
            <span>{transitioning ? '切换观测目标' : center === 'sun' ? '太阳系 · 示意' : `${BODIES[center].name}系 · 示意`}</span>
            {!transitioning && hasMoons(system) && <button className="hud-scope" aria-label={solarScope ? '查看本行星系统' : '查看太阳系位置'}
              onClick={() => setSolarScope(v => !v)}>{solarScope ? '本系统' : '太阳系'} ↗</button>}
          </div>
          {!frame ? <div className="hud-no-data">等待 3D 场景数据</div>
            : transitioning ? <TransferGraphic progress={frame.camera.transitionProgress || 0} name={body.name} />
            : <ContextGraphic frame={frame} centerId={center} selectedId={body.id} />}
        </section>

        <section className="hud-target" aria-label="当前天体">
          <div className="hud-target-heading"><strong>{body.name}</strong><span>{body.nameEn}</span></div>
          <div className="hud-radius"><span>{Math.round(body.radiusKm).toLocaleString('en-US')}</span><small>km</small></div>
          <div className="hud-target-footer"><span>平均半径</span>
            <button onClick={e => openPanel('details', e)} aria-expanded={panel === 'details'} aria-controls="hud-details-panel">了解这颗天体 ↗</button>
          </div>
        </section>
      </div>

      {panel && <section className={`hud-popover hud-popover-${panel}`} ref={panelRef} role="dialog" aria-modal="false"
        aria-label={panel === 'time' ? '调整模拟时间' : panel === 'observe' ? '观测选项' : `${body.name}资料`}
        id={`hud-${panel}-panel`}>
        <div className="hud-popover-heading"><h2>{panel === 'time' ? '模拟时间' : panel === 'observe' ? '观测选项' : `${body.name} · ${body.nameEn}`}</h2>
          <button aria-label="关闭面板" onClick={() => closePanel(true)}>×</button></div>
        {panel === 'time' && <>
          <p>只改变天体运动与自转的时间流速；镜头转场速度不变。</p>
          <div className="hud-speed-grid">{SPEEDS.map(speed => <button key={speed} data-speed={speed} aria-pressed={speed === props.timeScale}
            onClick={() => props.onSpeed(speed)} disabled={!ready}>{speedLabel(speed)}</button>)}</div>
          {frame && <p>模拟已推进 {(frame.simTimeHours / 24).toFixed(2)} 天{props.isPaused ? ' · 已暂停' : ''}。初始方位为演示设定，不对应今天的真实星空。</p>}
        </>}
        {panel === 'observe' && <>
          <div className="hud-view-modes">{([
            ['PLANET_OBSERVE', '观星'], ['VEHICLE_FORMATION', '伴飞'], ['VEHICLE_ONBOARD', '随船'],
          ] as const).map(([mode, label]) => <button key={mode} disabled={!ready} aria-pressed={props.viewCameraMode === mode}
            onClick={() => props.onViewMode(mode)}>{label}</button>)}</div>
          <p>载具：{props.vehicleName || '未选择'}。伴飞模型是视觉呈现；下方三角指示观察机位，不冒充独立航天器轨道。</p>
          <div className="hud-settings-grid">
            {toggle('轨道线', props.showOrbits, props.onToggleOrbits)}
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
