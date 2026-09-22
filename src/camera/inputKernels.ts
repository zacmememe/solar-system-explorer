/**
 * 连续输入与对数间距数学内核
 * 依据 Pro Model 交接规范与 reference-kernels.mjs：
 * 1. 规范化不同浏览器与设备的 WheelEvent deltaMode（0 像素、1 行、2 页）；
 * 2. 触控双指 pinch 无量纲对数比值计算；
 * 3. 浮点精度保护与安全数值限制。
 */

export function normalizeWheelDelta(
  deltaY: number,
  deltaMode: number,
  viewportHeightPx: number,
  lineHeightPx: number = 16
): number {
  if (!Number.isFinite(deltaY) || !Number.isFinite(viewportHeightPx) || !Number.isFinite(lineHeightPx)) {
    throw new TypeError('All inputs must be finite numbers');
  }
  if (viewportHeightPx <= 0 || lineHeightPx <= 0) {
    throw new RangeError('Positive dimensions required');
  }
  const modeMultipliers = [1, lineHeightPx, viewportHeightPx];
  const multiplier = modeMultipliers[deltaMode];
  if (multiplier === undefined) {
    throw new RangeError(`Unknown WheelEvent.deltaMode: ${deltaMode}`);
  }
  return deltaY * multiplier;
}

export function pinchLogDelta(previousSpanPx: number, currentSpanPx: number): number {
  if (!(previousSpanPx > 0 && currentSpanPx > 0)) {
    throw new RangeError('Positive spans required for pinch gesture');
  }
  if (!Number.isFinite(previousSpanPx) || !Number.isFinite(currentSpanPx)) {
    throw new TypeError('Spans must be finite numbers');
  }
  return Math.log(previousSpanPx / currentSpanPx);
}
