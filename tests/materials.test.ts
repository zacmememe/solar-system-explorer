import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as THREE from 'three';
import { createEarthSurfaceMaterial, createEarthCloudMaterial, createAtmosphereHaloMaterial } from '../src/rendering/EarthMaterial';
import { createMarsMaterial } from '../src/rendering/MarsMaterial';
import { createVenusAtmosphereMaterial, createVenusRadarMaterial } from '../src/rendering/VenusMaterial';
import { createMoonMaterial } from '../src/rendering/MoonMaterial';
import { createSunMaterial, createSunCoronaMaterial } from '../src/rendering/SunMaterial';
import { createIceGiantMaterial } from '../src/rendering/IceGiantMaterial';
import { createJupiterMaterial } from '../src/rendering/JupiterMaterial';
import { createMercuryMaterial } from '../src/rendering/MercuryMaterial';
import { createAsteroidMoonMaterial } from '../src/rendering/AsteroidMoonMaterial';
import { createIoMaterial, createEuropaMaterial, createGanymedeMaterial, createCallistoMaterial } from '../src/rendering/GalileanMoonsMaterial';
import { createSaturnRingMaterial } from '../src/rendering/RingMaterial';

describe('批次 B2 着色器规范与色彩空间统一输出测试', () => {
  const renderingDir = path.resolve(__dirname, '../src/rendering');

  it('MAT-01: 所有着色器中杜绝任何倒序 smoothstep (edge0 >= edge1)', () => {
    const files = fs.readdirSync(renderingDir).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThanOrEqual(11);

    // 匹配 smoothstep(常数A, 常数B, ...) 的正则表达式
    const smoothstepRegex = /smoothstep\s*\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/g;

    const violations: Array<{ file: string; match: string; edge0: number; edge1: number }> = [];

    for (const file of files) {
      const content = fs.readFileSync(path.join(renderingDir, file), 'utf8');
      let match: RegExpExecArray | null;
      while ((match = smoothstepRegex.exec(content)) !== null) {
        const edge0 = parseFloat(match[1]);
        const edge1 = parseFloat(match[2]);
        if (edge0 >= edge1) {
          violations.push({
            file,
            match: match[0],
            edge0,
            edge1,
          });
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('MAT-02: 所有着色器材质均包含色彩空间与色调映射输出 Chunks 且杜绝冗余重复声明', () => {
    const files = fs.readdirSync(renderingDir).filter((f) => f.endsWith('.ts'));

    for (const file of files) {
      const content = fs.readFileSync(path.join(renderingDir, file), 'utf8');
      // Three.js WebGLProgram 默认在片元着色器全局前缀自动注入 pars，材质内部只需包含尾部映射转换 chunk
      expect(content).toContain('#include <colorspace_fragment>');
      expect(content).toContain('#include <tonemapping_fragment>');
      // 杜绝内部显式写 pars 导致 GLSL 编译器抛出 redefinition 致命错误
      expect(content).not.toContain('#include <colorspace_pars_fragment>');
      expect(content).not.toContain('#include <tonemapping_pars_fragment>');
    }
  });

  it('MAT-03: 所有着色器材质均可正常实例化且 Uniforms 完整', () => {
    const dummyTex = new THREE.Texture();

    const earthMat = createEarthSurfaceMaterial(dummyTex, dummyTex);
    const cloudMat = createEarthCloudMaterial(dummyTex);
    const haloMat = createAtmosphereHaloMaterial();
    const marsMat = createMarsMaterial(dummyTex);
    const venusAtmMat = createVenusAtmosphereMaterial(dummyTex);
    const venusRadarMat = createVenusRadarMaterial(dummyTex);
    const moonMat = createMoonMaterial(dummyTex);
    const sunMat = createSunMaterial(dummyTex);
    const coronaMat = createSunCoronaMaterial();
    const iceGiantMat = createIceGiantMaterial(dummyTex, 'uranus');
    const jupiterMat = createJupiterMaterial(dummyTex);
    const mercuryMat = createMercuryMaterial(dummyTex);
    const asteroidMat = createAsteroidMoonMaterial(dummyTex, 'phobos');
    const ioMat = createIoMaterial(dummyTex);
    const europaMat = createEuropaMaterial(dummyTex);
    const ganymedeMat = createGanymedeMaterial(dummyTex);
    const callistoMat = createCallistoMaterial(dummyTex);
    const ringMat = createSaturnRingMaterial({
      innerRadius: 10,
      outerRadius: 20,
      ringTexture: dummyTex,
      planetRadius: 8,
    });

    const allMaterials = [
      earthMat,
      cloudMat,
      haloMat,
      marsMat,
      venusAtmMat,
      venusRadarMat,
      moonMat,
      sunMat,
      coronaMat,
      iceGiantMat,
      jupiterMat,
      mercuryMat,
      asteroidMat,
      ioMat,
      europaMat,
      ganymedeMat,
      callistoMat,
      ringMat,
    ];

    for (const m of allMaterials) {
      expect(m).toBeInstanceOf(THREE.ShaderMaterial);
      expect(m.fragmentShader).toContain('#include <colorspace_fragment>');
      expect(m.fragmentShader).toContain('#include <tonemapping_fragment>');
    }
  });
});
