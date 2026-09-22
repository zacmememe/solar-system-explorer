import { describe, it, expect } from 'vitest';
import { upgradeBookmarkToV2 } from '../src/contracts/bookmark';
import { isValidBookmarkAnyVersion } from '../src/utils/bookmarkStorage';

describe('书签系统 V2 架构与迁移兼容测试', () => {
  it('BM-01: 旧版 V1 书签自动无缝升级为 V2 规范并赋予默认策略与 Epoch', () => {
    const legacyBookmark = {
      id: 'custom-legacy-1',
      schemaVersion: 1,
      title: '旧版地球观察点',
      targetBodyId: 'earth',
      spherical: { radius: 6.2, phi: 1.4, theta: 0.8 },
      viewCameraMode: 'PLANET_OBSERVE',
      vehicleId: null,
      layers: {
        showClouds: true,
        showAtmosphere: true,
        teachingLight: false,
        showOrbits: true,
        venusRadarMode: false,
      },
      simTimeHours: 10.0,
      createdAtIso: '2026-09-18T10:00:00.000Z',
    };

    expect(isValidBookmarkAnyVersion(legacyBookmark)).toBe(true);

    const upgraded = upgradeBookmarkToV2(legacyBookmark);
    expect(upgraded.schemaVersion).toBe(2);
    expect(upgraded.presentationPolicy).toBe('NAV_SCHEMATIC'); // 旧书签稳健归入宏观导航策略
    expect(upgraded.epochIso).toBe('2026-09-22T00:00:00Z');
    expect(upgraded.spherical.radius).toBe(6.2);
    expect(upgraded.title).toBe('旧版地球观察点');
  });

  it('BM-02: V2 物理观察书签正确保留 PHYSICAL_OBSERVATION 策略', () => {
    const v2PhysicalBookmark = {
      id: 'v2-moon-earth',
      schemaVersion: 2,
      title: '月球眺望地球 (1.90°)',
      targetBodyId: 'moon',
      presentationPolicy: 'PHYSICAL_OBSERVATION',
      epochIso: '2026-09-22T00:00:00Z',
      spherical: { radius: 3.5, phi: 1.57, theta: 3.14 },
      viewCameraMode: 'PLANET_OBSERVE',
      vehicleId: null,
      layers: {
        showClouds: true,
        showAtmosphere: true,
        teachingLight: false,
        showOrbits: false,
        venusRadarMode: false,
      },
      simTimeHours: 0.0,
      createdAtIso: '2026-09-22T00:00:00Z',
    };

    expect(isValidBookmarkAnyVersion(v2PhysicalBookmark)).toBe(true);
    const result = upgradeBookmarkToV2(v2PhysicalBookmark);
    expect(result.presentationPolicy).toBe('PHYSICAL_OBSERVATION');
    expect(result.schemaVersion).toBe(2);
  });
});
