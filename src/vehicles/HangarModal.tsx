/**
 * 航天器机库模态窗 HangarModal
 * 遵循 04-VEHICLES.zh-CN.md 及第二轮优化审计 R4 要求：
 * 1. 默认收缩为精选典藏入口（ISS 与官方 NASA Hubble GLB），旧型号归入全部历史载具兼容分区；
 * 2. 真实 NASA 官方模型凭证、许可与数据溯源展示；
 * 3. 真实米制物理尺寸对比标尺与结构热点交互；
 * 4. 工坊白光与在轨严苛日光双光照模式切换；
 * 5. 代际事务安全与登船/清空伴飞双向联动。
 */

import React, { useState } from 'react';
import type { VehicleId } from '../contracts/vehicle';
import { VEHICLE_CATALOG } from './VehicleCatalog';
import { VEHICLE_ASSET_REGISTRY, getFeaturedVehicleIds } from './VehicleAssetRegistry';
import { VehicleViewer3D } from './VehicleViewer3D';
import './HangarModal.css';
import { X, Rocket, Ruler, Eye, Sparkles, Sun, Lightbulb, CheckCircle2, ShieldCheck } from 'lucide-react';

interface HangarModalProps {
  currentVehicleId: VehicleId | null;
  pendingVehicleId?: VehicleId | null;
  onSelectVehicle: (id: VehicleId) => void;
  onClearVehicle?: () => void;
  onClose: () => void;
}

export const HangarModal: React.FC<HangarModalProps> = ({
  currentVehicleId,
  pendingVehicleId,
  onSelectVehicle,
  onClearVehicle,
  onClose,
}) => {
  // 默认选中当前伴飞载具，或精选默认 ISS
  const [selectedId, setSelectedId] = useState<VehicleId>(currentVehicleId || 'iss');
  const [scaleMode, setScaleMode] = useState<'framed' | 'metric'>('framed');
  const [lightingMode, setLightingMode] = useState<'studio' | 'orbit'>('studio');
  const [activeHotspotId, setActiveHotspotId] = useState<string | null>(null);
  const [readyId, setReadyId] = useState<VehicleId | null>(null);
  const canBoard = readyId === selectedId;

  const def = VEHICLE_CATALOG[selectedId];
  const assetRecord = VEHICLE_ASSET_REGISTRY[selectedId];

  const vehicleList = getFeaturedVehicleIds();

  const handleSelect = (id: VehicleId) => {
    setSelectedId(id);
    setActiveHotspotId(null);
  };

  const handleBoard = () => {
    if (!canBoard) return;
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
          maxWidth: 1120,
          maxHeight: '92vh',
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
                选择一位太空探索同行者
              </span>
            </div>
          </div>

          <button
            data-testid="hangar-close-btn"
            onClick={onClose}
            aria-label="关闭机库"
            title="关闭机库"
            style={{
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '50%',
              width: 38,
              height: 38,
              minWidth: 38,
              minHeight: 38,
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

        {/* 载具横向选择切换列表 */}
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
          {vehicleList.map((id) => {
            const v = VEHICLE_CATALOG[id];
            const rec = VEHICLE_ASSET_REGISTRY[id];
            const isSelected = selectedId === id;
            const isBoarded = currentVehicleId === id;

            return (
              <button
                key={id}
                data-testid={`hangar-vehicle-item-${id}`}
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
                {rec?.format === 'glb' && (
                  <span
                    style={{
                      fontSize: 9,
                      padding: '1px 5px',
                      borderRadius: 4,
                      background: 'rgba(56, 189, 248, 0.2)',
                      color: '#38bdf8',
                      border: '1px solid rgba(56, 189, 248, 0.35)',
                    }}
                  >
                    NASA GLB
                  </span>
                )}
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
          className="hangar-layout"
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'row',
            overflowY: 'auto',
          }}
        >
          {/* 左栏：3D 交互预览、光照切换与真实米制尺寸标尺 */}
          <div
            className="hangar-model-column"
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
                minHeight: 340,
                borderRadius: 14,
                overflow: 'hidden',
                position: 'relative',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                background: '#070b14',
              }}
            >
              <VehicleViewer3D
                onLoadState={(id, state) => setReadyId(state === 'ready' ? id : null)}
                vehicleId={selectedId}
                activeHotspotId={assetRecord.calibratedMetres ? activeHotspotId : null}
                scaleMode={assetRecord.calibratedMetres ? scaleMode : 'framed'}
                lightingMode={lightingMode}
              />

              {/* 视角与光照模式切换浮窗 */}
              <div
                style={{
                  position: 'absolute',
                  top: 12,
                  right: 12,
                  display: 'flex',
                  gap: 6,
                }}
              >
                {/* 光照切换按钮 */}
                <div
                  style={{
                    display: 'flex',
                    background: 'rgba(15, 23, 42, 0.85)',
                    backdropFilter: 'blur(8px)',
                    padding: 3,
                    borderRadius: 8,
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                  }}
                >
                  <button
                    data-testid="hangar-light-toggle-btn"
                    onClick={() => setLightingMode(lightingMode === 'studio' ? 'orbit' : 'studio')}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '4px 8px',
                      borderRadius: 6,
                      border: 'none',
                      background: lightingMode === 'orbit' ? '#eab308' : '#0284c7',
                      color: lightingMode === 'orbit' ? '#000' : '#fff',
                      cursor: 'pointer',
                      fontSize: 11,
                      fontWeight: 600,
                    }}
                    title="在中性工坊白光与在轨日光高反差之间切换"
                  >
                    {lightingMode === 'studio' ? <Lightbulb size={12} /> : <Sun size={12} />}
                    <span>{lightingMode === 'studio' ? '工坊光' : '在轨日光'}</span>
                  </button>
                </div>

                {/* 构图比例切换 */}
                {assetRecord.calibratedMetres && <div
                  style={{
                    display: 'flex',
                    background: 'rgba(15, 23, 42, 0.85)',
                    backdropFilter: 'blur(8px)',
                    padding: 3,
                    borderRadius: 8,
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                  }}
                >
                  <button
                    data-testid="hangar-scale-toggle-btn"
                    onClick={() => setScaleMode(scaleMode === 'framed' ? 'metric' : 'framed')}
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
                    title="在最佳构图与 1:1 米制对比网格间切换"
                  >
                    {scaleMode === 'framed' ? <Eye size={12} /> : <Ruler size={12} />}
                    <span>{scaleMode === 'framed' ? '最佳构图' : '1:1 标尺'}</span>
                  </button>
                </div>}
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
                鼠标或手指拖拽 · 360° 查看
              </div>
            </div>

            {/* 模型资产来源与出处证书条目 */}
            {assetRecord && (
              <div
                data-testid="hangar-provenance-badge"
                style={{
                  marginTop: 10,
                  background: 'rgba(56, 189, 248, 0.08)',
                  padding: '8px 12px',
                  borderRadius: 10,
                  border: '1px solid rgba(56, 189, 248, 0.2)',
                  fontSize: 11,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  color: '#94a3b8',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <ShieldCheck size={14} color="#38bdf8" />
                  <span>
                    资产出处: <strong style={{ color: '#e2e8f0' }}>{assetRecord.source}</strong>
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#4ade80' }}>
                  <CheckCircle2 size={12} />
                  <span>{assetRecord.license}</span>
                </div>
              </div>
            )}

            {/* 真实米制物理尺寸对比标尺卡片 */}
            <div
              style={{
                marginTop: 10,
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
                  <span>航天器参考尺寸</span>
                </div>
                {def.massKg!==undefined && <div style={{ color: '#94a3b8', fontSize: 11 }}>
                  参考质量: <strong style={{ color: '#e2e8f0' }}>{(def.massKg / 1000).toFixed(1)} 吨</strong>
                </div>}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, textAlign: 'center' }}>
                <div style={{ background: 'rgba(255,255,255,0.03)', padding: '6px 8px', borderRadius: 8 }}>
                  <div style={{ fontSize: 10, color: '#64748b' }}>长度 / 跨度</div>
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
            </div>
            <div style={{fontSize:11,color:'#94a3b8',marginTop:8,lineHeight:1.5}}>
              {def.dimensionsNote ?? '参考资料尺寸；模型按构图展示，不用作测量标尺。'}
            </div>
          </div>

          {/* 右栏：详细档案、结构热点揭秘与操作按钮 */}
          <div
            style={{
              flex: 0.95,
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

            {/* Uncalibrated source assemblies cannot use legacy metre hotspot coordinates. */}
            {assetRecord.calibratedMetres && <div>
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
                        border: isActive ? '1px solid #38bdf8' : '1px solid rgba(255, 255, 255, 0.1)',
                        background: isActive ? 'rgba(56, 189, 248, 0.25)' : 'rgba(255, 255, 255, 0.04)',
                        color: isActive ? '#ffffff' : '#94a3b8',
                        fontSize: 11,
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      {hs.name}
                    </button>
                  );
                })}
              </div>

              {/* 展开当前选中的热点科普详情 */}
              {activeHotspotId && (() => {
                const cur = def.hotspots.find((h) => h.id === activeHotspotId);
                if (!cur) return null;
                return (
                  <div
                    style={{
                      marginTop: 10,
                      background: 'rgba(15, 23, 42, 0.6)',
                      padding: 12,
                      borderRadius: 10,
                      border: '1px solid rgba(56, 189, 248, 0.2)',
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#38bdf8', marginBottom: 4 }}>
                      🔍 {cur.name}
                    </div>
                    <div style={{ fontSize: 11, color: '#e2e8f0', lineHeight: 1.5, marginBottom: 6 }}>
                      {cur.kidTip}
                    </div>
                    <div style={{ fontSize: 10, color: '#94a3b8', lineHeight: 1.4, borderTop: '1px dashed rgba(255,255,255,0.1)', paddingTop: 6 }}>
                      🔬 <strong>工程细节：</strong>{cur.scienceDetail}
                    </div>
                  </div>
                );
              })()}
            </div>

            }
            {/* 详细历史档案与科学成就 */}
            <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.6 }}>
              <div style={{ fontWeight: 600, color: '#cbd5e1', marginBottom: 4 }}>📖 任务档案与科学成就：</div>
              <p style={{ margin: 0 }}>{def.description}</p>
              <div style={{ marginTop: 8, color: '#38bdf8', fontSize: 11 }}>
                🏆 <strong>历史里程碑：</strong> {def.keyMilestone}
              </div>
            </div>

            {/* 底部行动按钮栏 */}
            <div style={{ marginTop: 'auto', paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                data-testid="hangar-board-btn"
                disabled={!canBoard}
                onClick={handleBoard}
                style={{
                  width: '100%',
                  padding: '13px 0',
                  background: canBoard ? 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)' : '#263445',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: 12,
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: canBoard ? 'pointer' : 'not-allowed',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  boxShadow: canBoard ? '0 4px 20px rgba(2, 132, 199, 0.45)' : 'none',
                  transition: 'transform 0.15s, box-shadow 0.15s',
                }}
              >
                <Rocket size={16} />
                <span>{canBoard ? '开始伴飞' : '模型就绪后可开始伴飞'}</span>
              </button>

              {(currentVehicleId || pendingVehicleId) && onClearVehicle && (
                <button
                  data-testid="hangar-clear-vehicle-btn"
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
                  <span>{pendingVehicleId ? '取消伴飞准备' : '结束伴飞 · 移除航天器 (Clear Vehicle)'}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
