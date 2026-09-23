/**
 * 月球落地与地表停驻遥测仪表 HUD (LunarLandingHUD.tsx)
 * 遵循批次 R5 规范：
 * 1. 呈现状态机完整语义：ORBIT -> DESCENDING -> HOLD -> SURFACE_LOOK -> ASCENDING；
 * 2. 实时显示 AGL 离地真高、MSL 基准高程、垂直速度与表面坐标；
 * 3. 支持随时暂停 (HOLD)、继续 (RESUME)、仰望地球与返回轨道；
 * 4. 具备清晰的科学标注（陶拉斯—利特罗山谷 · 虚拟降落，NASA LROC DTM 5m 剖面标定）。
 */

import React, { useEffect, useState } from 'react';
import type { LandingTelemetry } from '../contracts/landing';
import type { SolarEngine } from '../engine/SolarEngine';

interface LunarLandingHUDProps {
  engine: SolarEngine | null;
  activeBodyId: string;
}

export const LunarLandingHUD: React.FC<LunarLandingHUDProps> = ({ engine, activeBodyId }) => {
  const [telemetry, setTelemetry] = useState<LandingTelemetry | null>(null);

  useEffect(() => {
    if (!engine) return;
    const controller = engine.getLandingController();
    const unsub = controller.addListener((data) => {
      setTelemetry({ ...data });
    });
    return () => unsub();
  }, [engine]);

  if (!engine) return null;

  const targetId = engine.getCameraSnapshot()?.targetBodyId || activeBodyId;
  const isMoonSelected = targetId === 'moon' || activeBodyId === 'moon';
  const state = telemetry?.state || 'ORBIT';

  // 格式化高度
  const formatAltitude = (meters: number) => {
    if (meters >= 1000) {
      return `${(meters / 1000).toFixed(2)} km`;
    }
    return `${Math.round(meters)} m`;
  };

  return (
    <>
      {/* 1. 月球处于轨道模式时，显式提供着陆行动入口按钮 */}
      {isMoonSelected && state === 'ORBIT' && (
        <div
          style={{
            position: 'absolute',
            bottom: 84,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 35,
            pointerEvents: 'auto',
          }}
        >
          <button
            data-testid="lunar-landing-start-btn"
            onClick={() => engine.startLunarLanding()}
            style={{
              padding: '10px 20px',
              borderRadius: 24,
              border: '1px solid rgba(56, 189, 248, 0.6)',
              background: 'linear-gradient(135deg, rgba(14, 165, 233, 0.28), rgba(2, 132, 199, 0.16))',
              backdropFilter: 'blur(12px)',
              color: '#ffffff',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              boxShadow: '0 8px 24px rgba(2, 132, 199, 0.25)',
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.borderColor = '#38bdf8';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.borderColor = 'rgba(56, 189, 248, 0.6)';
            }}
          >
            <span style={{ fontSize: 16 }}>🚀</span>
            <span>降落 Taurus–Littrow 山谷</span>
            <span
              style={{
                fontSize: 10,
                color: '#bae6fd',
                background: 'rgba(56, 189, 248, 0.2)',
                padding: '2px 6px',
                borderRadius: 10,
              }}
            >
              5m DTM 真实地形
            </span>
          </button>
        </div>
      )}

      {/* 2. 下降、悬停、停驻与升空时的全局遥测仪表板 */}
      {state !== 'ORBIT' && telemetry && (
        <div
          data-testid="lunar-landing-telemetry-hud"
          style={{
            position: 'absolute',
            top: 72,
            right: 20,
            width: 320,
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
                  ? '月表停驻 · 原地环顾'
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
                {telemetry.currentLat.toFixed(2)}°N, {telemetry.currentLon.toFixed(2)}°E
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
            {state === 'DESCENDING' && '💡 提示：按住鼠标拖拽画面可随时暂停位移进行悬停检查。'}
            {state === 'HOLD' && '⏸ 当前已进入悬停保持模式，位移已停驻，可自由拖拽环顾周围山谷。'}
            {state === 'SURFACE_LOOK' && '👀 位于陶拉斯—利特罗谷底 1.7m 人眼视高，可 360° 原地转头与仰望天空。'}
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
                  🚀 返回月球轨道
                </button>
              </>
            )}

            {state === 'SURFACE_LOOK' && (
              <>
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
                  🌍 仰望母星地球 (53.7° 仰角 · 1.90° 视圆盘)
                </button>
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
                  🔄 重设平视山谷地平线
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
                  🚀 启动升空 · 返回月球轨道
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
};
