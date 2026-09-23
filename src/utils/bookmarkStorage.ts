/**
 * 书签与观察点离线安全存储管理工具 (V3 规范)
 * 遵循主方案规范与 260923 Pro Model 优化审计：
 * 1. 本地 localStorage 持久化，零服务器上传，保护儿童隐私；
 * 2. 提供预置经典探索观测点（包含导航比例、物理观察与多模式地貌夜景）；
 * 3. 严格校验 schemaVersion（全兼容 V1、V2 与 V3）与字段边界；
 * 4. 支持 JSON 格式导出与导入备份。
 */

import type { BookmarkItem, BookmarkItemV3, BookmarkExportPackage } from '../contracts/bookmark';
import { upgradeBookmarkToV3 } from '../contracts/bookmark';
import { BODIES } from '../astronomy/bodies';

const STORAGE_KEY = 'solar_explorer_bookmarks_v3';
const V2_STORAGE_KEY = 'solar_explorer_bookmarks_v2';
const LEGACY_STORAGE_KEY = 'solar_explorer_bookmarks_v1';

export const PRESET_BOOKMARKS: BookmarkItemV3[] = [
  {
    id: 'preset-earth-terminator',
    schemaVersion: 3,
    title: '🌍 地球 · 晨昏线与万家灯火',
    targetBodyId: 'earth',
    presentationPolicy: 'NAV_SCHEMATIC',
    epochIso: '2026-09-22T00:00:00.000Z',
    spherical: { radius: 4.8, phi: 1.45, theta: 0.8 },
    viewCameraMode: 'VEHICLE_FORMATION',
    vehicleId: 'iss',
    observationMode: 'physical',
    quality: 'analytic-approximation',
    sourceVersion: '2026.09-P1-V3',
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
    // 轨道观察意图：物理比例下从月球轨道眺望地球（保留 V2 语义，不虚构地面站点）
    id: 'preset-moon-physical-earth',
    schemaVersion: 3,
    title: '🌕 月球 · 物理尺度眺望地球 (1.90°)',
    targetBodyId: 'moon',
    presentationPolicy: 'PHYSICAL_OBSERVATION',
    epochIso: '2026-09-22T00:00:00.000Z',
    spherical: { radius: 0.65, phi: 1.55, theta: 1.74 },
    lookTarget: { kind: 'body', bodyId: 'earth' },
    viewCameraMode: 'PLANET_OBSERVE',
    vehicleId: null,
    observationMode: 'physical',
    quality: 'analytic-approximation',
    sourceVersion: '2026.09-P1-V3',
    layers: {
      showClouds: true,
      showAtmosphere: true,
      teachingLight: false,
      showOrbits: false,
      venusRadarMode: false,
    },
    simTimeHours: 280.0,
    createdAtIso: '2026-09-20T00:00:00.000Z',
    notes: '地月真实物理间距 384,400km，从月球近地侧轨道眺望地球，蔚蓝母星在深邃星空中呈现严密符合物理光学法则的 1.90° 壮丽居中视圆盘。',
    isPreset: true,
  },
  {
    id: 'preset-saturn-rings',
    schemaVersion: 3,
    title: '🪐 土星 · 宏伟双面环与背阳投影',
    targetBodyId: 'saturn',
    presentationPolicy: 'NAV_SCHEMATIC',
    epochIso: '2026-09-22T00:00:00.000Z',
    spherical: { radius: 21.0, phi: 1.3, theta: 0.95 },
    viewCameraMode: 'VEHICLE_FORMATION',
    vehicleId: 'cassini',
    observationMode: 'physical',
    quality: 'analytic-approximation',
    sourceVersion: '2026.09-P1-V3',
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
    schemaVersion: 3,
    title: '🌕 月球 · 阿波罗 11 号静海基地',
    targetBodyId: 'moon',
    presentationPolicy: 'NAV_SCHEMATIC',
    epochIso: '2026-09-22T00:00:00.000Z',
    spherical: { radius: 2.8, phi: 1.35, theta: 0.5 },
    viewCameraMode: 'VEHICLE_FORMATION',
    vehicleId: 'apollo-lm',
    observationMode: 'physical',
    quality: 'analytic-approximation',
    sourceVersion: '2026.09-P1-V3',
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
    schemaVersion: 3,
    title: '🔭 韦伯望远镜 · 深空红外巡天',
    targetBodyId: 'jupiter',
    presentationPolicy: 'NAV_SCHEMATIC',
    epochIso: '2026-09-22T00:00:00.000Z',
    spherical: { radius: 10.5, phi: 1.4, theta: 1.1 },
    viewCameraMode: 'VEHICLE_FORMATION',
    vehicleId: 'james-webb',
    observationMode: 'physical',
    quality: 'analytic-approximation',
    sourceVersion: '2026.09-P1-V3',
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

// 兼容别名：历史导入名 (R3 等测试与旧代码引用)；实际数据已是 V3 结构
export const PRESET_BOOKMARKS_V3 = PRESET_BOOKMARKS;
export const PRESET_BOOKMARKS_V2 = PRESET_BOOKMARKS;

/**
 * 读取当前所有书签（预置 + 用户自定义，自动无缝升级迁移旧版 V1/V2）
 */
export function getStoredBookmarks(): BookmarkItemV3[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return [...PRESET_BOOKMARKS];
  }

  try {
    let raw = localStorage.getItem(STORAGE_KEY);
    // 若 V3 不存在，尝试读取 V2 或 V1 并自动级联升级
    if (!raw) {
      let legacyRaw = localStorage.getItem(V2_STORAGE_KEY);
      if (!legacyRaw) {
        legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
      }

      if (legacyRaw) {
        const legacyParsed = JSON.parse(legacyRaw);
        if (Array.isArray(legacyParsed)) {
          const upgraded = legacyParsed.filter(isValidBookmarkAnyVersion).map(upgradeBookmarkToV3);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(upgraded));
          return [...PRESET_BOOKMARKS, ...upgraded];
        }
      }
      return [...PRESET_BOOKMARKS];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...PRESET_BOOKMARKS];

    const validCustom = parsed.filter(isValidBookmarkAnyVersion).map(upgradeBookmarkToV3);
    return [...PRESET_BOOKMARKS, ...validCustom];
  } catch (err) {
    console.warn('[Bookmark] Failed to load bookmarks from storage:', err);
    return [...PRESET_BOOKMARKS];
  }
}

/**
 * 保存单个新书签 (V3 规范)
 */
export function saveBookmark(bookmark: BookmarkItem): void {
  if (typeof window === 'undefined' || !window.localStorage) return;

  const upgraded = upgradeBookmarkToV3(bookmark);
  const current = getStoredBookmarks().filter((b) => !b.isPreset);
  const existingIdx = current.findIndex((b) => b.id === upgraded.id);
  if (existingIdx >= 0) {
    current[existingIdx] = upgraded;
  } else {
    current.unshift(upgraded);
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
 * 导出全部书签为 JSON 字符串 (V3 规范)
 */
export function exportBookmarksJson(): string {
  const bookmarks = getStoredBookmarks();
  const pkg: BookmarkExportPackage = {
    app: 'solar-system-explorer',
    schemaVersion: 3,
    exportedAtIso: new Date().toISOString(),
    bookmarks,
  };
  return JSON.stringify(pkg, null, 2);
}

/**
 * 触发本地 JSON 存档文件下载 (V3 规范)
 */
export function downloadBookmarksFile(): void {
  const jsonStr = exportBookmarksJson();
  const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `solar-system-bookmarks-v3-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * 导入 JSON 存档，严格执行模式与数据校验（支持 V1、V2 和 V3 文件无缝导入）
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

    if (
      data.app !== 'solar-system-explorer' ||
      (data.schemaVersion !== 1 && data.schemaVersion !== 2 && data.schemaVersion !== 3)
    ) {
      return { success: false, importedCount: 0, message: '不支持的存档版本或非本应用导出的书签' };
    }

    if (!Array.isArray(data.bookmarks)) {
      return { success: false, importedCount: 0, message: '存档中未找到有效的书签列表' };
    }

    const validItems: BookmarkItemV3[] = [];
    for (const item of data.bookmarks) {
      if (isValidBookmarkAnyVersion(item)) {
        const upgraded = upgradeBookmarkToV3(item);
        validItems.push({
          ...upgraded,
          id: upgraded.id.startsWith('preset-')
            ? `imported-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
            : upgraded.id,
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
 * 严格校验书签合法性（支持 V1、V2 和 V3，使用 Number.isFinite 防御 Infinity 与非法数值）
 */
export function isValidBookmarkAnyVersion(obj: any): boolean {
  if (!obj || typeof obj !== 'object') return false;
  if (typeof obj.id !== 'string' || !obj.id) return false;
  if (obj.schemaVersion !== 1 && obj.schemaVersion !== 2 && obj.schemaVersion !== 3) return false;
  if (typeof obj.title !== 'string') return false;
  if (typeof obj.targetBodyId !== 'string' || !BODIES[obj.targetBodyId]) return false;

  // 球坐标必须为严格有限正数，且 phi 在 [0, PI] 合法球面角区间，防 Infinity
  if (
    !obj.spherical ||
    !Number.isFinite(obj.spherical.radius) ||
    obj.spherical.radius <= 0 ||
    !Number.isFinite(obj.spherical.phi) ||
    obj.spherical.phi < 0 ||
    obj.spherical.phi > Math.PI ||
    !Number.isFinite(obj.spherical.theta)
  ) {
    return false;
  }

  // 模拟时间若存在必须为有限数，杜绝 NaN / Infinity
  if (obj.simTimeHours !== undefined && !Number.isFinite(obj.simTimeHours)) {
    return false;
  }

  // 展示策略校验
  if (
    obj.presentationPolicy !== undefined &&
    obj.presentationPolicy !== 'NAV_SCHEMATIC' &&
    obj.presentationPolicy !== 'PHYSICAL_OBSERVATION'
  ) {
    return false;
  }

  // 视线朝向 lookTarget 校验
  if (obj.lookTarget) {
    if (obj.lookTarget.kind === 'body') {
      if (typeof obj.lookTarget.bodyId !== 'string' || !BODIES[obj.lookTarget.bodyId]) {
        return false;
      }
    } else if (obj.lookTarget.kind === 'point') {
      if (
        !Array.isArray(obj.lookTarget.point) ||
        obj.lookTarget.point.length !== 3 ||
        !obj.lookTarget.point.every(Number.isFinite)
      ) {
        return false;
      }
    } else if (obj.lookTarget.kind !== 'center') {
      return false;
    }
  }

  // 地理坐标若存在必须在合法大地测量范围
  if (obj.geographicCoord) {
    const { lat, lon, altitudeKm } = obj.geographicCoord;
    if (
      !Number.isFinite(lat) ||
      Math.abs(lat) > 90 ||
      !Number.isFinite(lon) ||
      !Number.isFinite(altitudeKm)
    ) {
      return false;
    }
  }

  // 地表米制站点若存在必须进行完整字段防御 (V3)：
  // 向量维度与有限值、datum/coordinateType 语义、地面高程/眼高/朝向范围
  if (obj.surfaceStation) {
    const st = obj.surfaceStation;
    if (
      typeof st.bodyId !== 'string' ||
      !BODIES[st.bodyId] ||
      !Number.isFinite(st.latDeg) ||
      Math.abs(st.latDeg) > 90 ||
      !Number.isFinite(st.lonDeg) ||
      Math.abs(st.lonDeg) > 180 ||
      !Number.isFinite(st.heightM) ||
      Math.abs(st.heightM) > 20000
    ) {
      return false;
    }
    if (st.coordinateType !== 'geodetic' && st.coordinateType !== 'planetocentric') {
      return false;
    }
    if (typeof st.datum !== 'string' || st.datum.length === 0) {
      return false;
    }
    if (
      !Array.isArray(st.bodyFixedPosM) ||
      st.bodyFixedPosM.length !== 3 ||
      !st.bodyFixedPosM.every(Number.isFinite)
    ) {
      return false;
    }
    if (
      !Array.isArray(st.surfaceNormal) ||
      st.surfaceNormal.length !== 3 ||
      !st.surfaceNormal.every(Number.isFinite) ||
      Math.hypot(st.surfaceNormal[0], st.surfaceNormal[1], st.surfaceNormal[2]) <= 0
    ) {
      return false;
    }
    // 眼高与朝向 (眼高 >0 且 <100m；pitch ±85°)
    if (
      st.eyeHeightM === undefined ||
      !Number.isFinite(st.eyeHeightM) ||
      st.eyeHeightM <= 0 ||
      st.eyeHeightM > 100
    ) {
      return false;
    }
    if (st.orientationDeg) {
      const { yawDeg, pitchDeg } = st.orientationDeg;
      if (!Number.isFinite(yawDeg) || !Number.isFinite(pitchDeg) || Math.abs(pitchDeg) > 85) {
        return false;
      }
    }
  }

  // 观察意图若存在必须为统一语义
  if (
    obj.observationMode !== undefined &&
    obj.observationMode !== 'physical' &&
    obj.observationMode !== 'terrain-study'
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

export const isValidBookmark = isValidBookmarkAnyVersion;
