import React, { useEffect, useRef, useState } from 'react';
import { SolarEngine, WebGLDiagnosticInfo } from '../engine/SolarEngine';
import { BODIES } from '../astronomy/bodies';
import type { BodyId } from '../contracts/body';
import type { CameraStateSnapshot } from '../contracts/camera';
import {
  Play,
  Pause,
  Compass,
  Eye,
  ShieldCheck,
  Info,
  Cloud,
  Sun,
  Sparkles,
  Layers,
} from 'lucide-react';

export const App: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<SolarEngine | null>(null);

  const [selectedBodyId, setSelectedBodyId] = useState<BodyId>('earth');
  const [cameraSnapshot, setCameraSnapshot] = useState<CameraStateSnapshot | null>(null);
  const [webglInfo, setWebglInfo] = useState<WebGLDiagnosticInfo | null>(null);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [timeScale, setTimeScale] = useState<number>(1.0);
  const [showDetails, setShowDetails] = useState<boolean>(false);

  // M1 图层与观察模式开关
  const [showClouds, setShowClouds] = useState<boolean>(true);
  const [teachingLight, setTeachingLight] = useState<boolean>(false);
  const [showAtmosphere, setShowAtmosphere] = useState<boolean>(true);

  useEffect(() => {
    if (!containerRef.current) return;

    try {
      const engine = new SolarEngine(containerRef.current, {
        onSelectBody: (id) => setSelectedBodyId(id),
        onCameraSnapshot: (snap) => setCameraSnapshot(snap),
        onWebGLInfo: (info) => setWebglInfo(info),
      });

      engineRef.current = engine;

      return () => {
        engine.dispose();
        engineRef.current = null;
      };
    } catch (err: any) {
      console.error('Failed to initialize SolarEngine:', err);
    }
  }, []);

  const handleSelect = (id: BodyId) => {
    setSelectedBodyId(id);
    engineRef.current?.executeCameraCommand({ type: 'select', bodyId: id });
  };

  const handleFlyTo = (id: BodyId) => {
    setSelectedBodyId(id);
    engineRef.current?.executeCameraCommand({ type: 'flyTo', bodyId: id });
  };

  const handleOverview = () => {
    engineRef.current?.executeCameraCommand({ type: 'overview' });
  };

  const togglePause = () => {
    const next = !isPaused;
    setIsPaused(next);
    engineRef.current?.setPaused(next);
  };

  const changeSpeed = (scale: number) => {
    setTimeScale(scale);
    engineRef.current?.setTimeScale(scale);
  };

  const toggleClouds = () => {
    const next = !showClouds;
    setShowClouds(next);
    engineRef.current?.setShowClouds(next);
  };

  const toggleTeachingLight = () => {
    const next = !teachingLight;
    setTeachingLight(next);
    engineRef.current?.setTeachingLight(next);
  };

  const toggleAtmosphere = () => {
    const next = !showAtmosphere;
    setShowAtmosphere(next);
    engineRef.current?.setShowAtmosphere(next);
  };

  const activeBody = BODIES[selectedBodyId] || BODIES.earth;

  return (
    <div
      style={{
        position: 'relative',
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        backgroundColor: '#020408',
        color: '#f0f4f8',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      {/* 3D 渲染画布容器 */}
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {/* 顶部标题栏 */}
      <header
        style={{
          position: 'absolute',
          top: 16,
          left: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          background: 'rgba(10, 16, 26, 0.82)',
          backdropFilter: 'blur(12px)',
          padding: '10px 16px',
          borderRadius: 14,
          border: '1px solid rgba(255, 255, 255, 0.12)',
          boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
          zIndex: 10,
        }}
      >
        <Compass size={22} color="#38bdf8" />
        <div>
          <h1 style={{ margin: 0, fontSize: 15, fontWeight: 700, letterSpacing: '0.04em' }}>
            太阳系漫游 · 地月探索
          </h1>
          <div style={{ fontSize: 11, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                display: 'inline-block',
                width: 6,
                height: 6,
                borderRadius: '50%',
                backgroundColor: '#22c55e',
              }}
            />
            <span>M1 完整视觉：昼夜晨昏线 · 城市夜灯 · 动态云层 · 深空星图</span>
          </div>
        </div>
      </header>

      {/* 右上角 WebGL2 硬件与环境诊断卡片 */}
      <div
        style={{
          position: 'absolute',
          top: 16,
          right: 16,
          background: 'rgba(10, 16, 26, 0.82)',
          backdropFilter: 'blur(12px)',
          padding: '10px 14px',
          borderRadius: 12,
          border: '1px solid rgba(255, 255, 255, 0.1)',
          fontSize: 11,
          lineHeight: 1.5,
          color: '#94a3b8',
          maxWidth: 270,
          zIndex: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#38bdf8', fontWeight: 600, marginBottom: 4 }}>
          <ShieldCheck size={14} />
          <span>WebGL2 渲染与显卡状态</span>
        </div>
        {webglInfo ? (
          <div>
            <div>渲染器: <strong style={{ color: '#e2e8f0' }}>{webglInfo.rendererName}</strong></div>
            <div>显卡厂商: {webglInfo.vendorName}</div>
            <div>最大纹理尺寸: {webglInfo.maxTextureSize} px</div>
          </div>
        ) : (
          <div>正在检测 WebGL2 硬件环境...</div>
        )}
      </div>

      {/* 左侧目的地选择栏 */}
      <nav
        style={{
          position: 'absolute',
          left: 16,
          top: '50%',
          transform: 'translateY(-50%)',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          zIndex: 10,
        }}
      >
        <button
          onClick={() => handleSelect('earth')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 18px',
            background: selectedBodyId === 'earth' ? 'rgba(56, 189, 248, 0.25)' : 'rgba(15, 23, 42, 0.65)',
            border: selectedBodyId === 'earth' ? '1.5px solid #38bdf8' : '1px solid rgba(255,255,255,0.1)',
            borderRadius: 12,
            color: '#fff',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: selectedBodyId === 'earth' ? 600 : 400,
            backdropFilter: 'blur(8px)',
            transition: 'all 0.2s',
          }}
        >
          <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: '#38bdf8', boxShadow: '0 0 8px #38bdf8' }} />
          <span>地球 Earth</span>
        </button>

        <button
          onClick={() => handleSelect('moon')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 18px',
            background: selectedBodyId === 'moon' ? 'rgba(56, 189, 248, 0.25)' : 'rgba(15, 23, 42, 0.65)',
            border: selectedBodyId === 'moon' ? '1.5px solid #38bdf8' : '1px solid rgba(255,255,255,0.1)',
            borderRadius: 12,
            color: '#fff',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: selectedBodyId === 'moon' ? 600 : 400,
            backdropFilter: 'blur(8px)',
            transition: 'all 0.2s',
          }}
        >
          <div style={{ width: 9, height: 9, borderRadius: '50%', backgroundColor: '#cbd5e1', boxShadow: '0 0 6px #cbd5e1' }} />
          <span>月球 Moon</span>
        </button>

        <button
          onClick={handleOverview}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 18px',
            background: 'rgba(15, 23, 42, 0.65)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 12,
            color: '#94a3b8',
            cursor: 'pointer',
            fontSize: 13,
            backdropFilter: 'blur(8px)',
            transition: 'all 0.2s',
          }}
        >
          <Eye size={14} />
          <span>地月全景</span>
        </button>

        {/* M1 探索图层工具栏（仅在查看地球时特别实用） */}
        {selectedBodyId === 'earth' && (
          <div
            style={{
              marginTop: 8,
              padding: '10px 12px',
              background: 'rgba(10, 16, 26, 0.75)',
              backdropFilter: 'blur(10px)',
              borderRadius: 12,
              border: '1px solid rgba(255, 255, 255, 0.08)',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <div style={{ fontSize: 10, color: '#64748b', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
              <Layers size={11} />
              <span>地球观察图层</span>
            </div>

            <button
              onClick={toggleClouds}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: showClouds ? 'rgba(56, 189, 248, 0.2)' : 'transparent',
                border: showClouds ? '1px solid rgba(56, 189, 248, 0.4)' : '1px solid rgba(255,255,255,0.06)',
                color: showClouds ? '#e2e8f0' : '#64748b',
                padding: '5px 8px',
                borderRadius: 6,
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              <Cloud size={12} />
              <span>云层 ({showClouds ? '已开启' : '隐藏'})</span>
            </button>

            <button
              onClick={toggleTeachingLight}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: teachingLight ? 'rgba(234, 179, 8, 0.2)' : 'transparent',
                border: teachingLight ? '1px solid rgba(234, 179, 8, 0.4)' : '1px solid rgba(255,255,255,0.06)',
                color: teachingLight ? '#fde047' : '#64748b',
                padding: '5px 8px',
                borderRadius: 6,
                fontSize: 11,
                cursor: 'pointer',
              }}
              title="微量照亮黑夜面，方便看清大陆轮廓"
            >
              <Sun size={12} />
              <span>教学提亮 ({teachingLight ? '开' : '关'})</span>
            </button>

            <button
              onClick={toggleAtmosphere}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: showAtmosphere ? 'rgba(56, 189, 248, 0.2)' : 'transparent',
                border: showAtmosphere ? '1px solid rgba(56, 189, 248, 0.4)' : '1px solid rgba(255,255,255,0.06)',
                color: showAtmosphere ? '#e2e8f0' : '#64748b',
                padding: '5px 8px',
                borderRadius: 6,
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              <Sparkles size={12} />
              <span>大气微光 ({showAtmosphere ? '开' : '关'})</span>
            </button>
          </div>
        )}
      </nav>

      {/* 核心观察卡片（右下角） */}
      <aside
        style={{
          position: 'absolute',
          right: 16,
          bottom: 74,
          width: 320,
          background: 'rgba(10, 16, 26, 0.88)',
          backdropFilter: 'blur(16px)',
          padding: '16px 20px',
          borderRadius: 16,
          border: '1px solid rgba(255, 255, 255, 0.12)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.65)',
          zIndex: 10,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#f8fafc' }}>{activeBody.name}</h2>
            <span style={{ fontSize: 12, color: '#64748b' }}>{activeBody.nameEn}</span>
          </div>
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
            真实观测贴图
          </span>
        </div>

        {/* 亲子观察提示：给孩子的一句话 */}
        <div
          style={{
            background: 'rgba(30, 41, 59, 0.65)',
            borderLeft: '3px solid #38bdf8',
            padding: '8px 12px',
            borderRadius: 6,
            fontSize: 12,
            lineHeight: 1.5,
            color: '#e2e8f0',
            marginBottom: 12,
          }}
        >
          💡 <strong>观察发现：</strong>{activeBody.observationTip}
        </div>

        {/* 飞往这里按钮（主动操作触发飞行） */}
        <button
          onClick={() => handleFlyTo(activeBody.id)}
          style={{
            width: '100%',
            padding: '11px 0',
            backgroundColor: '#0284c7',
            color: '#ffffff',
            border: 'none',
            borderRadius: 10,
            fontWeight: 600,
            fontSize: 13,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            boxShadow: '0 2px 14px rgba(2, 132, 199, 0.45)',
            transition: 'background-color 0.2s',
          }}
        >
          <span>飞往这里 (Fly To)</span>
        </button>

        {/* 家长可展开的科学数据与来源 */}
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <button
            onClick={() => setShowDetails(!showDetails)}
            style={{
              background: 'none',
              border: 'none',
              color: '#94a3b8',
              fontSize: 11,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: 0,
            }}
          >
            <Info size={12} />
            <span>{showDetails ? '收起科学来源' : '展开科学数据与来源'}</span>
          </button>

          {showDetails && (
            <div style={{ marginTop: 8, fontSize: 11, color: '#94a3b8', lineHeight: 1.6 }}>
              <div>平均物理半径: <span style={{ color: '#e2e8f0' }}>{activeBody.radiusKm.toLocaleString()} km</span></div>
              <div>自转周期: <span style={{ color: '#e2e8f0' }}>{activeBody.rotationPeriodHours} 小时</span></div>
              <div>公转周期: <span style={{ color: '#e2e8f0' }}>{activeBody.orbitPeriodDays} 天</span></div>
              <div>数据与贴图来源: <span style={{ color: '#38bdf8' }}>{activeBody.sourceRef}</span></div>
              <p style={{ margin: '6px 0 0 0', color: '#cbd5e1', fontSize: 11 }}>{activeBody.description}</p>
            </div>
          )}
        </div>
      </aside>

      {/* 底部控制工具栏 */}
      <footer
        style={{
          position: 'absolute',
          bottom: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          background: 'rgba(10, 16, 26, 0.85)',
          backdropFilter: 'blur(12px)',
          padding: '8px 22px',
          borderRadius: 30,
          border: '1px solid rgba(255, 255, 255, 0.12)',
          fontSize: 12,
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
          zIndex: 10,
        }}
      >
        <button
          onClick={togglePause}
          style={{
            background: isPaused ? '#ef4444' : '#10b981',
            color: '#fff',
            border: 'none',
            borderRadius: '50%',
            width: 28,
            height: 28,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
          title={isPaused ? '继续时间' : '暂停时间'}
        >
          {isPaused ? <Play size={14} /> : <Pause size={14} />}
        </button>

        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ color: '#64748b' }}>倍速:</span>
          {[0.5, 1, 5, 20].map((speed) => (
            <button
              key={speed}
              onClick={() => changeSpeed(speed)}
              style={{
                background: timeScale === speed ? 'rgba(56, 189, 248, 0.35)' : 'transparent',
                color: timeScale === speed ? '#38bdf8' : '#94a3b8',
                border: 'none',
                borderRadius: 4,
                padding: '2px 6px',
                cursor: 'pointer',
                fontSize: 11,
              }}
            >
              {speed}x
            </button>
          ))}
        </div>

        <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.1)' }} />

        <div style={{ color: '#64748b', fontSize: 11 }}>
          相机模式: <strong style={{ color: '#e2e8f0' }}>{cameraSnapshot?.mode || 'ORBIT_TARGET'}</strong>
          {cameraSnapshot?.isTransitioning && <span style={{ color: '#38bdf8', marginLeft: 6 }}>平滑飞行中...</span>}
        </div>
      </footer>
    </div>
  );
};
