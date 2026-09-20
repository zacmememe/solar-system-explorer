import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { decodeImageMetadata, verifyAndDeployAsset } from '../scripts/verify-assets';
import type { AssetManifest } from '../src/contracts/assets';

describe('M0 资产门禁与生产清单校验', () => {
  const projectRoot = path.resolve(__dirname, '..');
  const manifestPath = path.join(projectRoot, 'sources', 'production-assets.json');

  it('AST-01: 生产资产清单存在且包含有效地球白昼、夜晚、云层、月球与星空贴图', () => {
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest: AssetManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    expect(manifest.assets.length).toBeGreaterThanOrEqual(5);

    const earthDay = manifest.assets.find((a) => a.id === 'earth-day-sss-2k');
    const earthNight = manifest.assets.find((a) => a.id === 'earth-night-sss-2k');
    const earthClouds = manifest.assets.find((a) => a.id === 'earth-clouds-sss-2k');
    const moon = manifest.assets.find((a) => a.id === 'moon-svs-2025-2k');
    const stars = manifest.assets.find((a) => a.id === 'stars-bg-sss-2k');

    expect(earthDay).toBeDefined();
    expect(earthNight).toBeDefined();
    expect(earthClouds).toBeDefined();
    expect(moon).toBeDefined();
    expect(stars).toBeDefined();

    for (const asset of [earthDay!, earthNight!, earthClouds!, moon!, stars!]) {
      expect(asset.derivedWidth).toBe(2048);
      expect(asset.derivedHeight).toBe(1024);

      const localFile = path.join(projectRoot, 'public', asset.localPath);
      expect(fs.existsSync(localFile)).toBe(true);

      const buffer = fs.readFileSync(localFile);
      const computedSha = crypto.createHash('sha256').update(buffer).digest('hex');
      expect(computedSha).toBe(asset.derivedSha256);
      expect(asset.releaseApproved).toBe(true);
    }
  });

  it('AST-02: 杜绝 HTML 404 错误页冒充图像 (decodeImageMetadata 拦截)', () => {
    const fakeHtmlBuffer = Buffer.from('<!DOCTYPE html><html><head><title>404 Not Found</title></head><body><h1>404</h1></body></html>');
    expect(() => decodeImageMetadata(fakeHtmlBuffer)).toThrow(/HTML 错误页面/);

    const truncatedBuffer = Buffer.from([0xff, 0xd8, 0x00]); // 伪造开头但截断
    expect(() => decodeImageMetadata(truncatedBuffer)).toThrow();
  });

  it('AST-03: 缺失关键授权与来源字段必须被拒绝准入', async () => {
    const invalidTarget = {
      id: 'test-invalid',
      bodyId: 'test',
      role: 'color' as const,
      sourcePage: '',
      sourceAssetUrl: 'https://example.com/fake.jpg',
      relativeTargetPath: 'assets/textures/test.jpg',
      expectedWidth: 100,
      expectedHeight: 100,
      projection: 'equirectangular' as const,
      longitudeConvention: '0-to-360-east' as const,
      centralMeridianDeg: 0,
      northUp: true,
      colorInterpretation: 'sRGB' as const,
      observationBands: ['test'],
      provenanceClass: 'processed-observation' as const,
      coverageNotes: 'test',
      credit: '', // 缺失
      licenseUrl: '', // 缺失
      licenseNotes: '',
    };

    // 哪怕本地有文件，缺失字段也会被 verifyAndDeployAsset 阻断
    await expect(verifyAndDeployAsset(invalidTarget)).rejects.toThrow(/缺少必要的署名/);
  });

  it('AST-04: 所有资产均为本地同源静态文件，无运行时外链依赖', () => {
    const manifest: AssetManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    for (const asset of manifest.assets) {
      expect(asset.localPath.startsWith('assets/')).toBe(true);
      const fullPath = path.join(projectRoot, 'public', asset.localPath);
      expect(fs.existsSync(fullPath)).toBe(true);
    }
  });
});
