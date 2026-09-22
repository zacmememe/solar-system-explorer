/**
 * 航天器机库模态窗 HangarModal
 * 遵循 04-VEHICLES.zh-CN.md 规范：
 * 1. 完整展示六大航天器（阿波罗登月舱、旅行者1号、韦伯望远镜、国际空间站、天宫空间站、卡西尼号）；
 * 2. 真实米制物理尺寸对比标尺；
 * 3. 结构热点交互科普（给孩子的一句话 + 深入科学原理）；
 * 4. “搭乘这艘飞船伴飞”双向联动引擎。
 */

import React, { useState } from 'react';
import type { VehicleId } from '../contracts/vehicle';
import { VEHICLE_CATALOG } from './VehicleCatalog';
import { VehicleViewer3D } from './VehicleViewer3D';
import { X, Rocket, Ruler, Eye, Sparkles } from 'lucide-react';

interface HangarModalProps {
  currentVehicleId: VehicleId | null;
  onSelectVehicle: (id: VehicleId) => void;
  onClearVehicle?: () => void;
  onClose: () => void;
}

const VEHICLE_LIST: VehicleId[] = [
  'apollo-lm',
  'voyager-1',
  'james-webb',
  'hubble',
  'iss',
  'tiangong',
  'cassini',
];

export const HangarModal: React.FC<HangarModalProps> = ({
  currentVehicleId,
  onSelectVehicle,
  onClearVehicle,
  onClose,
}) => {
  const [selectedId, setSelectedId] = useState<VehicleId>(currentVehicleId || 'apollo-lm');
  const [scaleMode, setScaleMode] = useState<'framed' | 'metric'>('framed');
  const [activeHotspotId, setActiveHotspotId] = useState<string | null>(null);

  const def = VEHICLE_CATALOG[selectedId];

  const handleSelect = (id: VehicleId) => {
    setSelectedId(id);
    setActiveHotspotId(null);
  };

  const handleBoard = () => {
    onSelectVehicle(selectedId);
    onClose();
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(3, 7, 18, 0.82)',
        backdropFilter: 'blur(16px)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        style={{
          width: '94vw',
          maxWidth: 1100,
          maxHeight: '90vh',
          backgroundColor: '#0c1322',
          borderRadius: 20,
          border: '1px solid rgba(56, 189, 248, 0.25)',
          boxShadow: '0 16px 64px rgba(0, 0, 0, 0.8)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          color: '#f1f5f9',
        }}
      >
        {/* 顶部标题栏 */}
        <div
          style={{
            padding: '16px 24px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'rgba(15, 23, 42, 0.65)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                background: 'rgba(56, 189, 248, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#38bdf8',
              }}
            >
              <Rocket size={18} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>
                航天器机库 · Spacecraft Hangar
              </h2>
              <span style={{ fontSize: 11, color: '#94a3b8' }}>
                选择你要搭乘伴飞的人类太空探索载具
              </span>
            </div>
          </div>

          <button
            onClick={onClose}
            aria-label="关闭机库"
            title="关闭机库"
            style={{
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '50%',
              width: 44,
              height: 44,
              minWidth: 44,
              minHeight: 44,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#94a3b8',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* 载具横向选择切换标签 */}
        <div
          style={{
            display: 'flex',
            gap: 8,
            padding: '12px 24px',
            overflowX: 'auto',
            background: 'rgba(10, 16, 28, 0.4)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
          }}
        >
          {VEHICLE_LIST.map((id) => {
            const v = VEHICLE_CATALOG[id];
            const isSelected = selectedId === id;
            const isBoarded = currentVehicleId === id;

            return (
              <button
                key={id}
                onClick={() => handleSelect(id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 14px',
                  borderRadius: 12,
                  background: isSelected ? 'rgba(56, 189, 248, 0.22)' : 'rgba(255, 255, 255, 0.03)',
                  border: isSelected ? '1px solid #38bdf8' : '1px solid rgba(255, 255, 255, 0.08)',
                  color: isSelected ? '#ffffff' : '#94a3b8',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: isSelected ? 600 : 400,
                  whiteSpace: 'nowrap',
                  transition: 'all 0.18s ease',
                }}
              >
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    backgroundColor: `#${v.accentColorHex.toString(16).padStart(6, '0')}`,
                  }}
                />
                <span>{v.name}</span>
                {isBoarded && (
                  <span
                    style={{
                      fontSize: 9,
                      padding: '1px 5px',
                      borderRadius: 4,
                      background: 'rgba(34, 197, 94, 0.2)',
                      color: '#4ade80',
                      border: '1px solid rgba(34, 197, 94, 0.4)',
                    }}
                  >
                    伴飞中
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* 核心双栏展示区 */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'row',
            overflowY: 'auto',
          }}
        >
          {/* 左栏：3D 交互预览与真实米制尺寸标尺 */}
          <div
            style={{
              flex: 1.15,
              padding: 20,
              display: 'flex',
              flexDirection: 'column',
              borderRight: '1px solid rgba(255, 255, 255, 0.06)',
            }}
          >
            {/* 3D 交互画布容器 */}
            <div
              style={{
                flex: 1,
                minHeight: 320,
                borderRadius: 14,
                overflow: 'hidden',
                position: 'relative',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                background: '#070b14',
              }}
            >
              <VehicleViewer3D
                vehicleId={selectedId}
                activeHotspotId={activeHotspotId}
                scaleMode={scaleMode}
              />

              {/* 构图视角模式切换小浮窗 */}
              <div
                style={{
                  position: 'absolute',
                  top: 12,
                  right: 12,
                  display: 'flex',
                  gap: 4,
                  background: 'rgba(15, 23, 42, 0.85)',
                  backdropFilter: 'blur(8px)',
                  padding: 3,
                  borderRadius: 8,
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                }}
              >
                <button
                  onClick={() => setScaleMode('framed')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '4px 8px',
                    borderRadius: 6,
                    border: 'none',
                    background: scaleMode === 'framed' ? '#0284c7' : 'transparent',
                    color: scaleMode === 'framed' ? '#fff' : '#94a3b8',
                    cursor: 'pointer',
                    fontSize: 11,
                  }}
                  title="自动适配合适构图比例"
                >
                  <Eye size={12} />
                  <span>最佳构图</span>
                </button>
                <button
                  onClick={() => setScaleMode('metric')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '4px 8px',
                    borderRadius: 6,
                    border: 'none',
                    background: scaleMode === 'metric' ? '#0284c7' : 'transparent',
                    color: scaleMode === 'metric' ? '#fff' : '#94a3b8',
                    cursor: 'pointer',
                    fontSize: 11,
                  }}
                  title="真实 1:1 米制比例（感受 109m ISS 与 3.7m Voyager 的巨大体积反差）"
                >
                  <Ruler size={12} />
                  <span>1:1 真实米制对比</span>
                </button>
              </div>

              <div
                style={{
                  position: 'absolute',
                  bottom: 10,
                  left: 12,
                  fontSize: 10,
                  color: '#64748b',
                  pointerEvents: 'none',
                }}
              >
                🖱️ 鼠标按住并拖拽可 360° 旋转观察
              </div>
            </div>

            {/* 真实米制物理尺寸对比标尺卡片 */}
            <div
              style={{
                marginTop: 14,
                background: 'rgba(15, 23, 42, 0.5)',
                padding: '12px 16px',
                borderRadius: 12,
                border: '1px solid rgba(255, 255, 255, 0.06)',
                fontSize: 12,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 8,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#38bdf8', fontWeight: 600 }}>
                  <Ruler size={13} />
                  <span>真实物理尺寸 (Real Dimensions)</span>
                </div>
                <div style={{ color: '#94a3b8', fontSize: 11 }}>
                  发射重量: <strong style={{ color: '#e2e8f0' }}>{(def.massKg / 1000).toFixed(1)} 吨</strong> ({def.massKg.toLocaleString()} kg)
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, textAlign: 'center' }}>
                <div style={{ background: 'rgba(255,255,255,0.03)', padding: '6px 8px', borderRadius: 8 }}>
                  <div style={{ fontSize: 10, color: '#64748b' }}>长 / 跨度</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#f8fafc' }}>{def.dimensions.lengthM} 米</div>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.03)', padding: '6px 8px', borderRadius: 8 }}>
                  <div style={{ fontSize: 10, color: '#64748b' }}>宽度</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#f8fafc' }}>{def.dimensions.widthM} 米</div>
                </div>
                <div style={{ background: 'rgba(255,255,255,0.03)', padding: '6px 8px', borderRadius: 8 }}>
                  <div style={{ fontSize: 10, color: '#64748b' }}>高度</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#f8fafc' }}>{def.dimensions.heightM} 米</div>
                </div>
              </div>

              {/* 参照物形象对比条 */}
              <div style={{ marginTop: 10, fontSize: 11, color: '#94a3b8' }}>
                <span>生活参照：</span>
                <span style={{ color: '#e2e8f0' }}>
                  {def.dimensions.lengthM >= 100
                    ? '比一个标准足球场还要大！'
                    : def.dimensions.lengthM >= 30
                    ? '相当于 3 辆大巴车首尾相连！'
                    : def.dimensions.lengthM >= 15
                    ? '约相当于半个标准网球场！'
                    : def.dimensions.lengthM >= 6
                    ? '大约相当于两层居民小洋楼的高度！'
                    : '小巧精密，展开天线约相当于一个大客厅。'}
                </span>
              </div>
            </div>
          </div>

          {/* 右栏：航天档案、亲子记忆点与结构热点 */}
          <div
            style={{
              flex: 1,
              padding: 24,
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
              overflowY: 'auto',
            }}
          >
            {/* 载具名头与档案标签 */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span
                  style={{
                    fontSize: 10,
                    padding: '2px 8px',
                    borderRadius: 6,
                    background: 'rgba(56, 189, 248, 0.15)',
                    color: '#38bdf8',
                    border: '1px solid rgba(56, 189, 248, 0.3)',
                  }}
                >
                  {def.agency}
                </span>
                <span style={{ fontSize: 11, color: '#64748b' }}>{def.launchYear} 年发射</span>
              </div>

              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#f8fafc' }}>{def.name}</h1>
              <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{def.nameEn}</div>
            </div>

            {/* 给孩子的一句话记忆点 */}
            <div
              style={{
                background: 'rgba(234, 179, 8, 0.12)',
                borderLeft: '4px solid #eab308',
                padding: '12px 16px',
                borderRadius: 8,
                fontSize: 13,
                lineHeight: 1.55,
                color: '#fef08a',
              }}
            >
              💡 <strong>给孩子的一句话：</strong>
              <div style={{ marginTop: 4, color: '#fef9c3' }}>{def.kidFact}</div>
            </div>

            {/* 结构热点交互专区 */}
            <div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: '#38bdf8',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  marginBottom: 8,
                }}
              >
                <Sparkles size={13} />
                <span>核心结构解密 (点击热点查看揭秘)</span>
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {def.hotspots.map((hs) => {
                  const isActive = activeHotspotId === hs.id;
                  return (
                    <button
                      key={hs.id}
                      onClick={() => setActiveHotspotId(isActive ? null : hs.id)}
                      style={{
                        padding: '6px 12px',
                        borderRadius: 8,
                        background: isActive ? '#0284c7' : 'rgba(255, 255, 255, 0.05)',
                        border: isActive ? '1px solid #38bdf8' : '1px solid rgba(255, 255, 255, 0.08)',
                        color: isActive ? '#ffffff' : '#cbd5e1',
                        cursor: 'pointer',
                        fontSize: 11,
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {hs.name}
                    </button>
                  );
                })}
              </div>

              {/* 选中的热点科普解密 */}
              {activeHotspotId && (() => {
                const curHs = def.hotspots.find((h) => h.id === activeHotspotId);
                if (!curHs) return null;
                return (
                  <div
                    style={{
                      marginTop: 10,
                      background: 'rgba(30, 41, 59, 0.65)',
                      padding: '10px 14px',
                      borderRadius: 8,
                      border: '1px solid rgba(56, 189, 248, 0.25)',
                      fontSize: 11,
                      lineHeight: 1.55,
                    }}
                  >
                    <div style={{ color: '#38bdf8', fontWeight: 600, marginBottom: 3 }}>
                      🔍 {curHs.name}
                    </div>
                    <div style={{ color: '#e2e8f0', marginBottom: 4 }}>
                      <strong>孩子好懂：</strong>{curHs.kidTip}
                    </div>
                    <div style={{ color: '#94a3b8' }}>
                      <strong>科学原理：</strong>{curHs.scienceDetail}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* 详细任务档案与科学成就（家长科普） */}
            <div
              style={{
                background: 'rgba(15, 23, 42, 0.4)',
                padding: '12px 14px',
                borderRadius: 8,
                fontSize: 11,
                lineHeight: 1.6,
                color: '#94a3b8',
              }}
            >
              <div style={{ color: '#e2e8f0', fontWeight: 600, marginBottom: 4 }}>
                🏆 历史里程碑：
              </div>
              <div style={{ color: '#cbd5e1', marginBottom: 6 }}>{def.keyMilestone}</div>
              <div style={{ color: '#94a3b8' }}>{def.description}</div>
              <div style={{ marginTop: 6, fontSize: 10, color: '#64748b' }}>
                档案来源: {def.sourceRef}
              </div>
            </div>

            {/* 底部行动按钮 */}
            <div style={{ marginTop: 'auto', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                onClick={handleBoard}
                style={{
                  width: '100%',
                  padding: '13px 0',
                  background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: 12,
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  boxShadow: '0 4px 20px rgba(2, 132, 199, 0.45)',
                  transition: 'transform 0.15s, box-shadow 0.15s',
                }}
              >
                <Rocket size={16} />
                <span>搭乘这艘飞船出征伴飞 (Board & Fly)</span>
              </button>

              {currentVehicleId && onClearVehicle && (
                <button
                  onClick={() => {
                    onClearVehicle();
                    onClose();
                  }}
                  style={{
                    width: '100%',
                    padding: '10px 0',
                    background: 'rgba(239, 68, 68, 0.15)',
                    color: '#fca5a5',
                    border: '1px solid rgba(239, 68, 68, 0.35)',
                    borderRadius: 12,
                    fontWeight: 600,
                    fontSize: 13,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    transition: 'all 0.15s ease',
                  }}
                >
                  <X size={15} />
                  <span>结束伴飞 · 移除航天器 (Clear Vehicle)</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
