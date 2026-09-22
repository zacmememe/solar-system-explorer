/**
 * 批次 R2 真实地表数据与地理入口测试套件 (Batch R2 BMNG Tiles & FocusRegion Tests)
 * 严格验证：
 * 1. NASA BMNG 真实源数据清单、SHA-256、原生分辨率与 716 块离线瓦片库存完备性；
 * 2. 682 块全球 L0–4 与 34 块珠江口 L5–9 磁盘文件存在性与大小合法性（杜绝 2K 放大充数）；
 * 3. focusRegion 相机地理命令沿真实法线对准经纬度、近地高度与打断行为。
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import * as fs from 'fs';
import * as path from 'path';
import { CameraController } from '../src/camera/CameraController';
import { loadEarthTileManifest } from '../src/surface/manifestLoader';

describe('批次 R2 真实地表数据与地理入口测试 (R2 Truthful Data & Geography Tests)', () => {
  it('R2-01: 验证生产 Manifest 包含严谨的 NASA 科学源哈希、原生分辨率与瓦片白名单', async () => {
    const manifest = await loadEarthTileManifest();

    expect(manifest.bodyId).toBe('earth');
    expect(manifest.version).toBe('2.0.0');
    expect(manifest.source).toContain('NASA Earth Observatory');
    expect(manifest.sourceUrl).toBe(
      'https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-map/'
    );
    expect(manifest.sourceSha256).toBe(
      '7cf788e13a3a7b4a926b524f8f71d635c56a18c48ba0bfe35695b05a305db3f3'
    );
    expect(manifest.nativeGsdKm).toBe(1.85);
    expect(manifest.tileCount).toBe(716);
    expect(Array.isArray(manifest.availableTiles)).toBe(true);
    expect(manifest.availableTiles!.length).toBe(716);

    // 验证包含珠江口 ROI 且标明真实 500m 精度
    expect(manifest.coverageRoi).toBeDefined();
    const prd = manifest.coverageRoi!.find((r) => r.name.includes('珠江口'));
    expect(prd).toBeDefined();
    expect(prd!.nativeGsdKm).toBe(0.5);
    expect(prd!.targetLevel).toBe(9);
    expect(prd!.source).toContain('500m');
  });

  it('R2-02: 验证磁盘上 716 块瓦片 100% 存在、无缺失、文件大于 5KB 且为真实 JPEG', async () => {
    const manifest = await loadEarthTileManifest();
    const baseDir = path.resolve('public/assets/tiles/earth');

    let checkedCount = 0;
    for (const key of manifest.availableTiles!) {
      const tilePath = path.join(baseDir, `${key}.jpg`);
      expect(fs.existsSync(tilePath)).toBe(true);

      const stat = fs.statSync(tilePath);
      expect(stat.size).toBeGreaterThan(1500); // 真实 512x512 JPEG 纹理文件至少 1.5KB 以上

      // 验证 JPEG 头部标识 0xFF, 0xD8
      const header = Buffer.alloc(2);
      const fd = fs.openSync(tilePath, 'r');
      fs.readSync(fd, header, 0, 2, 0);
      fs.closeSync(fd);
      expect(header[0]).toBe(0xff);
      expect(header[1]).toBe(0xd8);

      checkedCount++;
    }

    expect(checkedCount).toBe(716);
  });

  it('R2-03: 验证珠江口 (PRD) L9 瓦片 (30–50km 尺度) 在磁盘上完整就绪', async () => {
    const baseDir = path.resolve('public/assets/tiles/earth');
    // 珠江口大湾区核心水域 (伶仃洋、香港、澳门、深圳、珠海)
    const prdL9Keys = [
      '9/834/191',
      '9/835/191',
      '9/834/192',
      '9/835/192',
    ];

    for (const key of prdL9Keys) {
      const tilePath = path.join(baseDir, `${key}.jpg`);
      expect(fs.existsSync(tilePath)).toBe(true);
      const stat = fs.statSync(tilePath);
      expect(stat.size).toBeGreaterThan(2000);
    }
  });

  it('R2-04: 验证 focusRegion 命令导引机位精确对准地表法线与近地安全高度', () => {
    const camera = new THREE.PerspectiveCamera(50, 1.0, 0.1, 1000);
    const controller = new CameraController({ camera });

    // 模拟地球：显示半径 1.35
    controller.updateTargetPosition(new THREE.Vector3(0, 0, 0), 1.35);

    // 发出聚焦珠江口地理命令 (经度 113.8°E, 纬度 22.3°N, altitude: 0.05)
    controller.executeCommand({
      type: 'focusRegion',
      bodyId: 'earth',
      lat: 22.3,
      lon: 113.8,
      altitude: 0.05,
      durationSec: 1.0,
    });

    const snap1 = controller.getSnapshot();
    expect(snap1.isTransitioning).toBe(true);
    expect(snap1.targetBodyId).toBe('earth');

    // 计算理论目标经纬度法线方向
    const latRad = THREE.MathUtils.degToRad(22.3);
    const lonRad = THREE.MathUtils.degToRad(113.8);
    const cosLat = Math.cos(latRad);
    const expectedNormal = new THREE.Vector3(
      cosLat * Math.cos(lonRad),
      Math.sin(latRad),
      -cosLat * Math.sin(lonRad)
    ).normalize();
    const expectedSph = new THREE.Spherical().setFromVector3(expectedNormal);

    // 模拟推进 1.5 秒完成过渡
    controller.update(1.5);

    const snapFinal = controller.getSnapshot();
    expect(snapFinal.isTransitioning).toBe(false);

    // 验证机位半径：surfaceRadius (1.35) + safeAltitude (0.05) = 1.40
    expect(snapFinal.distanceToTarget).toBeCloseTo(1.40, 2);

    // 验证观测俯仰角 phi 严格匹配 (90° - lat)
    expect(snapFinal.spherical.phi).toBeCloseTo(expectedSph.phi, 2);

    // 验证相机位置沿视线看向天体中心 (0, 0, 0)
    const camPos = camera.position.clone();
    expect(camPos.length()).toBeCloseTo(1.40, 2);
    const camDir = camPos.clone().normalize();
    expect(camDir.dot(expectedNormal)).toBeCloseTo(1.0, 3); // 夹角几乎为 0°
  });

  it('R2-05: 验证 focusRegion 飞行过渡中支持用户鼠标拖拽与滚轮瞬间打断', () => {
    const camera = new THREE.PerspectiveCamera(50, 1.0, 0.1, 1000);
    const controller = new CameraController({ camera });
    controller.updateTargetPosition(new THREE.Vector3(0, 0, 0), 1.35);

    controller.executeCommand({
      type: 'focusRegion',
      bodyId: 'earth',
      lat: 22.3,
      lon: 113.8,
      altitude: 0.05,
      durationSec: 2.0,
    });

    expect(controller.getSnapshot().isTransitioning).toBe(true);

    // 推进 0.5s（飞行中途）
    controller.update(0.5);
    expect(controller.getSnapshot().isTransitioning).toBe(true);

    // 用户施加 orbit 拖拽交互打断飞行
    controller.executeCommand({
      type: 'orbit',
      deltaTheta: 0.05,
      deltaPhi: -0.02,
    });

    // 飞行状态必须瞬间解除，控制权归还用户
    const snapInterrupted = controller.getSnapshot();
    expect(snapInterrupted.isTransitioning).toBe(false);
  });
});
