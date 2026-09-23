/**
 * P2 数据工具：NAC DTM APOLLO17 远程窗口获取（Node，无新依赖）。
 *
 * 权威参数（已由远端探测核实，2026-09-23）：
 * - DEM  NAC_DTM_APOLLO17.TIF：未压缩 float32 GeoTIFF（Compression=1, RowsPerStrip=1），
 *   11600 行 × 9985 列；ModelPixelScale=(5,5) m；ModelTiepoint：栅格点(0,0)左上角 ↦
 *   图面坐标 (x=−4276880, y=+645990) m；GDAL_NODATA=−3.40282265508890445e38。
 *   图面↔地理（等距圆柱球体 R=1737400，lat0=20°，lon0=180°，y 自赤道）：
 *     xM = R·cos(20°)·(lon−180°)·rad ; yM = R·lat·rad
 * - 正射 NAC_DTM_APOLLO17_MOSAIC_5M.IMG：PDS3 附着标签 1 条记录(RECORD_BYTES=19970)，
 *   ^IMAGE=2 → 数据偏移 19970 B；uint16、行 19970 B、同网格。
 * 服务器支持 Range：仅抓窗口行段。
 *
 * 用法：
 *   node scripts/fetch-apollo17-window.mjs probe   # 打印远端结构
 *   node scripts/fetch-apollo17-window.mjs fetch   # 下载窗口并打包
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const BASE =
  'https://pds.lroc.im-ldi.com/data/LRO-L-LROC-5-RDR-V1.0/LROLRC_2001/DATA/SDP/NAC_DTM/APOLLO17';
// 抓取走 NASA PDS MCP 网关（im-ldi 源站对密集 Range 请求返回 429，网关独立限流，2026-09-23 实测）
const FETCH_BASE =
  'https://pds.mcp.nasa.gov/data/store/img/lunar_reconnaissance_orbiter/pds4/lroc/lro-l-lroc-5-rdr/LROLRC_2001/DATA/SDP/NAC_DTM/APOLLO17';
const DEM_URL = `${FETCH_BASE}/NAC_DTM_APOLLO17.TIF`;
const ORTHO_URL = `${FETCH_BASE}/NAC_DTM_APOLLO17_MOSAIC_5M.IMG`;
const CACHE_DIR = process.env.DEM_CACHE_DIR || 'D:/solar-evidence/data-cache/lroc-apollo17';
const OUT_DIR = 'public/data/dem/apollo17-v1';

const TARGET = { lat: 20.35, lon: 30.78 }; // Taurus-Littrow 站点
const HALF_M = 3000; // 6 km × 6 km 首批小窗口（Pro 规范：覆盖站点 + 南断块山）
const R_MOON = 1737400;
const LAT0_RAD = (20.0 * Math.PI) / 180;

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function fetchRange(url, start, end, tries = 6) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
    if (res.ok === true || res.status === 206) return Buffer.from(await res.arrayBuffer());
    // 429/5xx 退避重试（限流保护）
    if ((res.status === 429 || res.status >= 500) && attempt < tries) {
      const retryAfter = parseFloat(res.headers.get('retry-after') || '0');
      const waitMs = Math.max(retryAfter * 1000, 1500 * attempt * attempt);
      console.log(`  HTTP ${res.status} @${start}，${Math.round(waitMs)}ms 后重试 (${attempt}/${tries})`);
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }
    throw new Error(`${url} range ${start}-${end} -> HTTP ${res.status}`);
  }
}

/** 解析 DEM GeoTIFF 头（0..数据偏移−1），返回仿射与结构 */
async function parseDemGeotiff() {
  const head = await fetchRange(DEM_URL, 0, 93471);
  if (head.toString('ascii', 0, 2) !== 'II') throw new Error('非小端 TIFF');
  const u16 = (o) => head.readUInt16LE(o);
  const u32 = (o) => head.readUInt32LE(o);
  const ifdOff = u32(4);
  const n = u16(ifdOff);
  const sizes = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 11: 4, 12: 8 };
  const out = {};
  let stripOffPtr = 0, stripCntPtr = 0;
  for (let i = 0; i < n; i++) {
    const e = ifdOff + 2 + i * 12;
    const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
    const bytes = (sizes[type] || 1) * count;
    const base = bytes <= 4 ? e + 8 : u32(e + 8);
    if (tag === 256) out.width = u16(base);
    else if (tag === 257) out.height = u16(base);
    else if (tag === 259) out.compression = u16(base);
    else if (tag === 273) stripOffPtr = bytes > 4 ? u32(e + 8) : e + 8;
    else if (tag === 279) stripCntPtr = bytes > 4 ? u32(e + 8) : e + 8;
    else if (tag === 278) out.rowsPerStrip = u32(base);
    else if (tag === 33550) out.pixelScale = Array.from({ length: 3 }, (_, k) => head.readDoubleLE(base + k * 8));
    else if (tag === 33922) out.tiepoint = Array.from({ length: 6 }, (_, k) => head.readDoubleLE(base + k * 8));
    else if (tag === 42113) out.gdalNoData = head.toString('ascii', base, base + count).replace(/\0.*$/, '');
  }
  if (out.compression !== 1 || out.rowsPerStrip !== 1) throw new Error(`结构变化：compression=${out.compression} rowsPerStrip=${out.rowsPerStrip}`);
  // 数据起始偏移以 TIFF StripOffsets[0] 为准（实测 93471，比 PDS 标签 ^IMAGE 的 93472 少 1 字节，
  // 错位 1 字节即产生乱码浮点，2026-09-23 教训）——并抽验条带连续性与字节数
  out.strip0 = u32(stripOffPtr);
  out.rowBytes = u32(stripCntPtr);
  for (const i of [1, 100, out.height - 1]) {
    if (u32(stripOffPtr + i * 4) - out.strip0 !== i * out.rowBytes) {
      throw new Error(`条带不连续 @strip${i}，需逐条带读取`);
    }
  }
  out.noData = parseFloat(out.gdalNoData);
  // 仿射：图面米 = tiepoint.xy + (col,row)·pixelScale.xy（tiepoint 为左上角栅格点(0,0)）
  out.affine = {
    x0: out.tiepoint[3], y0: out.tiepoint[4],
    dx: out.pixelScale[0], dy: -out.pixelScale[1], // 行向下 = y 减小
  };
  return out;
}

/** 地理(度) -> 像元中心坐标（col,row 为连续坐标，0 = 第一像元中心） */
function latLonToPixel(g, latDeg, lonDeg) {
  const rad = Math.PI / 180;
  const xM = g.affine.x0 + g.affine.dx * lonDeg * 0; // placeholder
  const lonToX = (lon) => (R_MOON * Math.cos(LAT0_RAD) * (lon - 180.0) * rad - g.affine.x0) / g.affine.dx;
  const latToY = (lat) => (R_MOON * lat * rad - g.affine.y0) / g.affine.dy;
  // 像元中心：栅格坐标 p 的像元中心在图面 x0 + (p+0.5)·dx
  const col = lonToX(lonDeg) - 0.5;
  const row = latToY(latDeg) - 0.5;
  return { col, row };
}

const pixelToLatLon = (g, col, row) => {
  const rad = Math.PI / 180;
  const xM = g.affine.x0 + (col + 0.5) * g.affine.dx;
  const yM = g.affine.y0 + (row + 0.5) * g.affine.dy;
  return {
    lon: 180.0 + (xM / (R_MOON * Math.cos(LAT0_RAD))) / rad,
    lat: (yM / R_MOON) / rad,
  };
};

/** 解析正射 IMG 头（PDS3 附着标签），返回 {dataOffset, rowBytes, bits, msb, lines, samples} */
async function parseOrthoImg() {
  const head = await fetchRange(ORTHO_URL, 0, 19969); // 标签占第 1 条记录
  const t = head.toString('latin1');
  const num = (re) => { const m = t.match(re); if (!m) throw new Error(`IMG 头缺 ${re}`); return parseFloat(m[1]); };
  const recordBytes = num(/RECORD_BYTES\s*=\s*(\d+)/);
  const mImg = t.match(/\^IMAGE\s*=\s*(\d+)/);
  const mImgBytes = t.match(/\^IMAGE\s*=\s*\("[^"]+"\s*,\s*(\d+)\s*<BYTES>/);
  const dataOffset = mImgBytes ? +mImgBytes[1] : ((+mImg[1]) - 1) * recordBytes;
  const lines = num(/LINES\s*=\s*(\d+)/);
  const samples = num(/LINE_SAMPLES\s*=\s*(\d+)/);
  const bits = num(/SAMPLE_BITS\s*=\s*(\d+)/);
  const stMatch = t.match(/SAMPLE_TYPE\s*=\s*(\S+)/);
  const sampleType = stMatch ? stMatch[1] : 'LSB_UNSIGNED_INTEGER';
  const msb = /MSB/.test(sampleType);
  return { dataOffset, recordBytes, lines, samples, bits, msb, sampleType };
}

async function probe() {
  const g = await parseDemGeotiff();
  console.log('== DEM GeoTIFF ==');
  console.log(JSON.stringify(g, null, 2));
  const tl = pixelToLatLon(g, -0.5, -0.5); // 图像左上角外侧角
  const center00 = pixelToLatLon(g, 0, 0);
  const br = pixelToLatLon(g, g.width - 1, g.height - 1);
  console.log('像元(0,0)中心:', JSON.stringify(center00), ' 末像元中心:', JSON.stringify(br));
  const site = latLonToPixel(g, TARGET.lat, TARGET.lon);
  console.log('站点像元坐标:', JSON.stringify(site));

  console.log('\n== ORTHO IMG ==');
  const o = await parseOrthoImg();
  console.log(JSON.stringify(o, null, 2));
  console.log('正射头 IMAGE 段:\n', head_slice());
  function head_slice() { return '见 parseOrthoImg 已解析字段'; }
}

/** 按连续行块抓取（块内单 Range 请求 + 块间隔，降低请求数防 429） */
async function fetchRows(url, dataOffset, rowStart, rowCount, rowBytes, rowsPerChunk = 100, concurrent = 2) {
  const out = Buffer.alloc(rowCount * rowBytes);
  const chunks = [];
  for (let r = 0; r < rowCount; r += rowsPerChunk) {
    chunks.push({ from: r, count: Math.min(rowsPerChunk, rowCount - r) });
  }
  let idx = 0, doneChunks = 0;
  async function worker() {
    while (idx < chunks.length) {
      const c = chunks[idx++];
      const start = dataOffset + (rowStart + c.from) * rowBytes;
      const length = c.count * rowBytes;
      const buf = await fetchRange(url, start, start + length - 1);
      if (buf.length !== length) throw new Error(`行块 ${rowStart + c.from}: 得到 ${buf.length} B，应为 ${length}`);
      buf.copy(out, c.from * rowBytes);
      doneChunks++;
      console.log(`  行块 ${doneChunks}/${chunks.length} (${c.count} 行/块)`);
      await new Promise((r) => setTimeout(r, 1500)); // 块间温和间隔
    }
  }
  await Promise.all(Array.from({ length: concurrent }, worker));
  return out;
}

async function fetchAll() {
  mkdirSync(CACHE_DIR, { recursive: true });
  const g = await parseDemGeotiff();
  const o = await parseOrthoImg();
  if (o.lines !== g.height || o.samples !== g.width) throw new Error(`正射 ${o.lines}x${o.samples} 与 DEM ${g.height}x${g.width} 网格不一致`);

  const site = latLonToPixel(g, TARGET.lat, TARGET.lon);
  const rad = Math.PI / 180;
  const halfCols = Math.round((HALF_M / (g.affine.dx)) - 0.5); // 图面米/列
  const halfRows = Math.round((HALF_M / (-g.affine.dy)) - 0.5); // 图面米/行（R 米/px）
  const colStart = Math.round(site.col) - halfCols;
  const rowStart = Math.round(site.row) - halfRows;
  const width = halfCols * 2, height = halfRows * 2;
  if (colStart < 0 || rowStart < 0 || colStart + width > g.width || rowStart + height > g.height) throw new Error('窗口越界');
  console.log(`站点像元 ${site.col.toFixed(1)},${site.row.toFixed(1)} -> 窗口列[${colStart},${colStart + width}) 行[${rowStart},${rowStart + height}) ${width}x${height}`);

  // DEM 窗口（整行抓取后切列段）
  console.log(`抓取 DEM 行段 (strip0=${g.strip0}, rowBytes=${g.rowBytes})...`);
  const demRows = await fetchRows(DEM_URL, g.strip0, rowStart, height, g.rowBytes);
  const dem = Buffer.alloc(width * height * 4);
  const valid = Buffer.alloc(width * height);
  let validCount = 0, minH = Infinity, maxH = -Infinity;
  for (let r = 0; r < height; r++) {
    demRows.copy(dem, r * width * 4, colStart * 4, (colStart + width) * 4);
    for (let c = 0; c < width; c++) {
      const v = dem.readFloatLE((r * width + c) * 4);
      const oi = r * width + c;
      if (Number.isFinite(v) && v > -1e38 && v < 1e38) {
        valid[oi] = 1; validCount++;
        if (v < minH) minH = v;
        if (v > maxH) maxH = v;
      } else {
        dem.writeFloatLE(NaN, oi * 4);
      }
    }
  }
  console.log(`DEM 有效 ${validCount}/${width * height}，高程 [${minH.toFixed(2)}, ${maxH.toFixed(2)}] m`);
  // 合理性闸门：月面局部高程应在万米量级内，否则判定字节对齐/解码错误，拒绝打包
  if (validCount === 0 || minH < -20000 || maxH > 20000) {
    throw new Error(`高程范围异常 [${minH}, ${maxH}] —— 疑似偏移/解码错误，未打包`);
  }

  // 正射窗口
  console.log('抓取正射行段...');
  if (o.bits !== 16) throw new Error(`正射 ${o.bits} bit 未预期`);
  const orthoRows = await fetchRows(ORTHO_URL, o.dataOffset, rowStart, height, o.samples * 2);
  const ortho = Buffer.alloc(width * height * 2);
  let oMax = 0, oSum = 0;
  for (let r = 0; r < height; r++) {
    const srcOff = rowStart === 0 ? r * o.samples * 2 : 0; // 每行已单独抓取，直接按行切列段
    for (let c = 0; c < width; c++) {
      const si = r * o.samples * 2 + (colStart + c) * 2;
      const v = o.msb ? orthoRows.readUInt16BE(si) : orthoRows.readUInt16LE(si);
      const oi = (r * width + c) * 2;
      ortho.writeUInt16LE(v, oi);
      if (valid[r * width + c]) { if (v > oMax) oMax = v; oSum += v; }
    }
  }
  console.log(`正射 I/F 最大 ${oMax}，有效均值 ${(oSum / Math.max(1, validCount)).toFixed(1)}`);

  // 打包（pack-dem.py 语义：float32-LE + valid.u8 + metadata.json，含溯源与仿射）
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(CACHE_DIR, `dem-window-r${rowStart}-c${colStart}-${width}x${height}.f32`), dem);
  writeFileSync(join(OUT_DIR, 'height.f32'), dem);
  writeFileSync(join(OUT_DIR, 'valid.u8'), valid);
  writeFileSync(join(OUT_DIR, 'ortho.u16'), ortho);
  const first = pixelToLatLon(g, colStart, rowStart);
  const meta = {
    schemaVersion: 1,
    admissionState: 'requires-source-and-registration-review',
    fidelityClaim: 'measured-dem',
    sourceUrl: `${BASE}/NAC_DTM_APOLLO17.TIF`,
    fetchedViaUrl: DEM_URL,
    sourceLabelUrl: `${BASE}/NAC_DTM_APOLLO17.LBL`,
    sourceReadmeUrl: `${BASE}/NAC_DTM_APOLLO17_README.TXT`,
    sourceFile: 'NAC_DTM_APOLLO17.TIF',
    sourceVersion: 'P1.9 (PDS3 PRODUCT_VERSION_ID v1.9, PRODUCT_CREATION_TIME 2020-10-13)',
    licenseNote: 'NASA LRO LROC PDS 公共数据 LRO-L-LROC-5-RDR-V1.0，Arizona State University 制作',
    verticalDatum: '参考球体半径 1737400 m (LBL a=b=c)；与 LOLA 拟合 RMS 1.77 m；SOCET SET 报告精度 2.55 m',
    nativeSpacingMeters: 5.0,
    width, height,
    projection: {
      type: 'EQUIRECTANGULAR', coordinateSystem: 'PLANETOCENTRIC', positiveLongitude: 'EAST',
      referenceRadiusM: R_MOON, centerLatitudeDeg: 20.0, centerLongitudeDeg: 180.0,
      note: 'yM 自赤道起算：xM=R·cos(20°)·(lon−180°)·rad，yM=R·lat·rad（GeoTIFF ModelTiepoint/PixelScale 反解核实）',
    },
    pixelCornerAffine: {
      rule: '图面米(列角,行角) = (x0 + col·dx, y0 + row·dy)',
      x0: g.affine.x0, y0: g.affine.y0, dx: g.affine.dx, dy: g.affine.dy,
    },
    sampleCenterRule: '像元中心 = pixelCornerAffine(col+0.5, row+0.5)，再按 projection 公式转经纬',
    window: { colStart, rowStart, width, height },
    sourceStrip0: g.strip0,
    sourceRowBytes: g.rowBytes,
    windowFirstSampleCenter: { latDeg: first.lat, lonDeg: first.lon },
    sourceNoDataValue: g.noData,
    format: 'float32-le',
    units: 'metres above sphere radius 1737400 m',
    noData: 'NaN',
    validSampleCount: validCount,
    minimumHeightM: minH,
    maximumHeightM: maxH,
    ortho: {
      file: 'ortho.u16', format: 'uint16-le I/F',
      sourceUrl: `${BASE}/NAC_DTM_APOLLO17_MOSAIC_5M.IMG`, fetchedViaUrl: ORTHO_URL, sampleType: o.sampleType,
      sameGridAsDem: true,
      note: 'README: 正射不含 scale/offset 地理标签；网格与 DEM 对齐（LBL 与尺寸核实）',
    },
    heightSha256: sha256(dem),
    validSha256: sha256(valid),
    orthoSha256: sha256(ortho),
    warning: 'No reprojection or vertical datum conversion was performed. Native sampling is not vertical accuracy.',
  };
  writeFileSync(join(OUT_DIR, 'metadata.json'), JSON.stringify(meta, null, 2));
  console.log(`打包完成 -> ${OUT_DIR}`);
  // 打包后自校验（独立远程复读）：通过才算数据可用
  console.log('打包后自校验（6 像元远程独立复读）...');
  await selfVerify(g, colStart, rowStart, width, height);
}

/** 打包后自校验：随机抽 6 个窗口像元，独立远程复读原始字节比对（防网关缓存内容错位） */
async function selfVerify(g, colStart, rowStart, width, height) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    pts.push({
      col: colStart + Math.floor((i + 0.5) * (width / 6)),
      row: rowStart + Math.floor(((i * 7) % 6 + 0.5) * (height / 6)),
    });
  }
  for (const p of pts) {
    const offset = g.strip0 + p.row * g.rowBytes + p.col * 4;
    const buf = await fetchRange(DEM_URL, offset, offset + 3);
    const remote = buf.readFloatLE(0);
    const packed = await import('node:fs').then((fs) =>
      fs.readFileSync(join(OUT_DIR, 'height.f32')).readFloatLE(((p.row - rowStart) * width + (p.col - colStart)) * 4)
    );
    const ok = Number.isFinite(packed) ? Math.abs(remote - packed) < 1e-6 : packed !== packed;
    console.log(`  自校验像元 (col ${p.col}, row ${p.row}): remote=${remote.toFixed(3)} packed=${Number.isFinite(packed) ? packed.toFixed(3) : 'NaN'} ${ok ? '✓' : '✗ MISMATCH'}`);
    if (!ok) throw new Error('自校验失败：远端复读与打包值不一致——疑似网关内容错位，请重试整个抓取');
  }
}

/** 本地整文件裁窗打包（整文件单流下载后使用；Range 拼装已被证实不可靠，见 2026-09-24 调查） */
async function packLocal() {
  const fs = await import('node:fs');
  const tifPath = join(CACHE_DIR, 'NAC_DTM_APOLLO17.TIF');
  const imgPath = join(CACHE_DIR, 'NAC_DTM_APOLLO17_MOSAIC_5M.IMG');
  for (const p of [tifPath, imgPath]) {
    if (!fs.existsSync(p)) throw new Error(`缺少本地整文件 ${p}（先完成整文件下载）`);
  }
  const tifSize = fs.statSync(tifPath).size;
  if (tifSize !== 463397471) throw new Error(`TIF 尺寸 ${tifSize} ≠ 期望 463397471`);
  const imgSize = fs.statSync(imgPath).size;
  if (imgSize !== 231671970) throw new Error(`IMG 尺寸 ${imgSize} ≠ 期望 231671970`);

  // 从本地 TIF 头解析结构（同网络 probe 的解析逻辑）
  const fh = fs.openSync(tifPath, 'r');
  const head = Buffer.alloc(93472);
  fs.readSync(fh, head, 0, 93472, 0);
  const u16 = (o) => head.readUInt16LE(o);
  const u32 = (o) => head.readUInt32LE(o);
  const ifdOff = u32(4);
  const n = u16(ifdOff);
  const sizes = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 11: 4, 12: 8 };
  const g = { width: 0, height: 0, compression: 0, rowsPerStrip: 0, strip0: 0, rowBytes: 0 };
  let stripOffPtr = 0;
  let pixelScale = null, tiepoint = null;
  for (let i = 0; i < n; i++) {
    const e = ifdOff + 2 + i * 12;
    const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
    const bytes = (sizes[type] || 1) * count;
    const base = bytes <= 4 ? e + 8 : u32(e + 8);
    if (tag === 256) g.width = u16(base);
    else if (tag === 257) g.height = u16(base);
    else if (tag === 259) g.compression = u16(base);
    else if (tag === 273) stripOffPtr = u32(e + 8);
    else if (tag === 278) g.rowsPerStrip = u32(base);
    else if (tag === 33550) pixelScale = Array.from({ length: 3 }, (_, k) => head.readDoubleLE(base + k * 8));
    else if (tag === 33922) tiepoint = Array.from({ length: 6 }, (_, k) => head.readDoubleLE(base + k * 8));
  }
  g.strip0 = u32(stripOffPtr);
  g.rowBytes = g.width * 4;
  if (g.compression !== 1 || g.rowsPerStrip !== 1 || g.strip0 !== 93471) {
    throw new Error(`本地 TIF 结构异常: compression=${g.compression} rowsPerStrip=${g.rowsPerStrip} strip0=${g.strip0}`);
  }
  g.pixelScale = pixelScale;
  g.tiepoint = tiepoint;
  g.affine = { x0: tiepoint[3], y0: tiepoint[4], dx: pixelScale[0], dy: -pixelScale[1] };
  g.noData = -3.4028226550889045e38;
  console.log(`本地 TIF 结构 OK: ${g.width}x${g.height} strip0=${g.strip0}`);

  const site = latLonToPixel(g, TARGET.lat, TARGET.lon);
  const halfCols = Math.round(HALF_M / g.affine.dx - 0.5);
  const halfRows = Math.round(HALF_M / -g.affine.dy - 0.5);
  const colStart = Math.round(site.col) - halfCols;
  const rowStart = Math.round(site.row) - halfRows;
  const width = halfCols * 2, height = halfRows * 2;
  console.log(`窗口: 列[${colStart},${colStart + width}) 行[${rowStart},${rowStart + height}) ${width}x${height}`);

  // 逐行直读本地 TIF（带位置 readSync，不整载内存）
  const dem = Buffer.alloc(width * height * 4);
  const valid = Buffer.alloc(width * height);
  const rowBuf = Buffer.alloc(g.rowBytes);
  let validCount = 0, minH = Infinity, maxH = -Infinity;
  for (let r = 0; r < height; r++) {
    const pos = g.strip0 + (rowStart + r) * g.rowBytes;
    fs.readSync(fh, rowBuf, 0, g.rowBytes, pos);
    for (let c = 0; c < width; c++) {
      const v = rowBuf.readFloatLE((colStart + c) * 4);
      const oi = r * width + c;
      if (Number.isFinite(v) && v > -1e38 && v < 1e38) {
        valid[oi] = 1; validCount++;
        dem.writeFloatLE(v, oi * 4);
        if (v < minH) minH = v;
        if (v > maxH) maxH = v;
      } else {
        dem.writeFloatLE(NaN, oi * 4);
      }
    }
    if ((r + 1) % 300 === 0) console.log(`  行 ${r + 1}/${height}`);
  }
  fs.closeSync(fh);
  console.log(`DEM 有效 ${validCount}/${width * height}，高程 [${minH.toFixed(2)}, ${maxH.toFixed(2)}] m`);
  if (validCount === 0 || minH < -20000 || maxH > 20000) throw new Error('高程范围异常，拒绝打包');

  // 正射：IMG 头 1 条记录 + uint16 同网格
  const ofh = fs.openSync(imgPath, 'r');
  const oHead = Buffer.alloc(19970);
  fs.readSync(ofh, oHead, 0, 19970, 0);
  const oText = oHead.toString('latin1');
  const oSamples = parseInt(oText.match(/LINE_SAMPLES\s*=\s*(\d+)/)[1], 10);
  const oLines = parseInt(oText.match(/LINES\s*=\s*(\d+)/)[1], 10);
  if (oSamples !== g.width || oLines !== g.height) throw new Error('正射网格与 DEM 不一致');
  const oRowBytes = oSamples * 2;
  const ortho = Buffer.alloc(width * height * 2);
  const oRowBuf = Buffer.alloc(oRowBytes);
  let oMax = 0, oSum = 0;
  for (let r = 0; r < height; r++) {
    fs.readSync(ofh, oRowBuf, 0, oRowBytes, 19970 + (rowStart + r) * oRowBytes);
    for (let c = 0; c < width; c++) {
      const v = oRowBuf.readUInt16LE((colStart + c) * 2);
      ortho.writeUInt16LE(v, (r * width + c) * 2);
      if (valid[r * width + c]) { if (v > oMax) oMax = v; oSum += v; }
    }
  }
  fs.closeSync(ofh);
  console.log(`正射 I/F 最大 ${oMax}，有效均值 ${(oSum / Math.max(1, validCount)).toFixed(1)}`);

  // 全文件溯源哈希（一次性）
  console.log('计算全文件 SHA-256（溯源）...');
  const hashFile = (p) => new Promise((res, rej) => {
    const h = createHash('sha256');
    const s = fs.createReadStream(p);
    s.on('data', (d) => h.update(d));
    s.on('end', () => res(h.digest('hex')));
    s.on('error', rej);
  });
  const tifSha = await hashFile(tifPath);
  const imgSha = await hashFile(imgPath);

  mkdirSync(OUT_DIR, { recursive: true });
  // 重新打包意味着数据指纹变化：清除旧准入记录，恢复 requires-review 门槛
  const admPath = join(OUT_DIR, 'admission.json');
  if (fs.existsSync(admPath)) fs.unlinkSync(admPath);
  writeFileSync(join(OUT_DIR, 'height.f32'), dem);
  writeFileSync(join(OUT_DIR, 'valid.u8'), valid);
  writeFileSync(join(OUT_DIR, 'ortho.u16'), ortho);
  const first = pixelToLatLon(g, colStart, rowStart);
  const meta = {
    schemaVersion: 2,
    admissionState: 'requires-source-and-registration-review',
    fidelityClaim: 'measured-dem',
    sourceUrl: `${BASE}/NAC_DTM_APOLLO17.TIF`,
    fetchedViaUrl: DEM_URL,
    sourceLabelUrl: `${BASE}/NAC_DTM_APOLLO17.LBL`,
    sourceReadmeUrl: `${BASE}/NAC_DTM_APOLLO17_README.TXT`,
    sourceFile: 'NAC_DTM_APOLLO17.TIF',
    sourceFileSha256: tifSha,
    orthoSourceFileSha256: imgSha,
    sourceVersion: 'P1.9 (PDS3 PRODUCT_VERSION_ID v1.9, PRODUCT_CREATION_TIME 2020-10-13)',
    licenseNote: 'NASA LRO LROC PDS 公共数据 LRO-L-LROC-5-RDR-V1.0，Arizona State University 制作',
    verticalDatum: '参考球体半径 1737400 m (LBL a=b=c)；与 LOLA 拟合 RMS 1.77 m；SOCET SET 报告精度 2.55 m',
    nativeSpacingMeters: 5.0,
    width, height,
    projection: {
      type: 'EQUIRECTANGULAR', coordinateSystem: 'PLANETOCENTRIC', positiveLongitude: 'EAST',
      referenceRadiusM: R_MOON, centerLatitudeDeg: 20.0, centerLongitudeDeg: 180.0,
      note: 'yM 自赤道起算：xM=R·cos(20°)·(lon−180°)·rad，yM=R·lat·rad（GeoTIFF ModelTiepoint/PixelScale 反解核实）',
    },
    pixelCornerAffine: {
      rule: '图面米(列角,行角) = (x0 + col·dx, y0 + row·dy)',
      x0: g.affine.x0, y0: g.affine.y0, dx: g.affine.dx, dy: g.affine.dy,
    },
    sampleCenterRule: '像元中心 = pixelCornerAffine(col+0.5, row+0.5)，再按 projection 公式转经纬',
    window: { colStart, rowStart, width, height },
    sourceStrip0: g.strip0,
    sourceRowBytes: g.rowBytes,
    windowFirstSampleCenter: { latDeg: first.lat, lonDeg: first.lon },
    sourceNoDataValue: g.noData,
    format: 'float32-le',
    units: 'metres above sphere radius 1737400 m',
    noData: 'NaN',
    validSampleCount: validCount,
    minimumHeightM: minH,
    maximumHeightM: maxH,
    ortho: {
      file: 'ortho.u16', format: 'uint16-le I/F',
      sourceUrl: `${BASE}/NAC_DTM_APOLLO17_MOSAIC_5M.IMG`, fetchedViaUrl: ORTHO_URL,
      sampleType: 'LSB_INTEGER',
      sameGridAsDem: true,
      note: 'README: 正射不含 scale/offset 地理标签；网格与 DEM 对齐（LBL 与尺寸核实）',
    },
    heightSha256: sha256(dem),
    validSha256: sha256(valid),
    orthoSha256: sha256(ortho),
    warning: 'No reprojection or vertical datum conversion was performed. Native sampling is not vertical accuracy. 2026-09-24: 网关大块 Range 拼装被证实内容漂移，本包由整文件单流下载后本地裁窗生成。',
  };
  writeFileSync(join(OUT_DIR, 'metadata.json'), JSON.stringify(meta, null, 2));
  console.log(`打包完成 -> ${OUT_DIR}`);

  // 自校验：本地整文件复读（应当逐位一致）+ 远程小范围独立读数（外部真值）
  console.log('自校验（本地整文件复读 + 远程 4 字节独立读数）...');
  const fh2 = fs.openSync(tifPath, 'r');
  const probe = Buffer.alloc(4);
  for (let i = 0; i < 6; i++) {
    const col = colStart + Math.floor((i + 0.5) * (width / 6));
    const row = rowStart + Math.floor(((i * 7) % 6 + 0.5) * (height / 6));
    fs.readSync(fh2, probe, 0, 4, g.strip0 + row * g.rowBytes + col * 4);
    const localVal = probe.readFloatLE(0);
    const packedVal = dem.readFloatLE(((row - rowStart) * width + (col - colStart)) * 4);
    const remote = await (async () => {
      const off = g.strip0 + row * g.rowBytes + col * 4;
      return (await fetchRange(DEM_URL, off, off + 3)).readFloatLE(0);
    })();
    const ok = Math.abs(localVal - packedVal) < 1e-9 && Math.abs(remote - localVal) < 1e-6;
    console.log(`  (col ${col}, row ${row}): local=${localVal.toFixed(3)} packed=${packedVal.toFixed(3)} remote=${remote.toFixed(3)} ${ok ? '✓' : '✗'}`);
    if (!ok) throw new Error('自校验失败');
  }
  fs.closeSync(fh2);
  console.log('自校验全部通过 ✓');
}

const mode = process.argv[2] || 'probe';
(mode === 'probe' ? probe() : mode === 'pack-local' ? packLocal() : fetchAll()).catch((e) => { console.error(e); process.exit(1); });
