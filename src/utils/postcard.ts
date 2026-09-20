/**
 * 太阳系探索明信片生成器
 * 遵循 04-VEHICLES.zh-CN.md 规范：
 * 1. 离线 Canvas 2D 本地合成，零网络上传，完全保障儿童隐私安全；
 * 2. 真实天体名称、记录日期、搭载载具与机构；
 * 3. 亲子观察发现印章与科学数据源溯源标识（NASA / ESA / CNSA / JPL / LROC）。
 */

export interface PostcardParams {
  sourceCanvas: HTMLCanvasElement;
  bodyName: string;
  bodyNameEn: string;
  bodyType: string;
  vehicleName?: string;
  vehicleAgency?: string;
  observationTip: string;
  funFact?: string;
  sourceRef: string;
  dateStr?: string;
}

export function generateDiscoveryPostcard(params: PostcardParams): Promise<string> {
  return new Promise((resolve) => {
    // 1. 创建离线高分辨率画布 (16:9 标准明信片比例 1600 x 900)
    const cardWidth = 1600;
    const cardHeight = 900;
    const offCanvas = document.createElement('canvas');
    offCanvas.width = cardWidth;
    offCanvas.height = cardHeight;
    const ctx = offCanvas.getContext('2d');

    if (!ctx) {
      resolve(params.sourceCanvas.toDataURL('image/jpeg', 0.9));
      return;
    }

    // 2. 底色与深空质感渐变边框
    const bgGrad = ctx.createLinearGradient(0, 0, cardWidth, cardHeight);
    bgGrad.addColorStop(0, '#060a12');
    bgGrad.addColorStop(0.5, '#0b1325');
    bgGrad.addColorStop(1, '#050914');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, cardWidth, cardHeight);

    // 3. 绘制 3D 渲染画面（保持居中比例适配）
    const srcW = params.sourceCanvas.width;
    const srcH = params.sourceCanvas.height;

    // 画面内边距
    const margin = 36;
    const innerW = cardWidth - margin * 2;
    const innerH = cardHeight - margin * 2 - 130; // 留出底部明信片图文记录区

    // 居中按比例裁剪缩放
    const scale = Math.max(innerW / srcW, innerH / srcH);
    const renderW = srcW * scale;
    const renderH = srcH * scale;
    const offsetX = margin + (innerW - renderW) / 2;
    const offsetY = margin + (innerH - renderH) / 2;

    ctx.save();
    // 绘制圆角主视图视窗
    ctx.beginPath();
    roundRect(ctx, margin, margin, innerW, innerH, 18);
    ctx.clip();
    ctx.drawImage(params.sourceCanvas, offsetX, offsetY, renderW, renderH);

    // 微弱内发光暗角遮罩
    const vignette = ctx.createRadialGradient(
      margin + innerW / 2,
      margin + innerH / 2,
      innerW * 0.3,
      margin + innerW / 2,
      margin + innerH / 2,
      innerW * 0.65
    );
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(2,6,15,0.45)');
    ctx.fillStyle = vignette;
    ctx.fillRect(margin, margin, innerW, innerH);
    ctx.restore();

    // 画面边框
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    roundRect(ctx, margin, margin, innerW, innerH, 18);
    ctx.stroke();

    // 4. 画面顶部浮动标签
    // 左上角：太阳系漫游探索编号徽章
    ctx.save();
    ctx.fillStyle = 'rgba(10, 16, 26, 0.78)';
    ctx.beginPath();
    roundRect(ctx, margin + 20, margin + 20, 260, 44, 10);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 16px "SF Pro Display", -apple-system, sans-serif';
    ctx.fillText('SOLAR SYSTEM EXPLORER', margin + 36, margin + 42);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '12px "SF Pro Display", -apple-system, sans-serif';
    ctx.fillText('深空亲子天文探索档案', margin + 36, margin + 57);
    ctx.restore();

    // 右上角：搭载载具徽章（若有）
    if (params.vehicleName) {
      ctx.save();
      const vText = `搭乘载具: ${params.vehicleName} (${params.vehicleAgency || 'SPACE'})`;
      ctx.font = 'bold 15px "SF Pro Display", -apple-system, sans-serif';
      const textWidth = ctx.measureText(vText).width;
      const badgeW = textWidth + 36;

      ctx.fillStyle = 'rgba(10, 16, 26, 0.78)';
      ctx.beginPath();
      roundRect(ctx, margin + innerW - badgeW - 20, margin + 20, badgeW, 44, 10);
      ctx.fill();
      ctx.strokeStyle = 'rgba(234, 179, 8, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = '#fde047';
      ctx.fillText('🚀 ' + vText, margin + innerW - badgeW - 4, margin + 48);
      ctx.restore();
    }

    // 5. 底部明信片记录区
    const footerY = margin + innerH + 20;

    // 左侧：天体名称与类型
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 36px "SF Pro Display", "PingFang SC", sans-serif';
    ctx.fillText(params.bodyName, margin + 10, footerY + 40);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '18px "SF Pro Display", -apple-system, sans-serif';
    ctx.fillText(params.bodyNameEn.toUpperCase(), margin + 12, footerY + 68);

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 14px "SF Pro Display", -apple-system, sans-serif';
    ctx.fillText(`• ${params.bodyType}`, margin + 12, footerY + 92);

    // 中间：观察发现与孩子记忆点
    const contentX = margin + 320;
    const contentW = innerW - 640;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
    ctx.beginPath();
    roundRect(ctx, contentX, footerY, contentW, 110, 12);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 15px "PingFang SC", sans-serif';
    ctx.fillText('💡 亲子观察笔记：', contentX + 16, footerY + 30);

    ctx.fillStyle = '#e2e8f0';
    ctx.font = '15px "PingFang SC", sans-serif';
    wrapText(ctx, params.observationTip, contentX + 16, footerY + 56, contentW - 32, 22);

    if (params.funFact) {
      ctx.fillStyle = '#fef08a';
      ctx.font = '13px "PingFang SC", sans-serif';
      const shortFact = '✨ ' + (params.funFact.length > 55 ? params.funFact.slice(0, 52) + '...' : params.funFact);
      ctx.fillText(shortFact, contentX + 16, footerY + 98);
    }

    // 右侧：探索印章与真实数据版权标识
    const stampX = margin + innerW - 280;
    ctx.save();
    ctx.translate(stampX + 130, footerY + 50);
    ctx.rotate(-0.06);

    // 双同心圆印章
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.65)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 48, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, 42, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 11px "SF Pro Display", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('VERIFIED MISSION', 0, -18);
    ctx.font = 'bold 14px "SF Pro Display", sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(params.dateStr || new Date().toISOString().slice(0, 10), 0, 4);
    ctx.font = '10px "SF Pro Display", sans-serif';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('SOLAR VOYAGE', 0, 22);
    ctx.restore();

    // 科学数据来源标注
    ctx.fillStyle = '#64748b';
    ctx.font = '11px "SF Pro Display", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`科学数据依据: ${params.sourceRef} (CC BY / Public Domain)`, margin + innerW, footerY + 110);

    resolve(offCanvas.toDataURL('image/jpeg', 0.95));
  });
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
): void {
  let line = '';
  let curY = y;

  for (let i = 0; i < text.length; i++) {
    const testLine = line + text[i];
    const testWidth = ctx.measureText(testLine).width;
    if (testWidth > maxWidth && i > 0) {
      ctx.fillText(line, x, curY);
      line = text[i];
      curY += lineHeight;
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line, x, curY);
}
