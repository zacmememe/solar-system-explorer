import React, { useEffect, useRef, useState } from 'react';
import { SolarEngine, WebGLDiagnosticInfo } from '../engine/SolarEngine';
import { BODIES } from '../astronomy/bodies';
import type { BodyId } from '../contracts/body';
import type { CameraStateSnapshot } from '../contracts/camera';
import type { VehicleId, ViewCameraMode } from '../contracts/vehicle';
import { VEHICLE_CATALOG } from '../vehicles/VehicleCatalog';
import { HangarModal } from '../vehicles/HangarModal';
import { PostcardModal } from '../vehicles/PostcardModal';
import { generateDiscoveryPostcard } from '../utils/postcard';
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
  CircleDot,
  Radio,
  Rocket,
  Camera,
  Navigation,
} from 'lucide-react';

const PLANET_ORDER: BodyId[] = [
  'sun',
  'mercury',
  'venus',
  'earth',
  'mars',
  'jupiter',
  'saturn',
  'uranus',
  'neptune',
];

const PLANET_MOONS: Record<string, BodyId[]> = {
  earth: ['moon'],
  mars: ['phobos', 'deimos'],
  jupiter: ['io', 'europa', 'ganymede', 'callisto'],
  saturn: ['titan', 'enceladus'],
};

export const App: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<SolarEngine | null>(null);

  const [selectedBodyId, setSelectedBodyId] = useState<BodyId>('sun');
  const [cameraSnapshot, setCameraSnapshot] = useState<CameraStateSnapshot | null>(null);
  const [webglInfo, setWebglInfo] = useState<WebGLDiagnosticInfo | null>(null);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [timeScale, setTimeScale] = useState<number>(50.0); // 太阳系行星默认 50x 便于观察公转动态
  const [showDetails, setShowDetails] = useState<boolean>(false);

  // 观察模式开关
  const [showClouds, setShowClouds] = useState<boolean>(true);
  const [teachingLight, setTeachingLight] = useState<boolean>(false);
  const [showAtmosphere, setShowAtmosphere] = useState<boolean>(true);
  const [showOrbits, setShowOrbits] = useState<boolean>(true);
  const [venusRadarMode, setVenusRadarMode] = useState<boolean>(false);

  // 载具与伴飞视角系统
  const [currentVehicleId, setCurrentVehicleId] = useState<VehicleId | null>('apollo-lm');
  const [viewCameraMode, setViewCameraMode] = useState<ViewCameraMode>('VEHICLE_FORMATION');
  const [showHangar, setShowHangar] = useState<boolean>(false);

  // 探索明信片系统
  const [showPostcardModal, setShowPostcardModal] = useState<boolean>(false);
  const [postcardDataUrl, setPostcardDataUrl] = useState<string>('');
  const [isGeneratingPostcard, setIsGeneratingPostcard] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    try {
      const engine = new SolarEngine(containerRef.current, {
        onSelectBody: (id) => setSelectedBodyId(id),
        onCameraSnapshot: (snap) => setCameraSnapshot(snap),
        onWebGLInfo: (info) => setWebglInfo(info),
      });

      engineRef.current = engine;
      engine.setTimeScale(50.0);

      return () => {
        engine.dispose();
        engineRef.current = null;
      };
    } catch (err: any) {
      console.error('Failed to initialize SolarEngine:', err);
    }
  }, []);

  const handleFlyTo = (id: BodyId) => {
    setSelectedBodyId(id);
    engineRef.current?.executeCameraCommand({ type: 'flyTo', bodyId: id });
  };

  const handleOverview = () => {
    setSelectedBodyId('sun');
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

  const toggleOrbits = () => {
    const next = !showOrbits;
    setShowOrbits(next);
    engineRef.current?.setShowOrbits(next);
  };

  const toggleVenusRadar = () => {
    const next = !venusRadarMode;
    setVenusRadarMode(next);
    engineRef.current?.setShowVenusSurface(next);
  };

  const handleSelectVehicle = (id: VehicleId) => {
    setCurrentVehicleId(id);
    engineRef.current?.setVehicle(id);
    engineRef.current?.setViewCameraMode('VEHICLE_FORMATION');
    setViewCameraMode('VEHICLE_FORMATION');
    const vDef = VEHICLE_CATALOG[id];
    showToast(`🚀 已登船：${vDef.name}，正在伴飞！`);
  };

  const handleCameraModeChange = (mode: ViewCameraMode) => {
    setViewCameraMode(mode);
    engineRef.current?.setViewCameraMode(mode);
  };

  const handleGeneratePostcard = async () => {
    engineRef.current?.renderImmediate();
    const canvas = engineRef.current?.getRendererCanvas();
    if (!canvas) return;
    setIsGeneratingPostcard(true);
    try {
      const vDef = currentVehicleId ? VEHICLE_CATALOG[currentVehicleId] : undefined;
      const url = await generateDiscoveryPostcard({
        sourceCanvas: canvas,
        bodyName: activeBody.name,
        bodyNameEn: activeBody.nameEn,
        bodyType: activeBody.type === 'star' ? '恒星 Star' : activeBody.type === 'planet' ? '大行星 Planet' : '卫星 Moon',
        vehicleName: vDef ? vDef.name : undefined,
        vehicleAgency: vDef ? vDef.agency : undefined,
        observationTip: activeBody.observationTip,
        funFact: activeBody.funFact,
        sourceRef: activeBody.sourceRef,
      });
      setPostcardDataUrl(url);
      setShowPostcardModal(true);
    } catch (err) {
      console.error('Failed to generate postcard:', err);
    } finally {
      setIsGeneratingPostcard(false);
    }
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const activeBody = BODIES[selectedBodyId] || BODIES.sun;
  const currentMoons = PLANET_MOONS[activeBody.parentId ? activeBody.parentId : activeBody.id] || [];
  const activeVehicle = currentVehicleId ? VEHICLE_CATALOG[currentVehicleId] : null;

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

      {/* 顶部标题栏与机库入口 */}
      <header
        style={{
          position: 'absolute',
          top: 14,
          left: 14,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          background: 'rgba(10, 16, 26, 0.88)',
          backdropFilter: 'blur(16px)',
          padding: '8px 16px',
          borderRadius: 16,
          border: '1px solid rgba(255, 255, 255, 0.12)',
          boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
          zIndex: 10,
        }}
      >
        <Compass size={22} color="#38bdf8" />
        <div>
          <h1 style={{ margin: 0, fontSize: 15, fontWeight: 700, letterSpacing: '0.04em' }}>
            太阳系漫游 · 亲子探索
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
            <span>太阳 · 八大行星 · 土星环 · 核心卫星</span>
          </div>
        </div>

        <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.15)', margin: '0 4px' }} />

        {/* 航天器机库入口按钮 */}
        <button
          onClick={() => setShowHangar(true)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 12px',
            borderRadius: 10,
            background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.25) 0%, rgba(3, 105, 161, 0.45) 100%)',
            border: '1px solid rgba(56, 189, 248, 0.45)',
            color: '#ffffff',
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 600,
            boxShadow: '0 2px 10px rgba(56, 189, 248, 0.25)',
          }}
          title="打开航天器机库选择搭乘载具"
        >
          <Rocket size={14} color="#38bdf8" />
          <span>机库 Hangar</span>
          <span
            style={{
              fontSize: 10,
              padding: '1px 6px',
              borderRadius: 4,
              backgroundColor: 'rgba(234, 179, 8, 0.25)',
              color: '#fde047',
              border: '1px solid rgba(234, 179, 8, 0.4)',
            }}
          >
            {activeVehicle ? activeVehicle.name : '未登船'}
          </span>
        </button>
      </header>

      {/* 右上角 WebGL2 硬件与环境诊断卡片 */}
      <div
        style={{
          position: 'absolute',
          top: 14,
          right: 14,
          background: 'rgba(10, 16, 26, 0.85)',
          backdropFilter: 'blur(12px)',
          padding: '8px 12px',
          borderRadius: 12,
          border: '1px solid rgba(255, 255, 255, 0.1)',
          fontSize: 11,
          lineHeight: 1.45,
          color: '#94a3b8',
          maxWidth: 250,
          zIndex: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#38bdf8', fontWeight: 600, marginBottom: 3 }}>
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

      {/* 顶部中央：太阳系全景行星快速导航条 */}
      <nav
        style={{
          position: 'absolute',
          top: 14,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: 'rgba(10, 16, 26, 0.88)',
          backdropFilter: 'blur(16px)',
          padding: '6px 10px',
          borderRadius: 30,
          border: '1px solid rgba(255, 255, 255, 0.12)',
          boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
          maxWidth: '92vw',
          overflowX: 'auto',
          zIndex: 10,
        }}
      >
        <button
          onClick={handleOverview}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: '5px 12px',
            background: cameraSnapshot?.mode === 'TRANSITION' && selectedBodyId === 'sun'
              ? 'rgba(56, 189, 248, 0.3)'
              : 'rgba(255, 255, 255, 0.05)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: 20,
            color: '#38bdf8',
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 600,
            whiteSpace: 'nowrap',
          }}
          title="俯瞰整个太阳系全景"
        >
          <Eye size={13} />
          <span>全景 Overview</span>
        </button>

        <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.15)', margin: '0 2px' }} />

        {PLANET_ORDER.map((id) => {
          const body = BODIES[id];
          if (!body) return null;
          const isSelected = selectedBodyId === id || (activeBody.parentId === id);

          return (
            <button
              key={id}
              onClick={() => handleFlyTo(id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '5px 10px',
                background: isSelected ? 'rgba(56, 189, 248, 0.28)' : 'transparent',
                border: isSelected ? '1px solid #38bdf8' : '1px solid transparent',
                borderRadius: 18,
                color: isSelected ? '#ffffff' : '#cbd5e1',
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
                  backgroundColor: body.colorHex ? `#${body.colorHex.toString(16).padStart(6, '0')}` : '#fff',
                  boxShadow: isSelected ? '0 0 8px #38bdf8' : 'none',
                }}
              />
              <span>{body.name}</span>
            </button>
          );
        })}
      </nav>

      {/* 卫星次级选择悬浮条（当前行星有卫星时展现） */}
      {currentMoons.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: 66,
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: 'rgba(15, 23, 42, 0.85)',
            backdropFilter: 'blur(12px)',
            padding: '4px 12px',
            borderRadius: 20,
            border: '1px solid rgba(255, 255, 255, 0.08)',
            zIndex: 10,
          }}
        >
          <span style={{ fontSize: 10, color: '#94a3b8', marginRight: 4 }}>🛰️ 卫星:</span>
          {currentMoons.map((satId) => {
            const sat = BODIES[satId];
            if (!sat) return null;
            const isSelected = selectedBodyId === satId;

            return (
              <button
                key={satId}
                onClick={() => handleFlyTo(satId)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '3px 8px',
                  background: isSelected ? 'rgba(56, 189, 248, 0.35)' : 'rgba(255, 255, 255, 0.05)',
                  border: isSelected ? '1px solid #38bdf8' : '1px solid transparent',
                  borderRadius: 12,
                  color: isSelected ? '#ffffff' : '#94a3b8',
                  fontSize: 11,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                <span>{sat.name}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* 左侧探索工具栏（图层与观察辅助开关） */}
      <nav
        style={{
          position: 'absolute',
          left: 16,
          top: '50%',
          transform: 'translateY(-50%)',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          background: 'rgba(10, 16, 26, 0.85)',
          backdropFilter: 'blur(16px)',
          padding: '12px 14px',
          borderRadius: 16,
          border: '1px solid rgba(255, 255, 255, 0.12)',
          boxShadow: '0 6px 24px rgba(0,0,0,0.5)',
          zIndex: 10,
        }}
      >
        <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <Navigation size={13} color="#38bdf8" />
          <span>飞行视角模式</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 4 }}>
          <button
            onClick={() => handleCameraModeChange('PLANET_OBSERVE')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 10px',
              background: viewCameraMode === 'PLANET_OBSERVE' ? 'rgba(56, 189, 248, 0.25)' : 'transparent',
              border: viewCameraMode === 'PLANET_OBSERVE' ? '1px solid #38bdf8' : '1px solid rgba(255,255,255,0.06)',
              borderRadius: 8,
              color: viewCameraMode === 'PLANET_OBSERVE' ? '#ffffff' : '#94a3b8',
              cursor: 'pointer',
              fontSize: 11,
            }}
            title="自由环绕观察当前天体全景"
          >
            <Eye size={13} />
            <span>行星全景 (Planet)</span>
          </button>

          <button
            onClick={() => handleCameraModeChange('VEHICLE_FORMATION')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 10px',
              background: viewCameraMode === 'VEHICLE_FORMATION' ? 'rgba(234, 179, 8, 0.25)' : 'transparent',
              border: viewCameraMode === 'VEHICLE_FORMATION' ? '1px solid #eab308' : '1px solid rgba(255,255,255,0.06)',
              color: viewCameraMode === 'VEHICLE_FORMATION' ? '#fef08a' : '#94a3b8',
              cursor: 'pointer',
              fontSize: 11,
            }}
            title="飞船在前景右侧伴飞观察"
          >
            <Rocket size={13} />
            <span>伴飞视角 (Formation)</span>
          </button>

          <button
            onClick={() => handleCameraModeChange('VEHICLE_ONBOARD')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 10px',
              background: viewCameraMode === 'VEHICLE_ONBOARD' ? 'rgba(34, 197, 94, 0.25)' : 'transparent',
              border: viewCameraMode === 'VEHICLE_ONBOARD' ? '1px solid #22c55e' : '1px solid rgba(255,255,255,0.06)',
              color: viewCameraMode === 'VEHICLE_ONBOARD' ? '#86efac' : '#94a3b8',
              cursor: 'pointer',
              fontSize: 11,
            }}
            title="第一人称俯瞰随船视角"
          >
            <Compass size={13} />
            <span>随船视角 (Onboard)</span>
          </button>
        </div>

        <div style={{ width: '100%', height: 1, background: 'rgba(255,255,255,0.08)', margin: '3px 0' }} />

        <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, margin: '2px 0' }}>
          <Layers size={13} color="#38bdf8" />
          <span>观测图层与工具</span>
        </div>

        <button
          onClick={toggleOrbits}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 10px',
            background: showOrbits ? 'rgba(56, 189, 248, 0.2)' : 'transparent',
            border: showOrbits ? '1px solid rgba(56, 189, 248, 0.4)' : '1px solid rgba(255,255,255,0.06)',
            borderRadius: 8,
            color: showOrbits ? '#e2e8f0' : '#64748b',
            cursor: 'pointer',
            fontSize: 11,
          }}
          title="开启或关闭行星公转轨道线"
        >
          <CircleDot size={13} />
          <span>公转轨道 ({showOrbits ? '显示' : '隐藏'})</span>
        </button>

        <button
          onClick={toggleTeachingLight}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 10px',
            background: teachingLight ? 'rgba(234, 179, 8, 0.2)' : 'transparent',
            border: teachingLight ? '1px solid rgba(234, 179, 8, 0.4)' : '1px solid rgba(255,255,255,0.06)',
            color: teachingLight ? '#fde047' : '#64748b',
            borderRadius: 8,
            cursor: 'pointer',
            fontSize: 11,
          }}
          title="微量照亮背阴暗部，方便孩子辨识背面地形"
        >
          <Sun size={13} />
          <span>教学补光 ({teachingLight ? '开' : '关'})</span>
        </button>

        <button
          onClick={toggleClouds}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 10px',
            background: showClouds ? 'rgba(56, 189, 248, 0.2)' : 'transparent',
            border: showClouds ? '1px solid rgba(56, 189, 248, 0.4)' : '1px solid rgba(255,255,255,0.06)',
            color: showClouds ? '#e2e8f0' : '#64748b',
            borderRadius: 8,
            cursor: 'pointer',
            fontSize: 11,
          }}
          title="切换地球云层"
        >
          <Cloud size={13} />
          <span>大气云层 ({showClouds ? '开' : '关'})</span>
        </button>

        <button
          onClick={toggleAtmosphere}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 10px',
            background: showAtmosphere ? 'rgba(56, 189, 248, 0.2)' : 'transparent',
            border: showAtmosphere ? '1px solid rgba(56, 189, 248, 0.4)' : '1px solid rgba(255,255,255,0.06)',
            color: showAtmosphere ? '#e2e8f0' : '#64748b',
            borderRadius: 8,
            cursor: 'pointer',
            fontSize: 11,
          }}
        >
          <Sparkles size={13} />
          <span>边缘微光 ({showAtmosphere ? '开' : '关'})</span>
        </button>

        {/* 金星雷达地表穿透模式切换 */}
        {selectedBodyId === 'venus' && (
          <button
            onClick={toggleVenusRadar}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 10px',
              background: venusRadarMode ? 'rgba(249, 115, 22, 0.25)' : 'rgba(255, 255, 255, 0.05)',
              border: venusRadarMode ? '1px solid #f97316' : '1px solid rgba(255,255,255,0.08)',
              borderRadius: 8,
              color: venusRadarMode ? '#fb923c' : '#94a3b8',
              cursor: 'pointer',
              fontSize: 11,
            }}
          >
            <Radio size={13} />
            <span>雷达穿透地表 ({venusRadarMode ? '开' : '关'})</span>
          </button>
        )}

        <div style={{ width: '100%', height: 1, background: 'rgba(255,255,255,0.08)', margin: '3px 0' }} />

        {/* 记录发现 / 生成探索明信片按钮 */}
        <button
          onClick={handleGeneratePostcard}
          disabled={isGeneratingPostcard}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 10px',
            background: 'linear-gradient(135deg, rgba(2, 132, 199, 0.3) 0%, rgba(14, 165, 233, 0.45) 100%)',
            border: '1px solid rgba(56, 189, 248, 0.5)',
            color: '#38bdf8',
            borderRadius: 8,
            cursor: isGeneratingPostcard ? 'wait' : 'pointer',
            fontSize: 11,
            fontWeight: 600,
            boxShadow: '0 2px 8px rgba(56, 189, 248, 0.2)',
          }}
          title="将当前 3D 观测画面合成为专属探索明信片并可保存下载"
        >
          <Camera size={14} />
          <span>{isGeneratingPostcard ? '正在截帧中...' : '记录发现 · 探索明信片'}</span>
        </button>
      </nav>

      {/* 核心亲子观察卡片（右下角） */}
      <aside
        style={{
          position: 'absolute',
          right: 16,
          bottom: 74,
          width: 330,
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
            {activeBody.type === 'star' ? '恒星 Star' : activeBody.type === 'planet' ? '大行星 Planet' : '卫星 Moon'}
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
            marginBottom: 8,
          }}
        >
          💡 <strong>观察发现：</strong>{activeBody.observationTip}
        </div>

        {/* 趣味冷知识 */}
        {activeBody.funFact && (
          <div
            style={{
              background: 'rgba(234, 179, 8, 0.12)',
              borderLeft: '3px solid #eab308',
              padding: '7px 12px',
              borderRadius: 6,
              fontSize: 11,
              lineHeight: 1.45,
              color: '#fef08a',
              marginBottom: 12,
            }}
          >
            ✨ <strong>趣味冷知识：</strong>{activeBody.funFact}
          </div>
        )}

        {/* 飞往这里按钮 */}
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
          <span>飞往这里 (Fly To {activeBody.name})</span>
        </button>

        {/* 家长展开科学数据 */}
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
              {activeBody.rotationPeriodHours !== 0 && (
                <div>自转周期: <span style={{ color: '#e2e8f0' }}>{activeBody.rotationPeriodHours} 小时</span></div>
              )}
              {activeBody.orbitPeriodDays > 0 && (
                <div>公转周期: <span style={{ color: '#e2e8f0' }}>{activeBody.orbitPeriodDays} 天</span></div>
              )}
              {activeBody.orbitSemiMajorAxisKm > 0 && (
                <div>轨道距离: <span style={{ color: '#e2e8f0' }}>{(activeBody.orbitSemiMajorAxisKm / 10000).toFixed(0)} 万公里 ({(activeBody.orbitSemiMajorAxisKm / 149598023).toFixed(2)} AU)</span></div>
              )}
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
          <span style={{ color: '#64748b' }}>公转倍速:</span>
          {[1, 10, 50, 200, 1000].map((speed) => (
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
          {cameraSnapshot?.isTransitioning && <span style={{ color: '#38bdf8', marginLeft: 6 }}>丝滑飞行中...</span>}
        </div>
      </footer>

      {/* 航天器机库全屏模态窗口 */}
      {showHangar && (
        <HangarModal
          currentVehicleId={currentVehicleId}
          onSelectVehicle={handleSelectVehicle}
          onClose={() => setShowHangar(false)}
        />
      )}

      {/* 探索发现明信片预览与下载窗口 */}
      {showPostcardModal && (
        <PostcardModal
          postcardDataUrl={postcardDataUrl}
          onClose={() => setShowPostcardModal(false)}
          bodyName={activeBody.name}
          vehicleName={activeVehicle ? activeVehicle.name : undefined}
        />
      )}

      {/* 交互提示气泡 Toast */}
      {toastMessage && (
        <div
          style={{
            position: 'absolute',
            top: 70,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(15, 23, 42, 0.92)',
            backdropFilter: 'blur(16px)',
            border: '1px solid rgba(56, 189, 248, 0.4)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
            color: '#38bdf8',
            padding: '8px 18px',
            borderRadius: 20,
            fontSize: 12,
            fontWeight: 600,
            zIndex: 150,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
};
