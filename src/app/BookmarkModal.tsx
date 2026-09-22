/**
 * 观察点与书签库模态框 BookmarkModal
 * 遵循 01-REBUILD-PLAN.zh-CN.md 与 03-ACCEPTANCE.zh-CN.md (SAVE-01, SAVE-02) 规范：
 * 1. 经典预置天文视角 + 用户自定义观测点持久化；
 * 2. 一键飞往观察点（平滑恢复相机、天体、图层开关与所选飞船）；
 * 3. 支持 JSON 格式离线导出与导入备份校验；
 * 4. 纯本地浏览器存储，保护儿童与家庭隐私。
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  X,
  Bookmark,
  BookmarkPlus,
  Download,
  Upload,
  Trash2,
  Navigation,
  Check,
  ShieldCheck,
  Rocket,
  Layers,
} from 'lucide-react';
import type { BookmarkItem } from '../contracts/bookmark';
import type { BodyId } from '../contracts/body';
import type { CameraStateSnapshot } from '../contracts/camera';
import type { VehicleId, ViewCameraMode } from '../contracts/vehicle';
import { BODIES } from '../astronomy/bodies';
import { VEHICLE_CATALOG } from '../vehicles/VehicleCatalog';
import {
  getStoredBookmarks,
  saveBookmark,
  deleteBookmark,
  downloadBookmarksFile,
  importBookmarksJson,
} from '../utils/bookmarkStorage';

interface BookmarkModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRestoreBookmark: (bookmark: BookmarkItem) => void;
  onCaptureSnapshot?: (title?: string) => BookmarkItem;
  currentSnapshot: CameraStateSnapshot | null;
  currentBodyId: BodyId;
  currentVehicleId: VehicleId | null;
  currentViewCameraMode: ViewCameraMode;
  currentPresentationPolicy?: 'NAV_SCHEMATIC' | 'PHYSICAL_OBSERVATION';
  currentSimTimeHours?: number;
  currentLayers: {
    showClouds: boolean;
    showAtmosphere: boolean;
    teachingLight: boolean;
    showOrbits: boolean;
    venusRadarMode: boolean;
  };
  onToast: (msg: string) => void;
}

export const BookmarkModal: React.FC<BookmarkModalProps> = ({
  isOpen,
  onClose,
  onRestoreBookmark,
  onCaptureSnapshot,
  currentSnapshot,
  currentBodyId,
  currentVehicleId,
  currentViewCameraMode,
  currentPresentationPolicy,
  currentSimTimeHours,
  currentLayers,
  onToast,
}) => {
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
  const [activeTab, setActiveTab] = useState<'presets' | 'custom'>('presets');
  const [showAddForm, setShowAddForm] = useState<boolean>(false);
  const [newTitle, setNewTitle] = useState<string>('');
  const [newNotes, setNewNotes] = useState<string>('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  const refreshList = () => {
    setBookmarks(getStoredBookmarks());
  };

  useEffect(() => {
    if (isOpen) {
      refreshList();
      setShowAddForm(false);
      const activeName = BODIES[currentBodyId]?.name || '天体';
      setNewTitle(`观测点 · ${activeName}`);
      setNewNotes('');
    }
  }, [isOpen, currentBodyId]);

  if (!isOpen) return null;

  const presetList = bookmarks.filter((b) => b.isPreset);
  const customList = bookmarks.filter((b) => !b.isPreset);

  const handleSaveCurrent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) {
      onToast('⚠️ 请输入书签名！');
      return;
    }

    let newBm: BookmarkItem;
    if (onCaptureSnapshot) {
      newBm = onCaptureSnapshot(newTitle.trim());
      if (newNotes.trim()) {
        newBm.notes = newNotes.trim();
      }
    } else {
      const spherical = currentSnapshot?.spherical || {
        radius: 12.0,
        phi: Math.PI / 2.8,
        theta: 0.0,
      };

      newBm = {
        id: 'bm-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
        schemaVersion: 2,
        title: newTitle.trim(),
        targetBodyId: currentBodyId,
        presentationPolicy: currentPresentationPolicy || 'NAV_SCHEMATIC',
        epochIso: '2026-09-22T00:00:00Z',
        spherical: {
          radius: Number(spherical.radius.toFixed(3)),
          phi: Number(spherical.phi.toFixed(3)),
          theta: Number(spherical.theta.toFixed(3)),
        },
        lookTarget: currentSnapshot?.lookTarget || { kind: 'center' },
        viewCameraMode: currentViewCameraMode,
        vehicleId: currentVehicleId,
        layers: { ...currentLayers },
        simTimeHours: currentSimTimeHours ?? 0.0,
        createdAtIso: new Date().toISOString(),
        notes: newNotes.trim() || undefined,
      };
    }

    saveBookmark(newBm);
    refreshList();
    setShowAddForm(false);
    setActiveTab('custom');
    onToast(`✅ 已保存书签：“${newBm.title}”`);
  };

  const handleDelete = (id: string, title: string) => {
    deleteBookmark(id);
    refreshList();
    onToast(`🗑️ 已删除书签：“${title}”`);
  };

  const handleRestore = (item: BookmarkItem) => {
    onRestoreBookmark(item);
    onClose();
    onToast(`🚀 正在飞往观察点：“${item.title}”`);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const content = evt.target?.result as string;
      if (!content) return;
      const res = importBookmarksJson(content);
      if (res.success) {
        refreshList();
        setActiveTab('custom');
        onToast(`📥 ${res.message}`);
      } else {
        onToast(`❌ 导入失败: ${res.message}`);
      }
    };
    reader.readAsText(file);
    if (e.target) {
      e.target.value = '';
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(3, 7, 18, 0.85)',
        backdropFilter: 'blur(16px)',
        zIndex: 110,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        style={{
          width: '90vw',
          maxWidth: 960,
          maxHeight: '90vh',
          backgroundColor: '#0b1322',
          borderRadius: 20,
          border: '1px solid rgba(56, 189, 248, 0.3)',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.85)',
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: 'rgba(56, 189, 248, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#38bdf8',
                border: '1px solid rgba(56, 189, 248, 0.3)',
              }}
            >
              <Bookmark size={20} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: '#f8fafc' }}>
                太阳系观察点与书签库
              </h2>
              <div style={{ fontSize: 12, color: '#94a3b8' }}>
                一键重现经典天文奇观与您精心标记的探索视界
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            data-testid="bookmark-modal-close-btn"
            title="关闭书签库"
            aria-label="关闭书签库"
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
              transition: 'all 0.15s ease',
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* 快捷操作栏：添加当前、导出、导入 */}
        <div
          style={{
            padding: '12px 24px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'rgba(11, 19, 34, 0.95)',
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          {/* 选项卡切换 */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => setActiveTab('presets')}
              data-testid="bookmark-tab-presets"
              style={{
                padding: '6px 14px',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                background: activeTab === 'presets' ? 'rgba(56, 189, 248, 0.2)' : 'transparent',
                color: activeTab === 'presets' ? '#38bdf8' : '#94a3b8',
                border: activeTab === 'presets' ? '1px solid rgba(56, 189, 248, 0.4)' : '1px solid transparent',
              }}
            >
              🌟 经典天文预置 ({presetList.length})
            </button>
            <button
              onClick={() => setActiveTab('custom')}
              data-testid="bookmark-tab-custom"
              style={{
                padding: '6px 14px',
                borderRadius: 8,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                background: activeTab === 'custom' ? 'rgba(56, 189, 248, 0.2)' : 'transparent',
                color: activeTab === 'custom' ? '#38bdf8' : '#94a3b8',
                border: activeTab === 'custom' ? '1px solid rgba(56, 189, 248, 0.4)' : '1px solid transparent',
              }}
            >
              📂 我的收藏 ({customList.length})
            </button>
          </div>

          {/* 操作按钮 */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              data-testid="bookmark-btn-add"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '7px 13px',
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                background: showAddForm ? 'rgba(56, 189, 248, 0.3)' : 'rgba(56, 189, 248, 0.12)',
                color: '#38bdf8',
                border: '1px solid rgba(56, 189, 248, 0.35)',
              }}
            >
              <BookmarkPlus size={14} />
              {showAddForm ? '取消保存' : '收藏当前视角'}
            </button>

            <button
              onClick={() => downloadBookmarksFile()}
              title="导出当前全部书签为本地 JSON 备份"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '7px 13px',
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 500,
                cursor: 'pointer',
                background: 'rgba(255, 255, 255, 0.05)',
                color: '#e2e8f0',
                border: '1px solid rgba(255, 255, 255, 0.1)',
              }}
            >
              <Download size={14} />
              导出备份
            </button>

            <button
              onClick={() => fileInputRef.current?.click()}
              title="从本地 JSON 文件导入书签"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '7px 13px',
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 500,
                cursor: 'pointer',
                background: 'rgba(255, 255, 255, 0.05)',
                color: '#e2e8f0',
                border: '1px solid rgba(255, 255, 255, 0.1)',
              }}
            >
              <Upload size={14} />
              导入备份
            </button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".json"
              style={{ display: 'none' }}
            />
          </div>
        </div>

        {/* 展开的“保存当前视角”表单 */}
        {showAddForm && (
          <form
            onSubmit={handleSaveCurrent}
            style={{
              padding: '16px 24px',
              backgroundColor: 'rgba(15, 23, 42, 0.9)',
              borderBottom: '1px solid rgba(56, 189, 248, 0.2)',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, color: '#38bdf8' }}>
              📍 记录当前观测点参数：目标天体【{BODIES[currentBodyId]?.name}】，乘员载具【
              {currentVehicleId ? VEHICLE_CATALOG[currentVehicleId].name : '无'}】
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <input
                type="text"
                data-testid="bookmark-save-title-input"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="书签名（例如：从极轨遥望土星光环）"
                style={{
                  flex: 1,
                  minWidth: 260,
                  padding: '8px 12px',
                  backgroundColor: 'rgba(255, 255, 255, 0.06)',
                  border: '1px solid rgba(56, 189, 248, 0.3)',
                  borderRadius: 8,
                  color: '#fff',
                  fontSize: 13,
                  outline: 'none',
                }}
              />
              <input
                type="text"
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                placeholder="亲子观察笔记或备注文案（选填）"
                style={{
                  flex: 2,
                  minWidth: 260,
                  padding: '8px 12px',
                  backgroundColor: 'rgba(255, 255, 255, 0.06)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  borderRadius: 8,
                  color: '#fff',
                  fontSize: 13,
                  outline: 'none',
                }}
              />
              <button
                type="submit"
                data-testid="bookmark-save-submit-btn"
                style={{
                  padding: '8px 18px',
                  backgroundColor: '#0284c7',
                  border: 'none',
                  borderRadius: 8,
                  color: '#fff',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Check size={15} />
                确认保存
              </button>
            </div>
          </form>
        )}

        {/* 书签卡片列表展示区 */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '20px 24px',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))',
            gap: 16,
            alignContent: 'start',
          }}
        >
          {(activeTab === 'presets' ? presetList : customList).length === 0 ? (
            <div
              style={{
                gridColumn: '1 / -1',
                padding: '48px 0',
                textAlign: 'center',
                color: '#64748b',
                fontSize: 14,
              }}
            >
              暂无自定义书签，点击上方“收藏当前视角”记录您的第一个太空探索点吧！
            </div>
          ) : (
            (activeTab === 'presets' ? presetList : customList).map((item) => {
              const bodyDef = BODIES[item.targetBodyId] || BODIES.sun;
              const vehicleDef = item.vehicleId ? VEHICLE_CATALOG[item.vehicleId] : null;

              return (
                <div
                  key={item.id}
                  style={{
                    backgroundColor: 'rgba(15, 23, 42, 0.65)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: 14,
                    padding: 16,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 12,
                    transition: 'border-color 0.2s, transform 0.2s',
                  }}
                >
                  {/* 卡片头部 */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                    <div>
                      <div
                        style={{
                          fontSize: 15,
                          fontWeight: 700,
                          color: '#f8fafc',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                        }}
                      >
                        {item.title}
                      </div>
                      <div style={{ fontSize: 11, color: '#38bdf8', marginTop: 2 }}>
                        {bodyDef.name} · {bodyDef.nameEn} (
                        {bodyDef.type === 'star' ? '恒星' : bodyDef.type === 'planet' ? '大行星' : '卫星'}
                        )
                      </div>
                    </div>

                    <span
                      style={{
                        fontSize: 11,
                        padding: '3px 8px',
                        borderRadius: 6,
                        backgroundColor: item.isPreset ? 'rgba(56, 189, 248, 0.15)' : 'rgba(168, 85, 247, 0.15)',
                        color: item.isPreset ? '#38bdf8' : '#c084fc',
                        border: item.isPreset
                          ? '1px solid rgba(56, 189, 248, 0.3)'
                          : '1px solid rgba(168, 85, 247, 0.3)',
                        flexShrink: 0,
                      }}
                    >
                      {item.isPreset ? '经典视角' : '我的收藏'}
                    </span>
                  </div>

                  {/* 观测笔记或说明 */}
                  {item.notes && (
                    <div
                      style={{
                        fontSize: 12,
                        color: '#94a3b8',
                        lineHeight: 1.5,
                        background: 'rgba(0, 0, 0, 0.25)',
                        padding: '8px 10px',
                        borderRadius: 8,
                      }}
                    >
                      {item.notes}
                    </div>
                  )}

                  {/* 状态参数标签 */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {vehicleDef && (
                      <span
                        style={{
                          fontSize: 11,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '3px 8px',
                          borderRadius: 6,
                          backgroundColor: 'rgba(255, 255, 255, 0.05)',
                          color: '#cbd5e1',
                        }}
                      >
                        <Rocket size={12} color="#38bdf8" />
                        {vehicleDef.name}
                      </span>
                    )}

                    <span
                      style={{
                        fontSize: 11,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '3px 8px',
                        borderRadius: 6,
                        backgroundColor: 'rgba(255, 255, 255, 0.05)',
                        color: '#cbd5e1',
                      }}
                    >
                      <Layers size={12} color="#38bdf8" />
                      距离: {item.spherical.radius.toFixed(1)} R
                    </span>

                    {item.layers.showAtmosphere && (
                      <span
                        style={{
                          fontSize: 11,
                          padding: '3px 8px',
                          borderRadius: 6,
                          backgroundColor: 'rgba(56, 189, 248, 0.1)',
                          color: '#7dd3fc',
                        }}
                      >
                        大气外晕
                      </span>
                    )}

                    {item.layers.showClouds && (
                      <span
                        style={{
                          fontSize: 11,
                          padding: '3px 8px',
                          borderRadius: 6,
                          backgroundColor: 'rgba(255, 255, 255, 0.05)',
                          color: '#cbd5e1',
                        }}
                      >
                        云层流动
                      </span>
                    )}
                  </div>

                  {/* 卡片底部操作按钮 */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginTop: 'auto',
                      paddingTop: 8,
                      borderTop: '1px solid rgba(255, 255, 255, 0.05)',
                    }}
                  >
                    <button
                      onClick={() => handleRestore(item)}
                      data-testid={`bookmark-fly-${item.id}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '7px 14px',
                        borderRadius: 8,
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                        background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                        color: '#ffffff',
                        border: 'none',
                        boxShadow: '0 2px 8px rgba(2, 132, 199, 0.3)',
                      }}
                    >
                      <Navigation size={13} />
                      飞往此观察点
                    </button>

                    {!item.isPreset && (
                      <button
                        onClick={() => handleDelete(item.id, item.title)}
                        title="删除此书签"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '6px 10px',
                          borderRadius: 6,
                          fontSize: 12,
                          cursor: 'pointer',
                          background: 'rgba(239, 68, 68, 0.1)',
                          color: '#f87171',
                          border: '1px solid rgba(239, 68, 68, 0.25)',
                        }}
                      >
                        <Trash2 size={13} />
                        删除
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* 底部隐私与离线安全注记 */}
        <div
          style={{
            padding: '12px 24px',
            backgroundColor: 'rgba(15, 23, 42, 0.75)',
            borderTop: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: 12,
            color: '#94a3b8',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <ShieldCheck size={15} color="#10b981" />
            <span>离线安全：所有书签数据均保存在本地浏览器 LocalStorage，绝不向任何外部服务器收集或上传。</span>
          </div>
          <div>Schema v1 · 纯离线跨设备 JSON 备份</div>
        </div>
      </div>
    </div>
  );
};
