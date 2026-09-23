/**
 * P3b-C（Pro C 批第 3 条）：利用现有整幅 NAC DTM 的真实有效区扩大 5m DEM+正射覆盖。
 *
 * 行为：
 * 1. 本地整文件粗扫（每 16 行/列）有效数据 bbox——记录整幅真实可用范围；
 * 2. 在站点周围候选块内精扫，寻找以站点像元为中心的最大"全有效"方形窗口
 *    （上限可配，默认 2400px = 12km；任何 NoData 像元都不接受——网格构建器
 *    假设窗口边界高程有效，fail-closed 语义保持严格）；
 * 3. 按 pack-dem schema v2 重打包 public/data/dem/apollo17-v1（含全文件溯源哈希，
 *    删除旧 admission.json——新数据指纹必须重新走准入验收）；
 * 4. 自校验：本地整文件复读逐位 + 远程 4 字节独立读数。
 *
 * 用法：node scripts/expand-apollo17-window.mjs [maxHalfPx]（默认 1200 → 2400px 窗）
 */
import { readFileSync, writeFileSync, mkdirSync, unlinkSync, existsSync, openSync, readSync, closeSync, statSync, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const CACHE_DIR = process.env.DEM_CACHE_DIR || 'D:/solar-evidence/data-cache/lroc-apollo17';
const OUT_DIR = 'public/data/dem/apollo17-v1';
const TIF_PATH = join(CACHE_DIR, 'NAC_DTM_APOLLO17.TIF');
const IMG_PATH = join(CACHE_DIR, 'NAC_DTM_APOLLO17_MOSAIC_5M.IMG');

const TARGET = { lat: 20.35, lon: 30.78 }; // Taurus-Littrow 站点
const R_MOON = 1737400;
const LAT0_RAD = (20.0 * Math.PI) / 180;
const TIF_SIZE = 463397471;
const IMG_SIZE = 231671970;
const STRIP0 = 93471;

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const rad = Math.PI / 180;

/** 与 fetch-apollo17-window.mjs 相同的图面↔地理公式 */
const lonToX = (lon) => R_MOON * Math.cos(LAT0_RAD) * (lon - 180.0) * rad;
const latToY = (lat) => R_MOON * lat * rad;
function parseLocalTiff() {
  if (statSync(TIF_PATH).size !== TIF_SIZE) throw new Error(`TIF 尺寸异常 ${statSync(TIF_PATH).size}`);
  const head = readFileSync(TIF_PATH).subarray(0, 93472);
  const u16 = (o) => head.readUInt16LE(o);
  const u32 = (o) => head.readUInt32LE(o);
  const ifdOff = u32(4);
  const n = u16(ifdOff);
  const sizes = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 11: 4, 12: 8 };
  const g = { width: 0, height: 0 };
  let stripOffPtr = 0, pixelScale = null, tiepoint = null, compression = 0, rowsPerStrip = 0;
  for (let i = 0; i < n; i++) {
    const e = ifdOff + 2 + i * 12;
    const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
    const bytes = (sizes[type] || 1) * count;
    const base = bytes <= 4 ? e + 8 : u32(e + 8);
    if (tag === 256) g.width = u16(base);
    else if (tag === 257) g.height = u16(base);
    else if (tag === 259) compression = u16(base);
    else if (tag === 273) stripOffPtr = bytes > 4 ? u32(e + 8) : e + 8;
    else if (tag === 278) rowsPerStrip = u32(base);
    else if (tag === 33550) pixelScale = Array.from({ length: 3 }, (_, k) => head.readDoubleLE(base + k * 8));
    else if (tag === 33922) tiepoint = Array.from({ length: 6 }, (_, k) => head.readDoubleLE(base + k * 8));
  }
  if (compression !== 1 || rowsPerStrip !== 1 || u32(stripOffPtr) !== STRIP0) {
    throw new Error(`TIF 结构异常 compression=${compression} rps=${rowsPerStrip} strip0=${u32(stripOffPtr)}`);
  }
  g.dx = pixelScale[0];
  g.dy = -pixelScale[1];
  g.x0 = tiepoint[3];
  g.y0 = tiepoint[4];
  g.rowBytes = g.width * 4;
  return g;
}

const sitePixel = (g) => ({
  col: (lonToX(TARGET.lon) - g.x0) / g.dx - 0.5,
  row: (latToY(TARGET.lat) - g.y0) / g.dy - 0.5,
});

const isValidFloat = (v) => Number.isFinite(v) && v > -1e38 && v < 1e38;

function main() {
  const maxHalf = parseInt(process.argv[2] || '1200', 10);
  const g = parseLocalTiff();
  const site = sitePixel(g);
  const cSite = Math.round(site.col);
  const rSite = Math.round(site.row);
  console.log(`TIF ${g.width}x${g.height} @5m；站点像元 (${site.col.toFixed(1)}, ${site.row.toFixed(1)})`);

  const fh = openSync(TIF_PATH, 'r');
  const rowBuf = Buffer.alloc(g.rowBytes);

  // 1) 整幅粗扫（每 16 行/16 列）：真实有效 bbox
  let bbox = { cMin: Infinity, cMax: -Infinity, rMin: Infinity, rMax: -Infinity };
  for (let r = 0; r < g.height; r += 16) {
    readSync(fh, rowBuf, 0, g.rowBytes, STRIP0 + r * g.rowBytes);
    for (let c = 0; c < g.width; c += 16) {
      if (isValidFloat(rowBuf.readFloatLE(c * 4))) {
        if (c < bbox.cMin) bbox.cMin = c;
        if (c > bbox.cMax) bbox.cMax = c;
        if (r < bbox.rMin) bbox.rMin = r;
        if (r > bbox.rMax) bbox.rMax = r;
      }
    }
  }
  const km = (px) => ((px * 5) / 1000).toFixed(1);
  console.log(`整幅有效 bbox(粗扫,16px 步进): 列[${bbox.cMin},${bbox.cMax}](${km(bbox.cMax - bbox.cMin)}km) 行[${bbox.rMin},${bbox.rMax}](${km(bbox.rMax - bbox.rMin)}km)`);

  // 2) 候选块精扫：以站点为中心，找最大全有效方形窗口（含边界 clamp 到整幅范围）
  const halfCap = Math.min(maxHalf, cSite, rSite, g.width - 1 - cSite, g.height - 1 - rSite);
  let half = halfCap;
  let chosen = null;
  while (half >= 300) {
    const colStart = cSite - half;
    const rowStart = rSite - half;
    const w = half * 2;
    let allValid = true;
    scan: for (let r = 0; r < w; r++) {
      readSync(fh, rowBuf, 0, g.rowBytes, STRIP0 + (rowStart + r) * g.rowBytes);
      for (let c = 0; c < w; c++) {
        if (!isValidFloat(rowBuf.readFloatLE((colStart + c) * 4))) { allValid = false; break scan; }
      }
    }
    console.log(`  half=${half} (${km(half * 2)}km 方窗): ${allValid ? '全有效 ✓' : '含 NoData ✗'}`);
    if (allValid) { chosen = { colStart, rowStart, w }; break; }
    half -= 100;
  }
  if (!chosen) throw new Error('未找到 ≥3km 的全有效居中窗口');
  const { colStart, rowStart, w: width } = chosen;
  const height = width;
  console.log(`选定窗口: 列[${colStart},${colStart + width}) 行[${rowStart},${rowStart + height}) ${width}x${height} (${km(width)}km)`);

  // 3) 重打包（读 DEM + 正射，生成 height/valid/ortho/metadata）
  const dem = Buffer.alloc(width * height * 4);
  const valid = Buffer.alloc(width * height);
  let validCount = 0, minH = Infinity, maxH = -Infinity;
  for (let r = 0; r < height; r++) {
    readSync(fh, rowBuf, 0, g.rowBytes, STRIP0 + (rowStart + r) * g.rowBytes);
    for (let c = 0; c < width; c++) {
      const v = rowBuf.readFloatLE((colStart + c) * 4);
      const oi = r * width + c;
      dem.writeFloatLE(v, oi * 4);
      valid[oi] = 1; // 全有效窗口（扫描已保证）
      validCount++;
      if (v < minH) minH = v;
      if (v > maxH) maxH = v;
    }
  }
  closeSync(fh);
  console.log(`DEM ${validCount}/${width * height} 有效，高程 [${minH.toFixed(2)}, ${maxH.toFixed(2)}] m`);
  if (validCount !== width * height || minH < -20000 || maxH > 20000) throw new Error('高程范围异常，拒绝打包');

  if (statSync(IMG_PATH).size !== IMG_SIZE) throw new Error('正射 IMG 尺寸异常');
  const ofh = openSync(IMG_PATH, 'r');
  const oRowBytes = g.width * 2;
  const oRowBuf = Buffer.alloc(oRowBytes);
  const ortho = Buffer.alloc(width * height * 2);
  let oMax = 0, oSum = 0;
  for (let r = 0; r < height; r++) {
    readSync(ofh, oRowBuf, 0, oRowBytes, 19970 + (rowStart + r) * oRowBytes);
    for (let c = 0; c < width; c++) {
      const v = oRowBuf.readUInt16LE((colStart + c) * 2);
      ortho.writeUInt16LE(v, (r * width + c) * 2);
      if (v > oMax) oMax = v;
      oSum += v;
    }
  }
  closeSync(ofh);
  console.log(`正射 I/F 最大 ${oMax}，均值 ${(oSum / validCount).toFixed(1)}`);

  const firstLon = 180.0 + (g.x0 + (colStart + 0.5) * g.dx) / (R_MOON * Math.cos(LAT0_RAD)) / rad;
  const firstLat = (g.y0 + (rowStart + 0.5) * g.dy) / R_MOON / rad;
  const lastLon = 180.0 + (g.x0 + (colStart + width - 0.5) * g.dx) / (R_MOON * Math.cos(LAT0_RAD)) / rad;
  const lastLat = (g.y0 + (rowStart + height - 0.5) * g.dy) / R_MOON / rad;

  mkdirSync(OUT_DIR, { recursive: true });
  const admPath = join(OUT_DIR, 'admission.json');
  if (existsSync(admPath)) {
    unlinkSync(admPath);
    console.log('已删除旧 admission.json（新数据指纹需重新准入验收）');
  }
  writeFileSync(join(OUT_DIR, 'height.f32'), dem);
  writeFileSync(join(OUT_DIR, 'valid.u8'), valid);
  writeFileSync(join(OUT_DIR, 'ortho.u16'), ortho);

  // 沿用现有 metadata 的溯源字段（来源/版本/许可），仅更新窗口与派生量
  const prevMeta = JSON.parse(readFileSync(join(OUT_DIR, 'metadata.json'), 'utf-8'));
  const meta = {
    ...prevMeta,
    width,
    height,
    window: { colStart, rowStart, width, height },
    windowFirstSampleCenter: { latDeg: firstLat, lonDeg: firstLon },
    windowLastSampleCenter: { latDeg: lastLat, lonDeg: lastLon },
    validSampleCount: validCount,
    minimumHeightM: minH,
    maximumHeightM: maxH,
    heightSha256: sha256(dem),
    validSha256: sha256(valid),
    orthoSha256: sha256(ortho),
    fullImageValidBboxCoarse: {
      note: '整幅 11600x9985 每 16px 粗扫的有效数据包围盒（P3b-C 扩窗调查）',
      colMin: bbox.cMin, colMax: bbox.cMax, rowMin: bbox.rMin, rowMax: bbox.rMax,
    },
    expansionNote: `P3b-C（Pro C 批第 3 条）：窗口由 1200px(6km) 扩至 ${width}px(${km(width)}km)——以站点为中心的最大全有效方窗（上限 ${maxHalf * 2}px）。网格/挖孔/裙边由 windowBounds 驱动自动适配；native 5m 采样不变。`,
    warning: `${prevMeta.warning} P3b-C 扩窗后待重新走三点远程交叉验收（verify-p2-dem-descent）。`,
  };
  writeFileSync(join(OUT_DIR, 'metadata.json'), JSON.stringify(meta, null, 2));
  console.log(`打包完成 -> ${OUT_DIR} (${width}x${height}=${km(width)}km)`);

  // 4) 自校验：本地整文件复读（6 像元逐位）
  const fh2 = openSync(TIF_PATH, 'r');
  const probe = Buffer.alloc(4);
  for (let i = 0; i < 6; i++) {
    const col = colStart + Math.floor((i + 0.5) * (width / 6));
    const row = rowStart + Math.floor(((i * 7) % 6 + 0.5) * (height / 6));
    readSync(fh2, probe, 0, 4, STRIP0 + row * g.rowBytes + col * 4);
    const direct = probe.readFloatLE(0);
    const packed = dem.readFloatLE(((row - rowStart) * width + (col - colStart)) * 4);
    if (direct !== packed) throw new Error(`自校验失配 @(${col},${row}) ${direct} vs ${packed}`);
  }
  closeSync(fh2);
  console.log('自校验（本地整文件复读 6 像元逐位一致）✓');
}

try {
  main();
} catch (e) {
  console.error(e);
  process.exit(1);
}
