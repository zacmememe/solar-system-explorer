import { describe, it, expect } from 'vitest';
import {
  PRESET_BOOKMARKS,
  isValidBookmark,
  importBookmarksJson,
  exportBookmarksJson,
} from '../src/utils/bookmarkStorage';
import {
  upgradeBookmarkToV3,
  normalizeObservationIntent,
  type BookmarkItemV1,
  type BookmarkItemV2,
} from '../src/contracts/bookmark';

describe('M4 书签与观察点存档测试 (SAVE-01, SAVE-02)', () => {
  it('SAVE-01: 所有预置书签结构完整且符合 schemaVersion 契约', () => {
    expect(PRESET_BOOKMARKS.length).toBeGreaterThanOrEqual(4);
    for (const b of PRESET_BOOKMARKS) {
      expect(isValidBookmark(b)).toBe(true);
      expect([1, 2, 3]).toContain(b.schemaVersion);
      expect(b.targetBodyId).toBeDefined();
      expect(b.spherical.radius).toBeGreaterThan(0);
      expect(b.spherical.phi).toBeGreaterThan(0);
    }
    // P1: 预置书签已迁移至 V3，且观察意图为统一语义
    for (const b of PRESET_BOOKMARKS) {
      expect(b.schemaVersion).toBe(3);
      if (b.observationMode) {
        expect(['physical', 'terrain-study']).toContain(b.observationMode);
      }
    }
    // P1: 预置月球物理观察书签保持轨道意图，不携带虚构地面站点
    const moonPreset = PRESET_BOOKMARKS.find((b) => b.id === 'preset-moon-physical-earth');
    expect(moonPreset).toBeDefined();
    expect(moonPreset?.surfaceStation).toBeUndefined();
  });

  it('SAVE-02: 校验器严格拒绝非法与篡改数据 (NaN、越界、未知天体)', () => {
    // 伪造非法天体
    expect(
      isValidBookmark({
        id: 'test',
        schemaVersion: 1,
        title: 'Fake',
        targetBodyId: 'death-star',
        spherical: { radius: 10, phi: 1, theta: 0 },
        viewCameraMode: 'PLANET_OBSERVE',
      })
    ).toBe(false);

    // 伪造 NaN 球坐标
    expect(
      isValidBookmark({
        id: 'test',
        schemaVersion: 1,
        title: 'Fake',
        targetBodyId: 'earth',
        spherical: { radius: NaN, phi: 1, theta: 0 },
        viewCameraMode: 'PLANET_OBSERVE',
      })
    ).toBe(false);

    // 伪造非法模式
    expect(
      isValidBookmark({
        id: 'test',
        schemaVersion: 1,
        title: 'Fake',
        targetBodyId: 'earth',
        spherical: { radius: 10, phi: 1, theta: 0 },
        viewCameraMode: 'WARP_DRIVE',
      })
    ).toBe(false);
  });

  it('SAVE-03: 导出与导入完整序列化/反序列化校验', () => {
    const exportedStr = exportBookmarksJson();
    expect(exportedStr).toContain('solar-system-explorer');
    expect(exportedStr).toContain('earth');

    const result = importBookmarksJson(exportedStr);
    expect(result.success).toBe(true);
    expect(result.importedCount).toBeGreaterThanOrEqual(4);
  });

  it('SAVE-04: 拦截非法/恶意导入 JSON 文本', () => {
    const invalidJson = '{ "app": "other-app", "schemaVersion": 999 }';
    const result = importBookmarksJson(invalidJson);
    expect(result.success).toBe(false);
    expect(result.importedCount).toBe(0);
  });

  it('SAVE-05: V1/V2 旧书签迁移至 V3 不伪造米制地表站点，遗留观察标签归一', () => {
    const v1: BookmarkItemV1 = {
      id: 'legacy-v1',
      title: '旧版地球观察',
      targetBodyId: 'earth',
      spherical: { radius: 6.2, phi: 1.2, theta: 0.4 },
      viewCameraMode: 'PLANET_OBSERVE',
      vehicleId: null,
      layers: {
        showClouds: true,
        showAtmosphere: true,
        teachingLight: false,
        showOrbits: true,
        venusRadarMode: false,
      },
      simTimeHours: 3.5,
      createdAtIso: '2026-09-01T00:00:00.000Z',
    };

    const fromV1 = upgradeBookmarkToV3(v1);
    expect(fromV1.schemaVersion).toBe(3);
    expect(fromV1.surfaceStation).toBeUndefined(); // V1 本就没有站点，迁移不得虚构
    expect(fromV1.observationMode).toBe('physical');
    expect(fromV1.targetBodyId).toBe('earth');
    expect(fromV1.simTimeHours).toBe(3.5);

    const v2: BookmarkItemV2 = {
      id: 'legacy-v2',
      schemaVersion: 2,
      title: 'V2 物理观察',
      targetBodyId: 'moon',
      presentationPolicy: 'PHYSICAL_OBSERVATION',
      epochIso: '2026-09-22T00:00:00Z',
      spherical: { radius: 0.65, phi: 1.55, theta: 1.74 },
      lookTarget: { kind: 'body', bodyId: 'earth' },
      viewCameraMode: 'PLANET_OBSERVE',
      vehicleId: null,
      layers: {
        showClouds: true,
        showAtmosphere: true,
        teachingLight: false,
        showOrbits: false,
        venusRadarMode: false,
      },
      simTimeHours: 280,
      createdAtIso: '2026-09-20T00:00:00.000Z',
    };

    const fromV2 = upgradeBookmarkToV3(v2);
    expect(fromV2.schemaVersion).toBe(3);
    expect(fromV2.surfaceStation).toBeUndefined();
    expect(fromV2.lookTarget).toEqual({ kind: 'body', bodyId: 'earth' });
    expect(fromV2.presentationPolicy).toBe('PHYSICAL_OBSERVATION');

    // 遗留标签归一
    expect(normalizeObservationIntent('TERRAIN')).toBe('terrain-study');
    expect(normalizeObservationIntent('RADAR')).toBe('terrain-study');
    expect(normalizeObservationIntent('NIGHT_LIGHTS')).toBe('physical');
    expect(normalizeObservationIntent('terrain-study')).toBe('terrain-study');
    expect(normalizeObservationIntent(undefined)).toBe('physical');
  });

  it('SAVE-06: V3 地表站点书签字段完整校验与往返保持', () => {
    const station = {
      bodyId: 'moon',
      coordinateType: 'planetocentric' as const,
      datum: 'MOON_PA453',
      latDeg: 20.35,
      lonDeg: 30.78,
      heightM: -2500,
      eyeHeightM: 1.7,
      bodyFixedPosM: [1406830.4, 574218.4, -843653.2],
      surfaceNormal: [0.8097, 0.3472, -0.4741],
      orientationDeg: { yawDeg: 225, pitchDeg: 12 },
    };
    const v3 = {
      id: 'v3-surface',
      schemaVersion: 3,
      title: '月面站点',
      targetBodyId: 'moon',
      presentationPolicy: 'PHYSICAL_OBSERVATION',
      epochIso: '2026-09-22T00:00:00Z',
      spherical: { radius: 0.37, phi: 1.55, theta: 1.74 },
      lookTarget: { kind: 'body', bodyId: 'earth' },
      surfaceStation: station,
      observationMode: 'physical' as const,
      quality: 'analytic-approximation' as const,
      sourceVersion: '2026.09-P1-V3',
      viewCameraMode: 'PLANET_OBSERVE',
      vehicleId: null,
      layers: {
        showClouds: true,
        showAtmosphere: true,
        teachingLight: false,
        showOrbits: false,
        venusRadarMode: false,
      },
      simTimeHours: 12,
      createdAtIso: '2026-09-23T00:00:00.000Z',
    };

    expect(isValidBookmark(v3)).toBe(true);

    // 迁移往返：V3 结构稳定，站点/朝向/模式无损
    const round = upgradeBookmarkToV3(JSON.parse(JSON.stringify(v3)));
    expect(round.schemaVersion).toBe(3);
    expect(round.surfaceStation).toEqual(station);
    expect(round.observationMode).toBe('physical');

    // 非法站点必须被拒绝：零向量法线 / NaN 向量 / 非法眼高 / 越界纬度 / 非法朝向
    const badNormal = JSON.parse(JSON.stringify(v3));
    badNormal.surfaceStation.surfaceNormal = [0, 0, 0];
    expect(isValidBookmark(badNormal)).toBe(false);

    const nanVec = JSON.parse(JSON.stringify(v3));
    nanVec.surfaceStation.bodyFixedPosM = [1, NaN, 3];
    expect(isValidBookmark(nanVec)).toBe(false);

    const badEye = JSON.parse(JSON.stringify(v3));
    badEye.surfaceStation.eyeHeightM = 0;
    expect(isValidBookmark(badEye)).toBe(false);

    const badLat = JSON.parse(JSON.stringify(v3));
    badLat.surfaceStation.latDeg = 120;
    expect(isValidBookmark(badLat)).toBe(false);

    const badOrient = JSON.parse(JSON.stringify(v3));
    badOrient.surfaceStation.orientationDeg = { yawDeg: 10, pitchDeg: 89 };
    expect(isValidBookmark(badOrient)).toBe(false);

    const badMode = JSON.parse(JSON.stringify(v3));
    badMode.observationMode = 'NIGHT_LIGHTS';
    expect(isValidBookmark(badMode)).toBe(false);
  });
});
