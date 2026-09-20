/**
 * 书签与观察点离线安全存储管理工具
 * 遵循 01-REBUILD-PLAN.zh-CN.md 与 03-ACCEPTANCE.zh-CN.md (SAVE-01, SAVE-02) 规范：
 * 1. 本地 localStorage 持久化，零服务器上传，保护儿童隐私；
 * 2. 提供预置经典探索观测点；
 * 3. 严格校验 schemaVersion 与字段边界，杜绝脏数据导致黑屏崩溃；
 * 4. 支持 JSON 格式导出与导入备份。
 */

import type { BookmarkItem, BookmarkExportPackage } from '../contracts/bookmark';
import { BODIES } from '../astronomy/bodies';

const STORAGE_KEY = 'solar_explorer_bookmarks_v1';

export const PRESET_BOOKMARKS: BookmarkItem[] = [
  {
    id: 'preset-earth-terminator',
    schemaVersion: 1,
    title: '🌍 地球 · 晨昏线与万家灯火',
    targetBodyId: 'earth',
    spherical: { radius: 4.8, phi: 1.45, theta: 0.8 },
    viewCameraMode: 'VEHICLE_FORMATION',
    vehicleId: 'iss',
    layers: {
      showClouds: true,
      showAtmosphere: true,
      teachingLight: false,
      showOrbits: true,
      venusRadarMode: false,
    },
    simTimeHours: 12.0,
    createdAtIso: '2026-09-20T00:00:00.000Z',
    notes: '从国际空间站伴飞视角俯瞰地球，欣赏大洋蓝光与夜半球流光溢彩的城市灯光。',
    isPreset: true,
  },
  {
    id: 'preset-saturn-rings',
    schemaVersion: 1,
    title: '🪐 土星 · 宏伟双面环与背阳投影',
    targetBodyId: 'saturn',
    spherical: { radius: 21.0, phi: 1.3, theta: 0.95 },
    viewCameraMode: 'VEHICLE_FORMATION',
    vehicleId: 'cassini',
    layers: {
      showClouds: true,
      showAtmosphere: true,
      teachingLight: false,
      showOrbits: true,
      venusRadarMode: false,
    },
    simTimeHours: 24.0,
    createdAtIso: '2026-09-20T00:00:00.000Z',
    notes: '卡西尼号飞抵土星，近距离观察宽达数十万公里但厚仅几十米的冰晶光环与其投射的细密阴影。',
    isPreset: true,
  },
  {
    id: 'preset-moon-landing',
    schemaVersion: 1,
    title: '🌕 月球 · 阿波罗 11 号静海基地',
    targetBodyId: 'moon',
    spherical: { radius: 2.8, phi: 1.35, theta: 0.5 },
    viewCameraMode: 'VEHICLE_FORMATION',
    vehicleId: 'apollo-lm',
    layers: {
      showClouds: false,
      showAtmosphere: false,
      teachingLight: false,
      showOrbits: true,
      venusRadarMode: false,
    },
    simTimeHours: 0.0,
    createdAtIso: '2026-09-20T00:00:00.000Z',
    notes: '阿波罗 11 号登月舱“鹰号”俯瞰月球正面古老玄武岩熔岩平原与撞击坑群。',
    isPreset: true,
  },
  {
    id: 'preset-jwst-deepspace',
    schemaVersion: 1,
    title: '🔭 韦伯望远镜 · 深空红外巡天',
    targetBodyId: 'jupiter',
    spherical: { radius: 10.5, phi: 1.4, theta: 1.1 },
    viewCameraMode: 'VEHICLE_FORMATION',
    vehicleId: 'james-webb',
    layers: {
      showClouds: true,
      showAtmosphere: true,
      teachingLight: false,
      showOrbits: true,
      venusRadarMode: false,
    },
    simTimeHours: 48.0,
    createdAtIso: '2026-09-20T00:00:00.000Z',
    notes: '韦伯望远镜以 18 面镀金六边形主镜凝望木星大红斑与绚丽极光。',
    isPreset: true,
  },
];

/**
 * 读取当前所有书签（预置 + 用户自定义）
 */
export function getStoredBookmarks(): BookmarkItem[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return [...PRESET_BOOKMARKS];
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [...PRESET_BOOKMARKS];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...PRESET_BOOKMARKS];

    const validCustom = parsed.filter(isValidBookmark);
    return [...PRESET_BOOKMARKS, ...validCustom];
  } catch (err) {
    console.warn('[Bookmark] Failed to load bookmarks from storage:', err);
    return [...PRESET_BOOKMARKS];
  }
}

/**
 * 保存单个新书签
 */
export function saveBookmark(bookmark: BookmarkItem): void {
  if (typeof window === 'undefined' || !window.localStorage) return;

  const current = getStoredBookmarks().filter((b) => !b.isPreset);
  // 去重或更新
  const existingIdx = current.findIndex((b) => b.id === bookmark.id);
  if (existingIdx >= 0) {
    current[existingIdx] = bookmark;
  } else {
    current.unshift(bookmark);
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch (err) {
    console.error('[Bookmark] Failed to save bookmark:', err);
  }
}

/**
 * 删除用户书签（禁止删除预置书签）
 */
export function deleteBookmark(id: string): void {
  if (typeof window === 'undefined' || !window.localStorage) return;

  const current = getStoredBookmarks().filter((b) => !b.isPreset && b.id !== id);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch (err) {
    console.error('[Bookmark] Failed to delete bookmark:', err);
  }
}

/**
 * 导出全部书签为 JSON 字符串
 */
export function exportBookmarksJson(): string {
  const bookmarks = getStoredBookmarks();
  const pkg: BookmarkExportPackage = {
    app: 'solar-system-explorer',
    schemaVersion: 1,
    exportedAtIso: new Date().toISOString(),
    bookmarks,
  };
  return JSON.stringify(pkg, null, 2);
}

/**
 * 触发本地 JSON 存档文件下载
 */
export function downloadBookmarksFile(): void {
  const jsonStr = exportBookmarksJson();
  const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `solar-system-bookmarks-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * 导入 JSON 存档，严格执行模式与数据校验
 */
export function importBookmarksJson(jsonStr: string): {
  success: boolean;
  importedCount: number;
  message: string;
} {
  try {
    const data = JSON.parse(jsonStr);
    if (!data || typeof data !== 'object') {
      return { success: false, importedCount: 0, message: '无效的 JSON 文件格式' };
    }

    if (data.app !== 'solar-system-explorer' || data.schemaVersion !== 1) {
      return { success: false, importedCount: 0, message: '不支持的存档版本或非本应用导出的书签' };
    }

    if (!Array.isArray(data.bookmarks)) {
      return { success: false, importedCount: 0, message: '存档中未找到有效的书签列表' };
    }

    const validItems: BookmarkItem[] = [];
    for (const item of data.bookmarks) {
      if (isValidBookmark(item)) {
        // 导入时保证作为用户自定义书签，防止覆盖预置规则
        validItems.push({
          ...item,
          id: item.id.startsWith('preset-') ? `imported-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` : item.id,
          isPreset: false,
        });
      }
    }

    if (validItems.length === 0) {
      return { success: false, importedCount: 0, message: '文件中未包含符合规范的有效书签数据' };
    }

    for (const item of validItems) {
      saveBookmark(item);
    }

    return {
      success: true,
      importedCount: validItems.length,
      message: `成功导入 ${validItems.length} 个观察点书签！`,
    };
  } catch (err: any) {
    return { success: false, importedCount: 0, message: `解析错误: ${err?.message || '未知格式错误'}` };
  }
}

/**
 * 严格校验书签对象合法性，防止非法值污染
 */
export function isValidBookmark(obj: any): obj is BookmarkItem {
  if (!obj || typeof obj !== 'object') return false;
  if (typeof obj.id !== 'string' || !obj.id) return false;
  if (obj.schemaVersion !== 1) return false;
  if (typeof obj.title !== 'string') return false;
  if (typeof obj.targetBodyId !== 'string' || !BODIES[obj.targetBodyId]) return false;

  if (
    !obj.spherical ||
    typeof obj.spherical.radius !== 'number' ||
    typeof obj.spherical.phi !== 'number' ||
    typeof obj.spherical.theta !== 'number' ||
    isNaN(obj.spherical.radius) ||
    isNaN(obj.spherical.phi) ||
    isNaN(obj.spherical.theta)
  ) {
    return false;
  }

  if (
    obj.viewCameraMode !== 'PLANET_OBSERVE' &&
    obj.viewCameraMode !== 'VEHICLE_FORMATION' &&
    obj.viewCameraMode !== 'VEHICLE_ONBOARD'
  ) {
    return false;
  }

  return true;
}
