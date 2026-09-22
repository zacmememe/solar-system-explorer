/**
 * 探索明信片预览与下载弹窗 PostcardModal
 * 遵循 04-VEHICLES.zh-CN.md 规范：
 * 1. 真实当前 3D 渲染画面截帧 + 亲子观察印章合成；
 * 2. 纯客户端离线下载，不上传任何隐私或照片数据；
 * 3. 完整保存天体名称、记录时间、所选载具与科学溯源依据。
 */

import React from 'react';
import { X, Download, ShieldCheck } from 'lucide-react';

interface PostcardModalProps {
  postcardDataUrl: string;
  onClose: () => void;
  bodyName: string;
  vehicleName?: string;
}

export const PostcardModal: React.FC<PostcardModalProps> = ({
  postcardDataUrl,
  onClose,
  bodyName,
  vehicleName,
}) => {
  const handleDownload = () => {
    const link = document.createElement('a');
    const dateStr = new Date().toISOString().slice(0, 10);
    const fileName = `太阳系探索明信片-${bodyName}${vehicleName ? '-' + vehicleName : ''}-${dateStr}.jpg`;
    link.download = fileName;
    link.href = postcardDataUrl;
    link.click();
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
          maxWidth: 900,
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
        {/* 顶部标题 */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'rgba(15, 23, 42, 0.65)',
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#f8fafc' }}>
              📸 太空探索发现明信片
            </h2>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>
              已为你自动合成专属当前观测视角的亲子探索记录
            </div>
          </div>

          <button
            onClick={onClose}
            title="关闭明信片"
            aria-label="关闭明信片"
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
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* 明信片大图预览 */}
        <div
          style={{
            padding: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#040711',
          }}
        >
          <img
            src={postcardDataUrl}
            alt="探索明信片预览"
            style={{
              maxWidth: '100%',
              maxHeight: '62vh',
              borderRadius: 12,
              boxShadow: '0 8px 30px rgba(0, 0, 0, 0.7)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
            }}
          />
        </div>

        {/* 底部行动与隐私安全提示 */}
        <div
          style={{
            padding: '14px 20px',
            borderTop: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'rgba(15, 23, 42, 0.75)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 11,
              color: '#94a3b8',
            }}
          >
            <ShieldCheck size={14} color="#38bdf8" />
            <span>纯本地生成，零网络上传，完全保障儿童隐私安全</span>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={onClose}
              style={{
                padding: '8px 16px',
                borderRadius: 8,
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                color: '#cbd5e1',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              关闭
            </button>
            <button
              onClick={handleDownload}
              style={{
                padding: '8px 20px',
                borderRadius: 8,
                background: 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
                border: 'none',
                color: '#ffffff',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                boxShadow: '0 2px 10px rgba(2, 132, 199, 0.4)',
              }}
            >
              <Download size={14} />
              <span>保存明信片到本地 (Download)</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
