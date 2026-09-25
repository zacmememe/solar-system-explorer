/**
 * 月球落地与地表停驻遥测仪表 HUD (LunarLandingHUD.tsx)
 * 遵循批次 R5 规范：
 * 1. 呈现状态机完整语义：ORBIT -> DESCENDING -> HOLD -> SURFACE_LOOK -> ASCENDING；
 * 2. 实时显示 AGL 离地真高、MSL 基准高程、垂直速度与表面坐标；
 * 3. 支持随时暂停 (HOLD)、继续 (RESUME)、仰望地球与返回轨道；
 * 4. 具备清晰的科学标注（陶拉斯—利特罗山谷 · 虚拟降落，NASA LROC DTM 5m 剖面标定）。
 * F-LANDING-HUD-01：ORBIT 态着陆选择+前往/降落/等待合并为单行
 * LandingDockRow，经 App 传入底部 MissionHUD 当前天体区；中央不再有悬浮面板。
 */

import React, { useEffect, useState } from 'react';
import type { LandingTelemetry, LandingAvailability } from '../contracts/landing';
import type { SolarEngine } from '../engine/SolarEngine';

interface LunarLandingHUDProps {
  engine: SolarEngine | null;
}

/** 着陆可用性轮询（300ms，引擎权威）——LandingDockRow 与遥测面板共用 */
function useLandingEngineState(engine: SolarEngine | null) {
  const [telemetry, setTelemetry] = useState<LandingTelemetry | null>(null);
  const [availability, setAvailability] = useState<LandingAvailability | null>(null);
  const [prepStatus, setPrepStatus] = useState<ReturnType<SolarEngine['getLandingPreparationStatus']> | null>(null);
  const [sites, setSites] = useState<ReturnType<SolarEngine['getLandingSiteChoices']>>([]);

  useEffect(() => {
    if (!engine) return;
    const controller = engine.getLandingController();
    const unsub = controller.addListener((data) => {
      setTelemetry({ ...data });
    });
    return () => unsub();
  }, [engine]);

  // P3b-A：入口由引擎权威可用性驱动（300ms 轮询）——不以"选中月球"冒充到达
  useEffect(() => {
    if (!engine) return;
    const tick = () => {
      setAvailability(engine.getLandingAvailability());
      setPrepStatus(engine.getLandingPreparationStatus());
      setSites(engine.getLandingSiteChoices());
    };
    tick();
    const id = window.setInterval(tick, 300);
    return () => window.clearInterval(id);
  }, [engine]);

  return { telemetry, availability, prepStatus, sites };
}

/**
 * F-LANDING-HUD-01：底部 HUD 当前天体区的紧凑着陆行。
 * `着陆：陶拉斯—利特罗山谷 ▾ [前往/降落]`——选择（原生 select）+ 动作/等待态
 * 合成一行；长英文名/数据徽章/出处说明不进入常驻行。语义与原悬浮入口一致。
 */
export const LandingDockRow: React.FC<LunarLandingHUDProps> = ({ engine }) => {
  const { telemetry, availability, sites } = useLandingEngineState(engine);
  if (!engine) return null;
  const state = telemetry?.state || 'ORBIT';
  const inOrbitLandingFlow = state === 'ORBIT' || availability?.action === 'exit-observe';
  if (!inOrbitLandingFlow || !availability) return null;

  return (
    <div className="hud-landing-row" data-testid="hud-landing-row">
      {state === 'ORBIT' && sites.length > 0 && availability?.siteId && (
        <>
          <span className="hud-landing-label">着陆：</span>
          <select
            data-testid="landing-site-select"
            aria-label="选择着陆地点"
            value={availability.siteId}
            onChange={event => { engine.selectLandingSite(event.target.value); }}
          >
            {sites.map(site => <option key={site.id} value={site.id}>{site.name}</option>)}
          </select>
        </>
      )}
      {state === 'ORBIT' && availability?.action === 'land' && (
        <button
          data-testid="lunar-landing-start-btn"
          className="hud-landing-action is-primary"
          onClick={() => engine.startLunarLanding()}
        >
          🚀 降落
        </button>
      )}
      {state === 'ORBIT' && availability?.action === 'travel-to-site' && (
        <button
          data-testid="lunar-landing-travel-site-btn"
          className="hud-landing-action"
          onClick={() => engine.travelToLandingSite()}
          title="着陆区在天体背面，先绕行前往着陆区上空"
        >
          🧭 前往
        </button>
      )}
      {state === 'ORBIT' && availability?.action === 'wait' && (
        <span data-testid="lunar-landing-wait" className="hud-landing-wait" title={availability.detail ?? undefined}>
          ⏳ {availability.detail ?? '准备中…'}
        </span>
      )}
      {/* 1a-S4b. 火星地表观察（observe 快捷路径/探针进入）兜底入口 */}
      {availability?.action === 'exit-observe' && (
        <button
          data-testid="mars-observe-exit-btn"
          className="hud-landing-action"
          onClick={() => engine.exitJezeroSurfaceObserve()}
        >
          🚀 返回火星轨道
        </button>
      )}
    </div>
  );
};

export const LunarLandingHUD: React.FC<LunarLandingHUDProps> = ({ engine }) => {
  const { telemetry, prepStatus } = useLandingEngineState(engine);

  if (!engine) return null;

  const state = telemetry?.state || 'ORBIT';

  // 格式化高度
  const formatAltitude = (meters: number) => {
    if (meters >= 1000) {
      return `${(meters / 1000).toFixed(2)} km`;
    }
    return `${meters < 10 ? meters.toFixed(1) : Math.round(meters)} m`;
  };

  return (
    <>
      {/* 2. 下降、悬停、停驻与升空时的全局遥测仪表板 */}
      {state !== 'ORBIT' && telemetry && (
        <div
          data-testid="lunar-landing-telemetry-hud"
          className="landing-telemetry"
          style={{
            position: 'absolute',
            top: 104,
            right: 20,
            width: 320,
            maxHeight: 'calc(100vh - 290px)',
            overflowY: 'auto',
            background: 'rgba(15, 23, 42, 0.88)',
            backdropFilter: 'blur(16px)',
            border: '1px solid rgba(56, 189, 248, 0.3)',
            borderRadius: 14,
            padding: 16,
            color: '#f8fafc',
            fontSize: 12,
            zIndex: 40,
            boxShadow: '0 12px 32px rgba(0, 0, 0, 0.5)',
            pointerEvents: 'auto',
          }}
        >
          {/* 状态徽标与标题 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 14 }}>
                {state === 'PREPARING'
                  ? '📡'
                  : state === 'DESCENDING'
                  ? '🛬'
                  : state === 'HOLD'
                  ? '⏸'
                  : state === 'SURFACE_LOOK'
                  ? '🌕'
                  : '🚀'}
              </span>
              <span style={{ fontWeight: 700, fontSize: 13, color: '#38bdf8' }}>
                {state === 'PREPARING'
                  ? '正在装载真实 DTM 地形…'
                  : state === 'DESCENDING'
                  ? '下降序列进行中'
                  : state === 'HOLD'
                  ? '下降已暂停 · 悬停检查'
                  : state === 'SURFACE_LOOK'
                  ? '地表停驻 · 原地环顾'
                  : '升空返轨中'}
              </span>
            </div>
            <span
              data-testid="landing-state-tag"
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: '2px 6px',
                borderRadius: 6,
                background:
                  state === 'SURFACE_LOOK'
                    ? 'rgba(34, 197, 94, 0.2)'
                    : state === 'HOLD'
                    ? 'rgba(234, 179, 8, 0.2)'
                    : 'rgba(56, 189, 248, 0.2)',
                color:
                  state === 'SURFACE_LOOK'
                    ? '#4ade80'
                    : state === 'HOLD'
                    ? '#fde047'
                    : '#38bdf8',
                border:
                  state === 'SURFACE_LOOK'
                    ? '1px solid rgba(34, 197, 94, 0.3)'
                    : state === 'HOLD'
                    ? '1px solid rgba(234, 179, 8, 0.3)'
                    : '1px solid rgba(56, 189, 248, 0.3)',
              }}
            >
              {state}
            </span>
          </div>

          {/* 地点与科学出处说明 */}
          <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 12, borderBottom: '1px solid rgba(255,255,255,0.08)', paddingBottom: 8 }}>
            <div style={{ fontWeight: 600, color: '#e2e8f0' }}>{telemetry.site.subtitle}</div>
            <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>{telemetry.site.provenance}</div>
            {telemetry.terrain && (
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>
                地形：{telemetry.terrain.fidelity === 'measured-dem'
                  ? `真实 DTM (${telemetry.terrain.sourceId})`
                  : telemetry.terrain.fidelity === 'datum-sphere'
                  ? '基准球（无本地 DTM 覆盖）'
                  : '未装载'}
                <span style={{ color: telemetry.terrain.admissionState.startsWith('admitted') ? '#4ade80' : '#fde047' }}>
                  {' · '}
                  {telemetry.terrain.admissionState.startsWith('admitted') ? '已验收准入' : '待配准验收'}
                </span>
              </div>
            )}
          </div>

          {/* 核心飞行读数仪表网格 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
            <div style={{ background: 'rgba(255, 255, 255, 0.04)', padding: '8px 10px', borderRadius: 8 }}>
              <div style={{ fontSize: 10, color: '#94a3b8' }}>离地高度 (AGL)</div>
              <div data-testid="telemetry-agl-value" style={{ fontSize: 16, fontWeight: 700, color: '#38bdf8', fontFamily: 'monospace' }}>
                {formatAltitude(telemetry.altitudeAGLM)}
              </div>
            </div>

            <div style={{ background: 'rgba(255, 255, 255, 0.04)', padding: '8px 10px', borderRadius: 8 }}>
              <div style={{ fontSize: 10, color: '#94a3b8' }}>垂直速度</div>
              <div data-testid="telemetry-vspeed-value" style={{ fontSize: 16, fontWeight: 700, color: '#f8fafc', fontFamily: 'monospace' }}>
                {telemetry.verticalSpeedMps} m/s
              </div>
            </div>

            <div style={{ background: 'rgba(255, 255, 255, 0.04)', padding: '8px 10px', borderRadius: 8 }}>
              <div style={{ fontSize: 10, color: '#94a3b8' }}>表面经纬度</div>
              <div data-testid="telemetry-coord-value" style={{ fontSize: 11, fontWeight: 600, color: '#cbd5e1', marginTop: 3 }}>
                {Math.abs(telemetry.currentLat).toFixed(2)}°{telemetry.currentLat < 0 ? 'S' : 'N'}, {Math.abs(((telemetry.currentLon + 180) % 360 + 360) % 360 - 180).toFixed(2)}°{((telemetry.currentLon + 180) % 360 + 360) % 360 - 180 < 0 ? 'W' : 'E'}
              </div>
            </div>

            <div style={{ background: 'rgba(255, 255, 255, 0.04)', padding: '8px 10px', borderRadius: 8 }}>
              <div style={{ fontSize: 10, color: '#94a3b8' }}>人眼方位 / 仰角</div>
              <div data-testid="telemetry-orientation-value" style={{ fontSize: 11, fontWeight: 600, color: '#cbd5e1', marginTop: 3 }}>
                {telemetry.surfaceYawDeg}° / {telemetry.surfacePitchDeg}°
              </div>
            </div>
          </div>

          {/* 进度条 */}
          {(state === 'DESCENDING' || state === 'ASCENDING') && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#94a3b8', marginBottom: 4 }}>
                <span>{state === 'DESCENDING' ? '进近轨迹完成度' : '爬升至 50km 轨道'}</span>
                <span>{Math.round(telemetry.progress * 100)}%</span>
              </div>
              <div style={{ width: '100%', height: 4, background: 'rgba(255,255,255,0.1)', borderRadius: 2, overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${telemetry.progress * 100}%`,
                    height: '100%',
                    background: '#38bdf8',
                    transition: 'width 0.1s linear',
                  }}
                />
              </div>
            </div>
          )}

          {/* 交互提示 */}
          <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 12, lineHeight: 1.4 }}>
            {state === 'PREPARING' && (
              <span>
                📡 正在准备降落：{prepStatus?.phase === 'policy' && '切换物理观察比例…'}
                {prepStatus?.phase === 'lighting' && '选择光照良好的模拟时刻…'}
                {prepStatus?.phase === 'capture' && '捕获当前机位与视线…'}
                {!prepStatus?.phase && '等待资源…'}
                {prepStatus?.lightingAdjustedSimHours != null && (
                  <span data-testid="landing-prep-lighting-notice">
                    {' '}已调整模拟时刻至站点白昼（T+{Math.round(prepStatus.lightingAdjustedSimHours)}h）
                  </span>
                )}
                <br />准备期间可自由环顾——任何操作都会从新机位重新准备。
              </span>
            )}
            {state === 'DESCENDING' && '💡 提示：按住鼠标拖拽画面可随时暂停位移进行悬停检查。'}
            {state === 'HOLD' && '⏸ 悬停保持：位移已停驻，可自由拖拽环顾山谷；需要时可点"恢复导引视线"平滑转回地平线构图。'}
            {state === 'SURFACE_LOOK' && `👀 位于${telemetry.site.name}，眼高 ${formatAltitude(telemetry.altitudeAGLM)}，可原地转头与仰望天空。`}
          </div>

          {/* 操作行动按钮栏 */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {state === 'PREPARING' && (
              <button
                data-testid="landing-btn-cancel-prep"
                onClick={() => engine.getLandingController().cancelPreparation()}
                style={{
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: '1px solid rgba(255,255,255,0.1)',
                  background: 'rgba(255,255,255,0.05)',
                  color: '#cbd5e1',
                  cursor: 'pointer',
                }}
              >
                ↩ 取消准备
              </button>
            )}

            {state === 'DESCENDING' && (
              <>
                <button
                  data-testid="landing-btn-hold"
                  onClick={() => engine.pauseLanding()}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: '1px solid rgba(234, 179, 8, 0.4)',
                    background: 'rgba(234, 179, 8, 0.15)',
                    color: '#fef08a',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  ⏸ 悬停检查 (HOLD)
                </button>
                <button
                  data-testid="landing-btn-cancel"
                  onClick={() => engine.returnToLunarOrbit()}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    background: 'rgba(255, 255, 255, 0.05)',
                    color: '#cbd5e1',
                    cursor: 'pointer',
                  }}
                >
                  ↩ 取消并返回轨道
                </button>
              </>
            )}

            {state === 'HOLD' && (
              <>
                <button
                  data-testid="landing-btn-resume"
                  onClick={() => engine.resumeLanding()}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: '1px solid rgba(56, 189, 248, 0.5)',
                    background: 'rgba(56, 189, 248, 0.2)',
                    color: '#ffffff',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  ▶ 继续降落 (RESUME)
                </button>
                <button
                  data-testid="landing-btn-reguide"
                  onClick={() => engine.requestLandingReguide()}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: '1px solid rgba(148, 163, 184, 0.4)',
                    background: 'rgba(148, 163, 184, 0.12)',
                    color: '#e2e8f0',
                    cursor: 'pointer',
                  }}
                >
                  🎯 恢复导引视线（位移保持悬停）
                </button>
                <button
                  data-testid="landing-btn-return-hold"
                  onClick={() => engine.returnToLunarOrbit()}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    background: 'rgba(255, 255, 255, 0.05)',
                    color: '#cbd5e1',
                    cursor: 'pointer',
                  }}
                >
                  🚀 返回轨道
                </button>
              </>
            )}

            {state === 'SURFACE_LOOK' && (
              <>
                {telemetry.site.lookTargetBodyId === 'earth' && (
                <button
                  data-testid="landing-btn-look-earth"
                  onClick={() => engine.lookAtEarthFromMoon()}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: '1px solid rgba(56, 189, 248, 0.6)',
                    background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.25), rgba(14, 165, 233, 0.15))',
                    color: '#ffffff',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  🌍 仰望地球
                </button>
                )}
                <button
                  data-testid="landing-btn-reset-look"
                  onClick={() => engine.resetMoonSurfaceLook()}
                  style={{
                    padding: '7px 12px',
                    borderRadius: 8,
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    background: 'rgba(255, 255, 255, 0.05)',
                    color: '#cbd5e1',
                    cursor: 'pointer',
                  }}
                >
                  🔄 重设平视地平线
                </button>
                <button
                  data-testid="landing-btn-return-orbit"
                  onClick={() => engine.returnToLunarOrbit()}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: '1px solid rgba(148, 163, 184, 0.3)',
                    background: 'rgba(148, 163, 184, 0.1)',
                    color: '#f8fafc',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  🚀 启动升空 · 返回轨道
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
};
