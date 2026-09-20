import { describe, it, expect } from 'vitest';
import {
  PRESET_BOOKMARKS,
  isValidBookmark,
  importBookmarksJson,
  exportBookmarksJson,
} from '../src/utils/bookmarkStorage';

describe('M4 书签与观察点存档测试 (SAVE-01, SAVE-02)', () => {
  it('SAVE-01: 所有预置书签结构完整且符合 schemaVersion 1 契约', () => {
    expect(PRESET_BOOKMARKS.length).toBeGreaterThanOrEqual(4);
    for (const b of PRESET_BOOKMARKS) {
      expect(isValidBookmark(b)).toBe(true);
      expect(b.schemaVersion).toBe(1);
      expect(b.targetBodyId).toBeDefined();
      expect(b.spherical.radius).toBeGreaterThan(0);
      expect(b.spherical.phi).toBeGreaterThan(0);
    }
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
});
