import { describe, it, expect } from 'vitest';
import { BODIES, computeRenderTransform, getMoonPositionKm } from '../src/astronomy/bodies';

describe('天体尺度与局部坐标系测试', () => {
  it('SCALE-01: 双精度千米坐标正确转换为 GPU 局部坐标，防止绝对大尺度抖动', () => {
    // 地球在原点
    const earthTransform = computeRenderTransform([0, 0, 0], [0, 0, 0], BODIES.earth.radiusKm);
    expect(earthTransform.renderRadius).toBeCloseTo(6.371, 3);
    expect(earthTransform.renderPosition).toEqual([0, 0, 0]);

    // 月球物理坐标 [384400, 0, 0]
    const moonPosKm: [number, number, number] = [384400, 0, 0];
    const moonTransform = computeRenderTransform(moonPosKm, [0, 0, 0], BODIES.moon.radiusKm);
    expect(moonTransform.renderRadius).toBeCloseTo(1.7374, 3);
    expect(moonTransform.renderPosition[0]).toBeCloseTo(384.4, 3);
    expect(moonTransform.renderPosition[1]).toBe(0);
    expect(moonTransform.renderPosition[2]).toBe(0);
  });

  it('SCALE-02: 以月球为焦点时，局部原点自动平移', () => {
    const moonPosKm: [number, number, number] = [384400, 5000, 10000];
    // 当前原点设在月球中心
    const localTransform = computeRenderTransform(moonPosKm, moonPosKm, BODIES.moon.radiusKm);
    expect(localTransform.renderPosition).toEqual([0, 0, 0]);
  });

  it('SCALE-03: 月球轨道公转计算返回有限稳定数值，距离保持在真实轨道半长轴附近', () => {
    for (let h = 0; h <= 24 * 30; h += 24) {
      const pos = getMoonPositionKm(h);
      expect(Number.isFinite(pos[0])).toBe(true);
      expect(Number.isFinite(pos[1])).toBe(true);
      expect(Number.isFinite(pos[2])).toBe(true);

      const distance = Math.hypot(pos[0], pos[1], pos[2]);
      expect(distance).toBeCloseTo(384400, 0);
    }
  });
});
