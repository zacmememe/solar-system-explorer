import React from 'react';
import type { BodyId } from '../contracts/body';
import type { CameraStateSnapshot } from '../contracts/camera';
import { BODIES } from '../astronomy/bodies';

interface TrajectoryArcHUDProps {
  selectedBodyId: BodyId;
  cameraSnapshot: CameraStateSnapshot | null;
  onSelectBody: (id: BodyId) => void;
  timeScale: number;
}

interface PlanetNode {
  id: BodyId;
  name: string;
  symbol: string;
  au: number;
  u: number;
  color: string;
  speedKmS: number;
}

const PLANET_NODES: PlanetNode[] = [
  { id: 'sun', name: '太阳', symbol: '☀️', au: 0.0, u: 0.04, color: '#f59e0b', speedKmS: 0 },
  { id: 'mercury', name: '水星', symbol: '☿', au: 0.39, u: 0.14, color: '#94a3b8', speedKmS: 47.36 },
  { id: 'venus', name: '金星', symbol: '♀', au: 0.72, u: 0.24, color: '#fb923c', speedKmS: 35.02 },
  { id: 'earth', name: '地球', symbol: '🌍', au: 1.0, u: 0.35, color: '#38bdf8', speedKmS: 29.78 },
  { id: 'mars', name: '火星', symbol: '♂', au: 1.52, u: 0.46, color: '#ef4444', speedKmS: 24.07 },
  { id: 'jupiter', name: '木星', symbol: '♃', au: 5.2, u: 0.59, color: '#f97316', speedKmS: 13.07 },
  { id: 'saturn', name: '土星', symbol: '♄', au: 9.58, u: 0.72, color: '#eab308', speedKmS: 9.69 },
  { id: 'uranus', name: '天王星', symbol: '♅', au: 19.2, u: 0.85, color: '#06b6d4', speedKmS: 6.81 },
  { id: 'neptune', name: '海王星', symbol: '♆', au: 30.1, u: 0.96, color: '#3b82f6', speedKmS: 5.43 },
];

/**
 * 沿抛物微弧 (Quadratic Bezier) 计算二维坐标
 * 起点 (32, 46)，控制点 (280, 8)，终点 (528, 46)
 */
function getArcPoint(u: number): { x: number; y: number } {
  const clampedU = Math.max(0, Math.min(1, u));
  const x0 = 32;
  const x1 = 280;
  const x2 = 528;
  const y0 = 36;
  const y1 = 10;
  const y2 = 36;

  const invU = 1 - clampedU;
  const x = invU * invU * x0 + 2 * invU * clampedU * x1 + clampedU * clampedU * x2;
  const y = invU * invU * y0 + 2 * invU * clampedU * y1 + clampedU * clampedU * y2;
  return { x, y };
}

export const TrajectoryArcHUD: React.FC<TrajectoryArcHUDProps> = ({
  selectedBodyId,
  cameraSnapshot,
  onSelectBody,
  timeScale,
}) => {
  const isTransitioning = !!cameraSnapshot?.isTransitioning;
  const progress = Math.max(0, Math.min(1, cameraSnapshot?.transitionProgress ?? 0));

  // 获取当前焦点天体以及其母星
  const activeBody = BODIES[selectedBodyId] || BODIES.sun;
  const currentPlanetId = activeBody.type === 'moon' ? activeBody.parentId : activeBody.id;

  // 飞行状态下的起终点天体
  const sourceId = cameraSnapshot?.sourceBodyId || 'earth';
  const targetId = cameraSnapshot?.targetBodyId || selectedBodyId;
  const fromBody = BODIES[sourceId] || BODIES.earth;
  const toBody = BODIES[targetId] || BODIES.mars;

  // 停泊态日心距离与光行时换算 (Speed of light = 299,792.458 km/s)
  const distAU = activeBody.orbitSemiMajorAxisKm > 0
    ? (activeBody.orbitSemiMajorAxisKm / 149598023).toFixed(2)
    : activeBody.id === 'sun' ? '0.00' : '1.00';
  const lightTimeMin = activeBody.orbitSemiMajorAxisKm > 0
    ? ((activeBody.orbitSemiMajorAxisKm / 299792.458) / 60).toFixed(1)
    : activeBody.id === 'sun' ? '0.0' : '8.3';

  // 飞行态：计算当前飞船光标在弧线上的插值坐标
  const craftU = 0.08 + progress * (0.92 - 0.08);
  const craftPos = getArcPoint(craftU);

  // 飞行进度分段
  const flightStageText = progress < 0.28
    ? 'TMI / 转移轨道注入'
    : progress < 0.76
      ? 'HOHMANN CRUISE / 霍曼转移巡航'
      : 'APPROACH & CAPTURE / 引力捕获入轨';

  return (
    <div
      data-testid="spacex-trajectory-arc"
      style={{
        position: 'absolute',
        bottom: 4,
        left: '50%',
        transform: 'translateX(-50%)',
        width: 460,
        maxWidth: 'calc(100vw - 880px)',
        height: 70,
        zIndex: 16,
        color: '#f8fafc',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '2px 8px 3px 8px',
        userSelect: 'none',
        pointerEvents: 'auto',
      }}
    >
      <svg
        viewBox="0 0 560 54"
        style={{ width: '100%', height: 46, overflow: 'visible' }}
      >
        <defs>
          <linearGradient id="arcGlowGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.8" />
            <stop offset="50%" stopColor="#0284c7" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.8" />
          </linearGradient>
          <filter id="cyanGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {isTransitioning ? (
          /* ========================================================
           * 模式 B：星际霍曼转移航程推进弧 (Hohmann Transfer Arc)
           * ======================================================== */
          <g>
            {/* 未飞过的前方虚线轨迹 */}
            <path
              d="M 32,36 Q 280,10 528,36"
              fill="none"
              stroke="rgba(255, 255, 255, 0.22)"
              strokeWidth="1.5"
              strokeDasharray="4 4"
            />

            {/* 已飞过的实线高亮轨迹（根据 progress 动态绘制） */}
            <path
              d={`M 32,36 Q ${32 + (craftPos.x - 32) * 0.5},${36 + (craftPos.y - 36) * 0.5} ${craftPos.x},${craftPos.y}`}
              fill="none"
              stroke="url(#arcGlowGradient)"
              strokeWidth="2.5"
              filter="url(#cyanGlow)"
            />

            {/* 起点天体：出发星 */}
            {(() => {
              const startPos = getArcPoint(0.08);
              return (
                <g>
                  <circle cx={startPos.x} cy={startPos.y} r="4" fill="#38bdf8" />
                  <text
                    x={startPos.x}
                    y={startPos.y + 11}
                    textAnchor="middle"
                    fill="#94a3b8"
                    fontSize="9"
                    fontFamily="ui-monospace, monospace"
                  >
                    {fromBody.name}
                  </text>
                  <text
                    x={startPos.x}
                    y={startPos.y - 6}
                    textAnchor="middle"
                    fill="#38bdf8"
                    fontSize="7"
                    fontWeight="700"
                    fontFamily="ui-monospace, monospace"
                  >
                    DEPART
                  </text>
                </g>
              );
            })()}

            {/* 中途里程碑节点：TMI 注入 */}
            {(() => {
              const tmiPos = getArcPoint(0.35);
              const reached = progress >= 0.35;
              return (
                <g>
                  <circle
                    cx={tmiPos.x}
                    cy={tmiPos.y}
                    r="3"
                    fill={reached ? '#38bdf8' : 'rgba(255,255,255,0.3)'}
                  />
                  <text
                    x={tmiPos.x}
                    y={tmiPos.y - 6}
                    textAnchor="middle"
                    fill={reached ? '#38bdf8' : '#64748b'}
                    fontSize="7"
                    fontFamily="ui-monospace, monospace"
                  >
                    TMI
                  </text>
                </g>
              );
            })()}

            {/* 中途里程碑节点：MIDCOURSE / 小行星带 */}
            {(() => {
              const midPos = getArcPoint(0.65);
              const reached = progress >= 0.65;
              return (
                <g>
                  <circle
                    cx={midPos.x}
                    cy={midPos.y}
                    r="3"
                    fill={reached ? '#38bdf8' : 'rgba(255,255,255,0.3)'}
                  />
                  <text
                    x={midPos.x}
                    y={midPos.y - 6}
                    textAnchor="middle"
                    fill={reached ? '#38bdf8' : '#64748b'}
                    fontSize="7"
                    fontFamily="ui-monospace, monospace"
                  >
                    MIDCOURSE
                  </text>
                </g>
              );
            })()}

            {/* 终点天体：目标星 */}
            {(() => {
              const endPos = getArcPoint(0.92);
              const reached = progress >= 0.98;
              return (
                <g>
                  <circle
                    cx={endPos.x}
                    cy={endPos.y}
                    r="5"
                    fill={reached ? '#22c55e' : '#f59e0b'}
                    stroke={reached ? '#86efac' : 'none'}
                    strokeWidth="1.5"
                  />
                  <text
                    x={endPos.x}
                    y={endPos.y + 11}
                    textAnchor="middle"
                    fill="#f8fafc"
                    fontSize="9"
                    fontWeight="700"
                    fontFamily="ui-monospace, monospace"
                  >
                    {toBody.name}
                  </text>
                  <text
                    x={endPos.x}
                    y={endPos.y - 6}
                    textAnchor="middle"
                    fill={reached ? '#22c55e' : '#f59e0b'}
                    fontSize="7"
                    fontWeight="700"
                    fontFamily="ui-monospace, monospace"
                  >
                    {reached ? 'CAPTURE' : 'TARGET'}
                  </text>
                </g>
              );
            })()}

            {/* 实时推进的飞船发光标牌 */}
            <g transform={`translate(${craftPos.x}, ${craftPos.y})`}>
              <circle r="7" fill="none" stroke="#38bdf8" strokeWidth="1.5" opacity="0.8">
                <animate attributeName="r" values="6;9;6" dur="1.2s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.8;0.2;0.8" dur="1.2s" repeatCount="indefinite" />
              </circle>
              <circle r="4" fill="#ffffff" stroke="#38bdf8" strokeWidth="1.5" />
              <text
                x="0"
                y="-10"
                textAnchor="middle"
                fill="#38bdf8"
                fontSize="9"
                fontWeight="800"
                fontFamily="ui-monospace, monospace"
              >
                🚀 {(progress * 100).toFixed(0)}%
              </text>
            </g>
          </g>
        ) : (
          /* ========================================================
           * 模式 A：太阳系天体日心轨道分布弧 (Orbital Alignment Profile)
           * ======================================================== */
          <g>
            {/* 优雅向上隆起的太阳系主轨道切面底弧 */}
            <path
              d="M 32,36 Q 280,10 528,36"
              fill="none"
              stroke="rgba(255, 255, 255, 0.22)"
              strokeWidth="1.5"
            />

            {/* 绘制九大天体日心节点 */}
            {PLANET_NODES.map((node) => {
              const pt = getArcPoint(node.u);
              const isActive = currentPlanetId === node.id || selectedBodyId === node.id;

              return (
                <g
                  key={node.id}
                  onClick={() => onSelectBody(node.id)}
                  style={{ cursor: 'pointer' }}
                >
                  {/* 当前激活星球脉冲光晕与飞船停泊徽标 */}
                  {isActive && (
                    <g>
                      <circle
                        cx={pt.x}
                        cy={pt.y}
                        r="8"
                        fill="none"
                        stroke="#38bdf8"
                        strokeWidth="1.5"
                        opacity="0.8"
                      >
                        <animate attributeName="r" values="6;10;6" dur="1.8s" repeatCount="indefinite" />
                        <animate attributeName="opacity" values="0.8;0.3;0.8" dur="1.8s" repeatCount="indefinite" />
                      </circle>
                      <text
                        x={pt.x}
                        y={pt.y - 9}
                        textAnchor="middle"
                        fill="#38bdf8"
                        fontSize="9"
                        fontWeight="800"
                        fontFamily="ui-monospace, monospace"
                      >
                        🚀
                      </text>
                    </g>
                  )}

                  {/* 行星本体节点圆点 */}
                  <circle
                    cx={pt.x}
                    cy={pt.y}
                    r={isActive ? 4.5 : 3.5}
                    fill={node.color}
                    stroke={isActive ? '#ffffff' : 'rgba(255,255,255,0.4)'}
                    strokeWidth="1"
                  />

                  {/* 节点微型名称 */}
                  <text
                    x={pt.x}
                    y={pt.y + 10}
                    textAnchor="middle"
                    fill={isActive ? '#ffffff' : '#94a3b8'}
                    fontSize={isActive ? '9' : '8'}
                    fontWeight={isActive ? '700' : '400'}
                    fontFamily="system-ui, -apple-system, sans-serif"
                  >
                    {node.name}
                  </text>
                </g>
              );
            })}
          </g>
        )}
      </svg>

      {/* 底部 SpaceX 极简等宽航天遥测信息读数 */}
      <div
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          fontSize: 9,
          color: '#94a3b8',
          letterSpacing: '0.04em',
          padding: '0 4px',
          borderTop: '1px solid rgba(255, 255, 255, 0.08)',
          marginTop: -2,
        }}
      >
        {isTransitioning ? (
          <>
            <span style={{ color: '#38bdf8', fontWeight: 700 }}>
              FLIGHT STAGE: {flightStageText}
            </span>
            <span style={{ color: '#e2e8f0' }}>
              INTERPLANETARY HOHMANN TRANSFER · {(progress * 100).toFixed(0)}%
            </span>
            <span style={{ color: '#94a3b8' }}>
              ETA: {Math.max(0, (1 - progress) * (timeScale > 100 ? 0.8 : 2.5)).toFixed(1)}s
            </span>
          </>
        ) : (
          <>
            <span style={{ color: '#38bdf8', fontWeight: 600 }}>
              HORIZON: {activeBody.name} ({activeBody.nameEn})
            </span>
            <span>
              DIST TO SUN: <strong style={{ color: '#f8fafc' }}>{distAU} AU</strong>
            </span>
            <span>
              LIGHT TIME: <strong style={{ color: '#f8fafc' }}>{lightTimeMin} MIN</strong>
            </span>
          </>
        )}
      </div>
    </div>
  );
};
