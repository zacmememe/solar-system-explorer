import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as https from 'https';
import * as http from 'http';
import { fileURLToPath } from 'url';
import type { ProductionTextureAsset, AssetManifest } from '../src/contracts/assets';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ImageMetadata {
  format: 'jpeg' | 'png' | 'unknown';
  width: number;
  height: number;
  channels: number;
  sha256: string;
  byteLength: number;
}

/**
 * 从二进制流解析真实图像尺寸与通道，杜绝 HTML 假文件
 */
export function decodeImageMetadata(buffer: Buffer): ImageMetadata {
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const byteLength = buffer.length;

  if (buffer.length < 16) {
    throw new Error(`文件字节过短（${buffer.length} 字节），非有效图像文件`);
  }

  // 检查是否为 HTML 错误页
  const headStr = buffer.slice(0, 100).toString('utf8').trim().toLowerCase();
  if (headStr.startsWith('<!doctype html') || headStr.startsWith('<html') || headStr.includes('404 not found') || headStr.includes('<head>')) {
    throw new Error('下载内容实际为 HTML 错误页面，非有效图像');
  }

  // 1. JPEG 格式解析 (SOI: 0xFF 0xD8)
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = buffer[offset + 1];
      // SOF0 (0xC0) 到 SOF2 (0xC2) 包含图像尺寸
      if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
        const height = buffer.readUInt16BE(offset + 5);
        const width = buffer.readUInt16BE(offset + 7);
        const channels = buffer[offset + 9];
        return {
          format: 'jpeg',
          width,
          height,
          channels,
          sha256,
          byteLength,
        };
      }
      // 跳过当前 marker 块
      if (marker === 0xd9 || marker === 0xda) {
        // SOS 或 EOI
        break;
      }
      const length = buffer.readUInt16BE(offset + 2);
      offset += 2 + length;
    }
    throw new Error('未能从 JPEG 文件中找到有效的 SOF 标头');
  }

  // 2. PNG 格式解析 (\x89PNG\r\n\x1a\n)
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    // IHDR 块位于 offset 8 (length: 4, type: 4, data: 13)
    const chunkType = buffer.slice(12, 16).toString('ascii');
    if (chunkType === 'IHDR') {
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      const colorType = buffer[25];
      let channels = 3;
      if (colorType === 0) channels = 1; // Grayscale
      else if (colorType === 2) channels = 3; // Truecolor (RGB)
      else if (colorType === 3) channels = 1; // Indexed
      else if (colorType === 4) channels = 2; // Grayscale + Alpha
      else if (colorType === 6) channels = 4; // Truecolor + Alpha

      return {
        format: 'png',
        width,
        height,
        channels,
        sha256,
        byteLength,
      };
    }
  }

  throw new Error('不支持或未知的文件格式（非有效 JPEG 或 PNG）');
}

/**
 * 带有超时与重定向支持的安全下载
 */
export async function downloadBuffer(urlStr: string, timeoutMs: number = 30000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const client = url.protocol === 'https:' ? https : http;

    const req = client.get(
      urlStr,
      {
        headers: {
          'User-Agent': 'SolarExplorer-AssetPipeline/1.0 (Educational Parent-Child Astronomy Project; Windows 11)',
          'Accept': 'image/jpeg,image/png,image/*;q=0.9,*/*;q=0.5',
        },
        timeout: timeoutMs,
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          // 处理重定向
          const redirectUrl = new URL(res.headers.location, urlStr).toString();
          downloadBuffer(redirectUrl, timeoutMs).then(resolve).catch(reject);
          return;
        }

        if (res.statusCode !== 200) {
          reject(new Error(`HTTP 下载失败，状态码: ${res.statusCode} (${res.statusMessage}) from ${urlStr}`));
          return;
        }

        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', (err) => reject(err));
      }
    );

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`请求超时（>${timeoutMs}ms）: ${urlStr}`));
    });

    req.on('error', (err) => reject(err));
  });
}

/**
 * 生产资产校验与生产清单生成
 */
export async function verifyAndDeployAsset(target: {
  id: string;
  bodyId: string;
  role: ProductionTextureAsset['role'];
  sourcePage: string;
  sourceAssetUrl: string;
  relativeTargetPath: string;
  expectedWidth: number;
  expectedHeight: number;
  projection: ProductionTextureAsset['projection'];
  longitudeConvention: ProductionTextureAsset['longitudeConvention'];
  centralMeridianDeg: number | null;
  northUp: boolean;
  colorInterpretation: ProductionTextureAsset['colorInterpretation'];
  observationBands: string[];
  provenanceClass: ProductionTextureAsset['provenanceClass'];
  coverageNotes: string;
  credit: string;
  licenseUrl: string;
  licenseNotes: string;
}): Promise<ProductionTextureAsset> {
  // 严格检查必要授权与说明字段（AST-03）
  if (!target.credit || !target.licenseUrl || !target.sourcePage) {
    throw new Error(`资产 ${target.id} 缺少必要的署名 (credit) 或授权许可 (licenseUrl) 字段，拒绝准入生产！`);
  }

  const projectRoot = path.resolve(__dirname, '..');
  const targetFullPath = path.join(projectRoot, 'public', target.relativeTargetPath);
  const targetDir = path.dirname(targetFullPath);

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  let buffer: Buffer;

  // 如果本地已有且已验证，可以复用；否则从网络下载
  if (fs.existsSync(targetFullPath)) {
    console.log(`[Asset Pipeline] 检查本地缓存文件: ${target.relativeTargetPath}`);
    buffer = fs.readFileSync(targetFullPath);
  } else {
    console.log(`[Asset Pipeline] 开始下载: ${target.sourceAssetUrl}`);
    buffer = await downloadBuffer(target.sourceAssetUrl);
    fs.writeFileSync(targetFullPath, buffer);
    console.log(`[Asset Pipeline] 已写入本地: ${targetFullPath}`);
  }

  // 解码验证
  const meta = decodeImageMetadata(buffer);
  console.log(`[Asset Pipeline] 真实解码结果: ${meta.format.toUpperCase()} ${meta.width}x${meta.height}, 通道: ${meta.channels}, SHA-256: ${meta.sha256}`);

  if (meta.width !== target.expectedWidth || meta.height !== target.expectedHeight) {
    throw new Error(
      `尺寸不匹配！期望 ${target.expectedWidth}x${target.expectedHeight}，实际为 ${meta.width}x${meta.height}`
    );
  }


  return {
    id: target.id,
    bodyId: target.bodyId,
    role: target.role,
    sourcePage: target.sourcePage,
    sourceAssetUrl: target.sourceAssetUrl,
    localPath: target.relativeTargetPath.replace(/\\/g, '/'),
    sourceSha256: meta.sha256,
    derivedSha256: meta.sha256,
    originalWidth: meta.width,
    originalHeight: meta.height,
    derivedWidth: meta.width,
    derivedHeight: meta.height,
    projection: target.projection,
    longitudeConvention: target.longitudeConvention,
    centralMeridianDeg: target.centralMeridianDeg,
    northUp: target.northUp,
    colorInterpretation: target.colorInterpretation,
    observationBands: target.observationBands,
    provenanceClass: target.provenanceClass,
    coverageNotes: target.coverageNotes,
    processingHistory: [`Verified and stored by verify-assets pipeline at ${new Date().toISOString()}`],
    credit: target.credit,
    licenseUrl: target.licenseUrl,
    licenseNotes: target.licenseNotes,
    releaseApproved: true,
  };
}

/**
 * 主执行流程（M0：仅核验地球与月球 2K 贴图）
 */
export async function main() {
  console.log('====================================================');
  console.log('🚀 太阳系漫游资产门禁系统：M0 地球/月球核验');
  console.log('====================================================');

  const targets = [
    {
      id: 'earth-day-sss-2k',
      bodyId: 'earth',
      role: 'color' as const,
      sourcePage: 'https://www.solarsystemscope.com/textures/',
      sourceAssetUrl: 'https://www.solarsystemscope.com/textures/download/2k_earth_daymap.jpg',
      relativeTargetPath: 'assets/textures/earth/2k_earth_daymap.jpg',
      expectedWidth: 2048,
      expectedHeight: 1024,
      projection: 'equirectangular' as const,
      longitudeConvention: '0-to-360-east' as const,
      centralMeridianDeg: 0,
      northUp: true,
      colorInterpretation: 'sRGB' as const,
      observationBands: ['visible-light-reconstructed'],
      provenanceClass: 'observation-derived-visualization' as const,
      coverageNotes: '全球圆柱投影白昼图，基于 NASA 观测加工，部分缺口补绘。非实时天气。',
      credit: 'Solar System Scope / INOVE',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      licenseNotes: 'CC BY 4.0 商业与非商业可用，需保留署名。',
    },
    {
      id: 'moon-svs-2025-2k',
      bodyId: 'moon',
      role: 'color' as const,
      sourcePage: 'https://svs.gsfc.nasa.gov/4720/',
      sourceAssetUrl: 'https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_2k.jpg',
      relativeTargetPath: 'assets/textures/moon/lroc_color_2k.jpg',
      expectedWidth: 2048,
      expectedHeight: 1024,
      projection: 'equirectangular' as const,
      longitudeConvention: '0-to-360-east' as const,
      centralMeridianDeg: 0,
      northUp: true,
      colorInterpretation: 'sRGB' as const,
      observationBands: ['visible-color-lroc-wac'],
      provenanceClass: 'processed-observation' as const,
      coverageNotes: 'NASA LRO 探测器相机全球多光谱正射拼图（CGI Moon Kit 2025版）。真实观测拼接。',
      credit: 'NASA / GSFC / Arizona State University',
      licenseUrl: 'https://www.nasa.gov/nasa-brand-center/images-and-media/',
      licenseNotes: 'NASA 媒体公开使用指南，教育与非商业公共使用。',
    },
  ];

  const verifiedAssets: ProductionTextureAsset[] = [];

  for (const t of targets) {
    try {
      console.log(`\n---> 开始核验天体: [${t.bodyId}] (${t.id})`);
      const asset = await verifyAndDeployAsset(t);
      verifiedAssets.push(asset);
      console.log(`✅ [${t.bodyId}] 核验成功并已发布准入！`);
    } catch (err: any) {
      console.error(`❌ [${t.bodyId}] 核验失败:`, err.message);
      process.exit(1);
    }
  }

  const manifest: AssetManifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    assets: verifiedAssets,
  };

  const projectRoot = path.resolve(__dirname, '..');
  const manifestPath = path.join(projectRoot, 'sources', 'production-assets.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`\n📄 生产资产清单已生成: ${manifestPath}`);
  console.log(`🎉 M0 资产核验全部通过！共计 ${verifiedAssets.length} 件资产准入。`);
}

if (process.argv[1] && process.argv[1].endsWith('verify-assets.ts')) {
  main().catch((e) => {
    console.error('Fatal error:', e);
    process.exit(1);
  });
}
