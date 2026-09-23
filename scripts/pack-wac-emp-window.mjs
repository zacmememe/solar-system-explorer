/**
 * P3b-C（Pro C 批第 1/2 条）：WAC EMP 643nm/304ppd 区域源——整文件校验、读 label、离线裁窗。
 *
 * 源（PDS4 标签 WAC_EMP_643NM_E300N0450_304P.xml 已随下载核对）：
 * - WAC_EMP_643NM_E300N0450_304P.IMG：PDS3 附头 109,440 B + float32 LE 18240 行 × 27360 列；
 *   MD5 97af2366068cffb38415b3658993b4f1，尺寸 1,996,295,040 B（下载后复核）；
 * - 等距圆柱 304 ppd，标准纬线 0°（与 NAC DTM 的 20° 不同！）：像元中心
 *   lon(col) = col·dx/(R·rad)（col 0 = 0°E），lat(row) = 60° − (row+0.5)/304°；
 *   dx = 99.747863237334 m/px；
 * - 经验归一化反射率（i=30°, e=0°, phase=30°，中位数 n≈142）——单波段 643nm，非肉眼真彩；
 * - 无效值 0xFF7FFFFB（missing）与 0xFF7FFFC..F 饱和族。
 *
 * 处理（单一全局变换，无逐瓦片拉伸）：
 * 1. 按站点裁 14°×10°（经 23.78–37.78°E，纬 15.35–25.35°N，约 4256×3042 px @99.75m）；
 * 2. 线性反射率 → sRGB 显示（gain 匹配 NAC 5m 正射窗口均值，单一标量）；
 * 3. 外缘 0.25° 羽化混合全球底图（lroc_color_2k.jpg 同经纬采样）——同不透明表面上
 *    与父级连续，无独立拉伸、无明暗方格；
 * 4. 输出 8-bit 灰度 JPG + 溯源 metadata。
 *
 * 用法：node scripts/pack-wac-emp-window.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, openSync, readSync, closeSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const SRC = 'D:/solar-evidence/data-cache/wac-emp/WAC_EMP_643NM_E300N0450_304P.IMG';
const SRC_LABEL = 'D:/solar-evidence/data-cache/wac-emp/WAC_EMP_643NM_E300N0450_304P.xml';
const BASE_JPG = 'public/assets/textures/moon/lroc_color_2k.jpg';
const DEM_DIR = 'public/data/dem/apollo17-v1';
const OUT_DIR = 'public/data/imagery/wac-emp-taurus-v1';
const FFMPEG = 'D:/Apps/ffmpeg/bin/ffmpeg.exe';

const R_MOON = 1737400;
const PPD = 304;
const DX_M = 99.747863237334;
const DATA_OFFSET = 109440;
const SRC_LINES = 18240;
const SRC_SAMPLES = 27360;
const SRC_MD5 = '97af2366068cffb38415b3658993b4f1';
const SRC_BYTES = 1996295040;

// 裁窗地理范围（像元中心口径，外扩至整像元）
const LON_MIN = 23.78, LON_MAX = 37.78;
const LAT_MIN = 15.35, LAT_MAX = 25.35;
const FEATHER_DEG = 0.25;

const rad = Math.PI / 180;
const lonOfCol = (col) => (col * DX_M) / R_MOON / rad;
const latOfRow = (row) => 60 - (row + 0.5) / PPD;
const colOfLon = (lon) => Math.round((lon * rad * R_MOON) / DX_M);
const rowOfLat = (lat) => Math.round((60 - lat) * PPD - 0.5);

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const srgb = (x) => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);
const smoothstep = (t) => { const c = clamp01(t); return c * c * (3 - 2 * c); };

function main() {
  // 0) 源校验（尺寸 + MD5 + 标签在场）
  if (statSync(SRC).size !== SRC_BYTES) throw new Error(`IMG 尺寸 ${statSync(SRC).size} ≠ ${SRC_BYTES}`);
  const md5 = createHash('md5');
  const st = openSync(SRC, 'r');
  const chunk = Buffer.alloc(1 << 24);
  for (let pos = 0; pos < SRC_BYTES; ) {
    const n = Math.min(chunk.length, SRC_BYTES - pos);
    readSync(st, chunk, 0, n, pos);
    md5.update(chunk.subarray(0, n));
    pos += n;
  }
  if (md5.digest('hex') !== SRC_MD5) throw new Error('MD5 与 PDS4 标签不符——拒绝打包');
  console.log(`源 MD5 ✓ ${SRC_MD5}`);
  readFileSync(SRC_LABEL, 'utf-8'); // 标签在场（关键字段已硬编码自其解析并双检）

  // 1) 裁窗范围（整像元）
  const col0 = colOfLon(LON_MIN), col1 = colOfLon(LON_MAX);
  const row0 = rowOfLat(LAT_MAX), row1 = rowOfLat(LAT_MIN);
  const W = col1 - col0, H = row1 - row0;
  const lonMin = lonOfCol(col0), lonMax = lonOfCol(col1);
  const latMax = latOfRow(row0), latMin = latOfRow(row1);
  console.log(`裁窗: 列[${col0},${col1}) 行[${row0},${row1}) ${W}x${H}；经 ${lonMin.toFixed(4)}–${lonMax.toFixed(4)}°E 纬 ${latMin.toFixed(4)}–${latMax.toFixed(4)}°N`);

  // 2) 读裁窗 float32 + 反射率统计（子采样分位）
  const crop = Buffer.alloc(W * H * 4);
  const rowBuf = Buffer.alloc(SRC_SAMPLES * 4);
  let missing = 0;
  const vals = [];
  for (let r = 0; r < H; r++) {
    readSync(st, rowBuf, 0, SRC_SAMPLES * 4, DATA_OFFSET + (row0 + r) * SRC_SAMPLES * 4);
    for (let c = 0; c < W; c++) {
      const v = rowBuf.readFloatLE((col0 + c) * 4);
      const oi = (r * W + c) * 4;
      if (!Number.isFinite(v) || v <= -1e38) { missing++; crop.writeFloatLE(NaN, oi); continue; }
      crop.writeFloatLE(v, oi);
      if ((r & 3) === 0 && (c & 3) === 0) vals.push(v);
    }
  }
  closeSync(st);
  vals.sort((a, b) => a - b);
  const q = (p) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))];
  console.log(`反射率: min=${q(0).toFixed(5)} p1=${q(0.01).toFixed(5)} p50=${q(0.5).toFixed(5)} p99=${q(0.99).toFixed(5)} max=${q(1).toFixed(5)}；missing=${missing}`);
  if (missing > W * H * 0.01) throw new Error(`missing ${missing} > 1%`);

  // 3) 增益匹配：WAC 显示均值 → NAC 正射窗口显示均值（单一标量）。
  // 正射显示口径与 buildOrthoTexture 一致：99.5 分位 → 255（denom = p995/255，记于纹理 userData）
  const demMeta = JSON.parse(readFileSync(join(DEM_DIR, 'metadata.json'), 'utf-8'));
  const ortho = readFileSync(join(DEM_DIR, 'ortho.u16'));
  const nOrtho = demMeta.width * demMeta.height;
  const oSorted = [];
  for (let i = 0; i < nOrtho; i += 7) oSorted.push(ortho.readUInt16LE(i * 2)); // 子采样分位（步进7）
  oSorted.sort((a, b) => a - b);
  const oP995 = oSorted[Math.floor((oSorted.length - 1) * 0.995)] || 4096;
  const oDenom = Math.max(1, oP995 / 255);
  // 窗口像元中心 → 经纬 → 裁影像元（最近邻即可，增益只要均值）
  const wLon = (c) => 180 + (demMeta.pixelCornerAffine.x0 + (demMeta.window.colStart + c + 0.5) * demMeta.pixelCornerAffine.dx) / (R_MOON * Math.cos(20 * rad)) / rad;
  const wLat = (r) => (demMeta.pixelCornerAffine.y0 + (demMeta.window.rowStart + r + 0.5) * demMeta.pixelCornerAffine.dy) / R_MOON / rad;
  let oSum = 0, wSum = 0, n = 0;
  const stride = Math.max(1, Math.floor(demMeta.width / 200));
  for (let r = 0; r < demMeta.height; r += stride) {
    for (let c = 0; c < demMeta.width; c += stride) {
      const lon = wLon(c), lat = wLat(r);
      const cc = colOfLon(lon) - col0, rr = rowOfLat(lat) - row0;
      if (cc < 0 || rr < 0 || cc >= W || rr >= H) continue;
      const wv = crop.readFloatLE((rr * W + cc) * 4);
      if (!Number.isFinite(wv)) continue;
      oSum += Math.min(255, ortho.readUInt16LE((r * demMeta.width + c) * 2) / oDenom);
      wSum += wv;
      n++;
    }
  }
  const GAIN = Math.max(0.1, Math.min(4, (oSum / n) / Math.max(1e-9, srgb(wSum / n) * 255)));
  console.log(`增益匹配: 正射 p99.5=${oP995} denom=${oDenom.toFixed(1)}；窗口显示均值 ${(oSum / n).toFixed(1)} vs WAC sRGB 均值 ${(srgb(wSum / n) * 255).toFixed(1)} → gain=${GAIN.toFixed(3)}`);

  // 4) 全球底图采样（ffmpeg 解码 2048x1024 rgb24）
  const baseRaw = Buffer.from(spawnSync(FFMPEG, ['-v', 'error', '-i', BASE_JPG, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 28 }).stdout ?? '');
  if (baseRaw.length !== 2048 * 1024 * 3) throw new Error(`底图解码尺寸异常 ${baseRaw.length}`);
  const sampleBase = (lat, lon, out) => {
    const u = (lon + 180) / 360, v = (lat + 90) / 180;
    const px = Math.min(2047, Math.max(0, Math.floor(u * 2048)));
    const py = Math.min(1023, Math.max(0, Math.floor((1 - v) * 1024)));
    const o = (py * 2048 + px) * 3;
    out[0] = baseRaw[o]; out[1] = baseRaw[o + 1]; out[2] = baseRaw[o + 2];
  };

  // 5) 合成输出 RGB：WAC 灰度 × 增益 → sRGB；外缘羽化混合底图
  const out = Buffer.alloc(W * H * 3);
  const base = [0, 0, 0];
  for (let r = 0; r < H; r++) {
    const lat = latOfRow(row0 + r);
    for (let c = 0; c < W; c++) {
      const lon = lonOfCol(col0 + c);
      const oi = (r * W + c) * 3;
      const v = crop.readFloatLE((r * W + c) * 4);
      let g;
      if (Number.isFinite(v)) g = srgb(clamp01(v * GAIN)) * 255;
      else g = 0; // missing：黑，由 metadata 声明（本窗实测 missing=0）
      // 外缘羽化：距边 FEATHER_DEG 内 smoothstep 混合底图（t: 0=边全底图, 1=内部全 WAC）
      const dEdge = Math.min(lon - lonMin, lonMax - lon, lat - latMin, latMax - lat);
      if (dEdge < FEATHER_DEG) {
        const t = smoothstep(dEdge / FEATHER_DEG);
        sampleBase(lat, lon, base);
        out[oi] = Math.round(base[0] * (1 - t) + g * t);
        out[oi + 1] = Math.round(base[1] * (1 - t) + g * t);
        out[oi + 2] = Math.round(base[2] * (1 - t) + g * t);
      } else {
        const b = Math.round(g);
        out[oi] = b; out[oi + 1] = b; out[oi + 2] = b;
      }
    }
    if ((r & 255) === 0) console.log(`  合成 ${r}/${H}`);
  }

  // 6) 编码 JPG + metadata
  mkdirSync(OUT_DIR, { recursive: true });
  const jpgPath = join(OUT_DIR, 'albedo.jpg');
  const enc = spawnSync(FFMPEG, ['-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-i', '-', '-q:v', '2', '-y', jpgPath], { input: out, maxBuffer: 1 << 24 });
  if (enc.status !== 0) throw new Error(`ffmpeg 编码失败: ${enc.stderr}`);
  const jpg = readFileSync(jpgPath);
  const meta = {
    schemaVersion: 1,
    layerId: 'wac-emp-taurus-v1',
    fidelityClaim: 'measured-imagery',
    sourceProduct: 'WAC_EMP_643NM_E300N0450_304P',
    sourceLabelFile: 'WAC_EMP_643NM_E300N0450_304P.xml (PDS4, version_id 2.0)',
    sourceUrl: 'https://pds.lroc.im-ldi.com/data/LRO-L-WAC-5-RDR-V1.0/LROLRC_2001/DATA/MDR/WAC_EMP/WAC_EMP_643NM_E300N0450_304P.IMG',
    fetchedViaUrl: 'https://pds.mcp.nasa.gov/data/store/img/lunar_reconnaissance_orbiter/pds4/lroc/lro-l-lroc-5-rdr/LROLRC_2001/DATA/MDR/WAC_EMP/WAC_EMP_643NM_E300N0450_304P.IMG',
    licenseNote: 'NASA LRO LROC PDS 公共数据 LRO-L-WAC-5-RDR-V1.0，Arizona State University 制作',
    band: '643nm 单波段（WAC EMP 经验归一化中位数镶嵌，i=30°/e=0°/phase=30°，n≈142）——非肉眼真彩、非 UV 假彩',
    pixelsPerDegree: PPD,
    nativeSpacingMeters: DX_M,
    sourceMd5: SRC_MD5,
    sourceBytes: SRC_BYTES,
    width: W,
    height: H,
    bounds: { lonMin, lonMax, latMin, latMax },
    sampling: '像元中心 lon(col)=col·dx/(R·rad)（col0=0°E）；lat(row)=60°−(row+0.5)/304°；标准纬线 0° 等距圆柱（与 NAC DTM 的 20° 不同，两者各自换算）',
    displayTransform: {
      rule: 'linear reflectance ×gain → sRGB 编码，8-bit 灰度；外缘 0.25° 羽化混合全球底图 lroc_color_2k.jpg',
      gain: Number(GAIN.toFixed(4)),
      gainAnchor: 'NAC 5m 正射窗口显示均值（u16/(p995/255)，与 buildOrthoTexture 同口径）——单一全局标量，无逐瓦片拉伸',
      missing: `源 missing 像元 ${missing} 个（本窗实测${missing === 0 ? '为 0' : '非 0，输出为黑并在此声明'}）`,
    },
    coordinateSystem: 'PLANETOCENTRIC, Positive East, R=1737400 m',
    albedoSha256: sha256(jpg),
    note: 'P3b-C 数据层：中远景反射率近似（可重新照明）；几何仍由 datum 球 + NAC DTM 窗口承担，影像采样 ≠ DEM 格点 ≠ 几何误差（三者分离）',
  };
  writeFileSync(join(OUT_DIR, 'metadata.json'), JSON.stringify(meta, null, 2));
  console.log(`打包完成 -> ${OUT_DIR} (${W}x${H}, ${(jpg.length / 1e6).toFixed(1)} MB jpg)`);
}

try {
  main();
} catch (e) {
  console.error(e);
  process.exit(1);
}
