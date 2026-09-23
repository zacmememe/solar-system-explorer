/**
 * 太阳系漫游 · BMNG 科学数据源地理切片与坐标计算
 * 遵循 NASA BMNG 用户手册（Table 1, Page 2）与大地测量学定义。
 * 纯 TypeScript 模块，零外部依赖。
 */

export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export type Quadrant = 'A1' | 'B1' | 'C1' | 'D1' | 'A2' | 'B2' | 'C2' | 'D2';

export interface RasterSource {
  id: string;
  width: number;
  height: number;
  bounds: Bounds;
}

const DEG = Math.PI / 180;

export function assertBounds(b: Bounds): void {
  if (
    ![b.west, b.south, b.east, b.north].every(Number.isFinite) ||
    b.west < -180 ||
    b.east > 180 ||
    b.south < -90 ||
    b.north > 90 ||
    b.west >= b.east ||
    b.south >= b.north
  ) {
    throw new RangeError(
      `Invalid geographic bounds: [west=${b.west}, south=${b.south}, east=${b.east}, north=${b.north}]`
    );
  }
}

/**
 * 获取 NASA BMNG 8 个象限的官方覆盖范围
 * A1~D1: 北半球 (0° ~ 90°N)
 * A2~D2: 南半球 (90°S ~ 0°)
 * A: 180°W ~ 90°W
 * B: 90°W ~ 0°
 * C: 0° ~ 90°E
 * D: 90°E ~ 180°E (东亚/中国/珠江口位于 D1)
 */
export function bmngBounds(id: Quadrant): Bounds {
  if (!/^[ABCD][12]$/.test(id)) {
    throw new RangeError(`Unknown BMNG quadrant: ${id}`);
  }
  const west = -180 + 'ABCD'.indexOf(id[0]!) * 90;
  return {
    west,
    east: west + 90,
    south: id[1] === '1' ? 0 : -90,
    north: id[1] === '1' ? 90 : 0,
  };
}

export function contains(container: Bounds, area: Bounds): boolean {
  assertBounds(container);
  assertBounds(area);
  const eps = 1e-10;
  return (
    area.west >= container.west - eps &&
    area.east <= container.east + eps &&
    area.south >= container.south - eps &&
    area.north <= container.north + eps
  );
}

export function requiredQuadrants(area: Bounds): Quadrant[] {
  assertBounds(area);
  const ids: Quadrant[] = ['A1', 'B1', 'C1', 'D1', 'A2', 'B2', 'C2', 'D2'];
  return ids.filter((id) => {
    const b = bmngBounds(id);
    return (
      Math.max(b.west, area.west) < Math.min(b.east, area.east) &&
      Math.max(b.south, area.south) < Math.min(b.north, area.north)
    );
  });
}

/**
 * 校验分块源图是否与 NASA 声明扇区一致，阻断错误分块（例如拿 C2 切珠江口）
 */
export function verifyQuadrantSource(source: RasterSource, id: Quadrant): void {
  const expected = bmngBounds(id);
  assertBounds(source.bounds);
  if (
    !Number.isInteger(source.width) ||
    !Number.isInteger(source.height) ||
    source.width <= 0 ||
    source.height <= 0
  ) {
    throw new RangeError(`Invalid raster dimensions: ${source.width}x${source.height}`);
  }
  for (const k of ['west', 'east', 'south', 'north'] as const) {
    if (Math.abs(source.bounds[k] - expected[k]) > 1e-10) {
      throw new Error(
        `BMNG ${id}: ${k} metadata (${source.bounds[k]}) contradicts NASA quadrant definition (${expected[k]})`
      );
    }
  }
}

/**
 * 浮点高精度裁剪窗口计算，杜绝整数拉伸导致的子像素漂移
 */
export function sourceWindow(source: RasterSource, area: Bounds) {
  assertBounds(source.bounds);
  assertBounds(area);
  if (
    !Number.isInteger(source.width) ||
    source.width < 1 ||
    !Number.isInteger(source.height) ||
    source.height < 1
  ) {
    throw new RangeError('Invalid source size');
  }
  if (!contains(source.bounds, area)) {
    throw new RangeError(
      `Source ${source.id} bounds [${source.bounds.west}, ${source.bounds.south}, ${source.bounds.east}, ${source.bounds.north}] does not cover the requested region [${area.west}, ${area.south}, ${area.east}, ${area.north}]`
    );
  }
  const sx = source.width / (source.bounds.east - source.bounds.west);
  const sy = source.height / (source.bounds.north - source.bounds.south);
  const left = (area.west - source.bounds.west) * sx;
  const top = (source.bounds.north - area.north) * sy;
  const width = (area.east - area.west) * sx;
  const height = (area.north - area.south) * sy;
  const x0 = Math.max(0, Math.floor(left));
  const y0 = Math.max(0, Math.floor(top));
  const x1 = Math.min(source.width, Math.ceil(left + width));
  const y1 = Math.min(source.height, Math.ceil(top + height));

  return {
    floatWindow: { left, top, width, height },
    integerRead: { left: x0, top: y0, width: x1 - x0, height: y1 - y0 },
    windowWithinRead: { left: left - x0, top: top - y0, width, height },
  };
}

/**
 * 计算给定纬度处的真实地面空间分辨率 GSD (Ground Sampling Distance, 米)
 */
export function nativeGsdMeters(source: RasterSource, latitudeDeg: number, radiusM = 6371000) {
  assertBounds(source.bounds);
  if (
    !Number.isFinite(latitudeDeg) ||
    Math.abs(latitudeDeg) > 90 ||
    !Number.isFinite(radiusM) ||
    radiusM <= 0 ||
    !Number.isInteger(source.width) ||
    !Number.isInteger(source.height) ||
    source.width <= 0 ||
    source.height <= 0
  ) {
    throw new RangeError('Invalid GSD arguments');
  }
  return {
    eastWest:
      (radiusM * Math.cos(latitudeDeg * DEG) * (source.bounds.east - source.bounds.west) * DEG) /
      source.width,
    northSouth: (radiusM * (source.bounds.north - source.bounds.south) * DEG) / source.height,
  };
}

/**
 * 全球等距经纬图 UV 映射，南极 v=0, 北极 v=1, 180°W u=0, 180°E u=1
 */
export function globalUv(latitudeDeg: number, longitudeDeg: number): [number, number] {
  if (
    !Number.isFinite(latitudeDeg) ||
    Math.abs(latitudeDeg) > 90 ||
    !Number.isFinite(longitudeDeg)
  ) {
    throw new RangeError('Invalid coordinate');
  }
  const wrapped = (((longitudeDeg + 180) % 360) + 360) % 360 - 180;
  return [(wrapped + 180) / 360, (latitudeDeg + 90) / 180];
}

/**
 * 计算瓦片在全图夜景纹理中的 UV 仿射变换 (offset, scale)
 */
export function tileGlobalUvTransform(b: Bounds) {
  assertBounds(b);
  return {
    offset: [(b.west + 180) / 360, (b.south + 90) / 180] as const,
    scale: [(b.east - b.west) / 360, (b.north - b.south) / 180] as const,
  };
}
