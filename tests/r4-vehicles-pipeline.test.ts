/**
 * 批次 R4 载具资产准入与模型管线测试 (Batch R4 Vehicle Pipeline & Asset Integrity Tests)
 * 遵循第二轮优化审计 R4 要求：
 * 1. 验证 VehicleAssetRegistry 出处、哈希、许可与米制标定；
 * 2. 验证磁盘上的 NASA Hubble GLB 资产与 Draco 解码器 100% 存在、无损坏；
 * 3. 验证代际事务（Generation Tracking）与防迟到回调；
 * 4. 验证旧载具 ID 向后兼容性。
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import {
  VEHICLE_ASSET_REGISTRY,
  getFeaturedVehicleIds,
  getAllVehicleIds,
} from '../src/vehicles/VehicleAssetRegistry';
import { VEHICLE_CATALOG } from '../src/vehicles/VehicleCatalog';
import { VehicleLoader } from '../src/vehicles/VehicleLoader';
import type { VehicleId } from '../src/contracts/vehicle';

describe('批次 R4 载具资产准入与模型管线测试 (Vehicle Pipeline Tests)', () => {
  it('R4-01: 验证 VehicleAssetRegistry 精品收缩与元数据准入完整性', () => {
    const featured = getFeaturedVehicleIds();
    expect(featured).toEqual(['iss','cassini','voyager-1','juno','space-shuttle']);

    const all = getAllVehicleIds();
    expect(all).toHaveLength(9);
    expect(all).toContain('hubble');
    expect(all).toContain('iss');
    expect(all).toContain('apollo-lm');
    expect(all).toContain('voyager-1');
    expect(all).toContain('james-webb');
    expect(all).toContain('tiangong');
    expect(all).toContain('cassini');

    // 验证哈勃 NASA 官方资产准入记录
    const hubbleRec = VEHICLE_ASSET_REGISTRY['hubble'];
    expect(hubbleRec).toBeDefined();
    expect(hubbleRec.format).toBe('glb');
    expect(hubbleRec.approved).toBe(true);
    expect(hubbleRec.isFeatured).toBe(false); // retained metadata, retired from selection
    expect(hubbleRec.assetPath).toBe('/assets/models/hubble-nasa-b.glb');
    expect(hubbleRec.fileSize).toBe(5140096);
    expect(hubbleRec.license).toContain('Public Domain');
    expect(hubbleRec.source).toContain('NASA');
    expect(hubbleRec.hotspots.length).toBeGreaterThanOrEqual(4);

    // 验证 ISS 准入记录
    const issRec = VEHICLE_ASSET_REGISTRY['iss'];
    expect(issRec).toBeDefined();
    expect(issRec.approved).toBe(true);
    expect(issRec.isFeatured).toBe(true);
    expect(issRec.calibratedDimensionsM.lengthM).toBe(109.0);
  });

  it('R4-02: 验证磁盘上 NASA 官方 Hubble GLB 与 Draco 解码器 100% 存在且哈希严格匹配', () => {
    const glbPath = path.resolve('public/assets/models/hubble-nasa-b.glb');
    expect(fs.existsSync(glbPath), 'Hubble GLB 文件必须存在于 public/assets/models/').toBe(true);

    const stat = fs.statSync(glbPath);
    expect(stat.size).toBe(5140096);

    const buffer = fs.readFileSync(glbPath);
    const hash = crypto.createHash('sha256').update(buffer).digest('hex').toUpperCase();
    expect(hash).toBe('FC2690F5806BCBE39EA534735B0AFEA9BD268AB89203A05C46E8C418CEB88489');

    // 验证 Draco 解码器离线部署在 public/draco/
    const dracoWasmPath = path.resolve('public/draco/draco_decoder.wasm');
    const dracoJsPath = path.resolve('public/draco/draco_wasm_wrapper.js');
    expect(fs.existsSync(dracoWasmPath), 'draco_decoder.wasm 必须存在于 public/draco/').toBe(true);
    expect(fs.existsSync(dracoJsPath), 'draco_wasm_wrapper.js 必须存在于 public/draco/').toBe(true);
    expect(fs.statSync(dracoWasmPath).size).toBeGreaterThan(100000);
  });

  it('R4-03: 验证 VehicleLoader 代际事务控制 (Generation Tracking) 与防过期迟到', async () => {
    const gen1 = VehicleLoader.nextGeneration();
    const gen2 = VehicleLoader.nextGeneration();
    expect(gen2).toBeGreaterThan(gen1);
    expect(VehicleLoader.getCurrentGeneration()).toBe(gen2);

    // 过期代际 (gen1) 请求应被主动拒绝，返回 null
    const staleResult = await VehicleLoader.loadVehicle('iss', gen1);
    expect(staleResult).toBeNull();

    // 当前有效代际 (gen2) 请求可顺利载入
    const validResult = await VehicleLoader.loadVehicle('iss', gen2);
    expect(validResult).not.toBeNull();
    expect(validResult?.userData.vehicleId).toBe('iss');
    expect(validResult?.userData.generation).toBe(gen2);

    // 安全释放测试
    expect(() => {
      VehicleLoader.disposeVehicleObject(validResult);
      VehicleLoader.disposeVehicleObject(null);
    }).not.toThrow();
  });

  it('R4-04: 验证全部历史载具在 Catalog 中的完整度与米制尺寸有限性', () => {
    const allIds: VehicleId[] = [
      'apollo-lm',
      'voyager-1',
      'james-webb',
      'hubble',
      'iss',
      'tiangong',
      'cassini',
    ];

    for (const id of allIds) {
      const def = VEHICLE_CATALOG[id];
      expect(def, `载具 ${id} 必须在 VEHICLE_CATALOG 中合法存在`).toBeDefined();
      expect(Number.isFinite(def.dimensions.lengthM)).toBe(true);
      expect(Number.isFinite(def.dimensions.widthM)).toBe(true);
      expect(Number.isFinite(def.dimensions.heightM)).toBe(true);
      expect(def.dimensions.lengthM).toBeGreaterThan(0);
      expect(def.dimensions.widthM).toBeGreaterThan(0);
      expect(def.dimensions.heightM).toBeGreaterThan(0);
      expect(def.hotspots.length).toBeGreaterThanOrEqual(1);

      for (const hs of def.hotspots) {
        expect(hs.id).toBeTruthy();
        expect(hs.relativePosM).toHaveLength(3);
        expect(hs.relativePosM.every((v) => Number.isFinite(v))).toBe(true);
      }
    }
  });
});
