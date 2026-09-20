import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { decodeImageMetadata, verifyAndDeployAsset } from '../scripts/verify-assets';
import type { AssetManifest } from '../src/contracts/assets';

describe('M0 资产门禁与生产清单校验', () => {
  const projectRoot = path.resolve(__dirname, '..');
  const manifestPath = path.join(projectRoot, 'sources', 'production-assets.json');

  it('AST-01: 生产资产清单存在且包含有效地球与月球贴图', () => {
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifest: AssetManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    expect(manifest.assets.length).toBeGreaterThanOrEqual(2);

    const earth = manifest.assets.find((a) => a.bodyId === 'earth');
    const moon = manifest.assets.find((a) => a.bodyId === 'moon');

    expect(earth).toBeDefined();
    expect(moon).toBeDefined();

    expect(earth?.derivedWidth).toBe(2048);
    expect(earth?.derivedHeight).toBe(1024);
    expect(moon?.derivedWidth).toBe(2048);
    expect(moon?.derivedHeight).toBe(1024);

    // 检查本地文件是否真实存在且哈希一致
    for (const asset of [earth!, moon!]) {
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
