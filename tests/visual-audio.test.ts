import { describe, it, expect } from 'vitest';
import {
  getIoTexture,
  getEuropaTexture,
  getEnceladusTexture,
  getTitanNearInfraredTexture,
  getTitanHazeTexture,
  getGanymedeTexture,
  getCallistoTexture,
  getMarsMoonTexture,
} from '../src/astronomy/MoonTextures';
import { soundEffects } from '../src/audio/SoundEffects';
import { BODIES } from '../src/astronomy/bodies';

describe('视觉材质与深空音效科学管线测试', () => {
  it('应当正确生成全部核心卫星专属高拟真纹理', () => {
    const ioTex = getIoTexture();
    expect(ioTex).toBeDefined();

    const europaTex = getEuropaTexture();
    expect(europaTex).toBeDefined();

    const enceladusTex = getEnceladusTexture();
    expect(enceladusTex).toBeDefined();

    const titanHazeTex = getTitanHazeTexture();
    expect(titanHazeTex).toBeDefined();

    const titanIrTex = getTitanNearInfraredTexture();
    expect(titanIrTex).toBeDefined();

    const ganymedeTex = getGanymedeTexture();
    expect(ganymedeTex).toBeDefined();

    const callistoTex = getCallistoTexture();
    expect(callistoTex).toBeDefined();

    const phobosTex = getMarsMoonTexture(true);
    expect(phobosTex).toBeDefined();

    const deimosTex = getMarsMoonTexture(false);
    expect(deimosTex).toBeDefined();
  });

  it('应当正确配置天王星立式光环参数与自转轴倾角', () => {
    const uranus = BODIES.uranus;
    expect(uranus).toBeDefined();
    expect(uranus.axialTiltDeg).toBeCloseTo(97.77, 1);
    expect(uranus.ringConfig).toBeDefined();
    expect(uranus.ringConfig?.innerRadiusRatio).toBeGreaterThan(1.0);
    expect(uranus.ringConfig?.outerRadiusRatio).toBeGreaterThan(uranus.ringConfig?.innerRadiusRatio || 0);
  });

  it('应当核实木卫二观察提示文本自洽准确', () => {
    const europa = BODIES.europa;
    expect(europa.observationTip).toContain('木卫二');
    expect(europa.observationTip).not.toContain('木卫一');
  });

  it('音效引擎应当在安全降级环境下自愈并不抛出异常', () => {
    const initialMuted = soundEffects.getIsMuted();
    expect(typeof initialMuted).toBe('boolean');

    const toggled = soundEffects.toggleMute();
    expect(toggled).toBe(!initialMuted);

    // 再次翻转归位
    soundEffects.toggleMute();

    expect(() => {
      soundEffects.playClick();
      soundEffects.playWarp();
      soundEffects.playRadarPing();
      soundEffects.startAmbientDrone();
      soundEffects.stopAmbientDrone();
    }).not.toThrow();
  });
});
