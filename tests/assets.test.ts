import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { decodeImageMetadata, verifyAndDeployAsset } from '../scripts/verify-assets';
import type { AssetManifest } from '../src/contracts/assets';
import * as THREE from 'three';
import { AssetManager } from '../src/assets/AssetManager';

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

  it('AST-05: 并发加载同一资产严格去重 (In-flight Promise 共享，只触发一次底座 loader)', async () => {
    const mgr = new AssetManager();
    const asset = { id: 'test-tex', localPath: 'assets/textures/test.jpg', colorInterpretation: 'sRGB' as const } as any;
    mgr.registerManifest([asset]);

    const callbacks: Array<(t: THREE.Texture) => void> = [];
    mgr.loader = {
      load(_url: string, onLoad: (t: THREE.Texture) => void) {
        callbacks.push(onLoad);
      },
    };

    const p1 = mgr.loadTexture('test-tex', 1, () => true);
    const p2 = mgr.loadTexture('test-tex', 2, () => true);

    expect(callbacks.length).toBe(1); // 严格去重，仅 1 次底层加载

    const fakeTexture = new THREE.Texture();
    callbacks[0](fakeTexture);

    const [t1, t2] = await Promise.all([p1, p2]);
    expect(t1).toBe(fakeTexture);
    expect(t2).toBe(fakeTexture);
    expect(mgr.getAssetItem('test-tex')?.texture).toBe(fakeTexture);
  });

  it('AST-06: 过时 Token 晚到隔离 (返回 null 防画面污染，但保留就绪缓存供后续调用直接命中)', async () => {
    const mgr = new AssetManager();
    const asset = { id: 'test-stale', localPath: 'assets/textures/test.jpg', colorInterpretation: 'sRGB' as const } as any;
    mgr.registerManifest([asset]);

    let cb: (t: THREE.Texture) => void = () => {};
    mgr.loader = {
      load(_url: string, onLoad: (t: THREE.Texture) => void) {
        cb = onLoad;
      },
    };

    const pStale = mgr.loadTexture('test-stale', 1, (token) => token === 2); // 当前有效 token 已是 2，token 1 已过时
    const fakeTexture = new THREE.Texture();
    cb(fakeTexture);

    const result = await pStale;
    expect(result).toBeNull(); // 过时调用严格返回 null，不给 caller 覆盖相机的机会
    expect(mgr.getAssetItem('test-stale')?.texture).toBe(fakeTexture); // 但全局缓存仍成功就绪

    // 后续新请求以当前有效 token 获取时，直接命中就绪缓存
    const pFresh = await mgr.loadTexture('test-stale', 2, (token) => token === 2);
    expect(pFresh).toBe(fakeTexture);
  });

  it('AST-07: 销毁生命周期隔离 (disposeAsset 与 disposeAll 晚到贴图即刻触发 dispose 并返回 null，杜绝显存泄漏)', async () => {
    const mgr = new AssetManager();
    const asset = { id: 'test-leak', localPath: 'assets/textures/test.jpg', colorInterpretation: 'sRGB' as const } as any;
    mgr.registerManifest([asset]);

    let cb: (t: THREE.Texture) => void = () => {};
    mgr.loader = {
      load(_url: string, onLoad: (t: THREE.Texture) => void) {
        cb = onLoad;
      },
    };

    const promise = mgr.loadTexture('test-leak', 1, () => true);

    // 在网络晚到之前，管理器被全局销毁
    mgr.disposeAll();

    const lateTexture = new THREE.Texture();
    let disposeFired = 0;
    lateTexture.addEventListener('dispose', () => {
      disposeFired++;
    });

    cb(lateTexture);

    const returned = await promise;
    expect(returned).toBeNull();
    expect(disposeFired).toBe(1); // 晚到纹理被立即触发 dispose 释放显存
    expect(mgr.getAssetItem('test-leak')).toBeUndefined();
  });
});
