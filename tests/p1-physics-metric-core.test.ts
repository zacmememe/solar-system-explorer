/**
 * 批次 P1「公共物理与米制空间内核」单元测试
 * 遵循 260923 Pro 审计 P1-a/P1-b/P1-c 与 docs/plans/2026-09-23-p1-physics-metric-core.md：
 * 1. 全系统物理快照完整性、诚实时间基/坐标系标识、速度 = 位置数值导数；
 * 2. Earth/Moon、Jupiter/Io、Saturn/Titan 四组父子系统物理比例一致（渲染反算角直径 = 物理公式）；
 * 3. 天王星 97.77° 极轴倾角在姿态四元数中还原；
 * 4. local-frame 正反变换、量级化误差预算（不承诺超越 double 精度）；
 * 5. 地表站点 0/6/12/18/24h 随自转的正反变换稳定性；
 * 6. CameraController SURFACE_LOOK 站点随天体四元数旋转、1.7m 眼高 0.1m 近裁剪面。
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { BodyPoseProvider } from '../src/astronomy/BodyPoseProvider';
import { BODIES, getNavDisplayRadius } from '../src/astronomy/bodies';
import { CameraController } from '../src/camera/CameraController';
import { TerrainHeightProvider } from '../src/surface/TerrainHeightProvider';
import { RasterTerrainSource } from '../src/surface/RasterTerrainSource';
import {
  geodeticToBodyFixedM,
  bodyFixedToPlanetocentric,
  bodyFixedToInertialKm,
  observerRelativeMeters,
  rotateByQuaternion,
  apparentAngularDiameterDeg,
  DATUM_WGS84,
  DATUM_MOON_SPHERE,
  datumForBody,
} from '../src/world-support/local-frame';
import type { BodyId } from '../src/contracts/body';

// P2 起：月面高程由真实 DTM 后端提供，站点类断言注入真实数据（Node 无相对 URL fetch）
beforeAll(async () => {
  const demDir = path.resolve('public/data/dem/apollo17-v1');
  const meta = JSON.parse(readFileSync(path.join(demDir, 'metadata.json'), 'utf-8'));
  const heightBuf = readFileSync(path.join(demDir, 'height.f32')).slice().buffer;
  const validBuf = readFileSync(path.join(demDir, 'valid.u8')).slice().buffer;
  const orthoBuf = readFileSync(path.join(demDir, 'ortho.u16')).slice().buffer;
  await RasterTerrainSource.getInstance().injectBuffers(meta, heightBuf, validBuf, orthoBuf);
});

const DEG = Math.PI / 180;

describe('批次 P1: 公共物理内核 (PhysicalSystemSnapshot)', () => {
  it('P1-01: 全系统快照完整、字段有限、时间基/坐标系标识诚实、quality 正确', () => {
    const provider = new BodyPoseProvider();
    const snap = provider.getPhysicalSystemSnapshot(5.5);

    const ids = Object.keys(BODIES) as BodyId[];
    expect(Object.keys(snap.bodies).length).toBe(ids.length);

    // 时间基诚实声明：解析近似黄道系 + 近似 TDB 换算，不冒充 ICRF/星历
    expect(snap.frameId).toBe('ECLIPTIC-ANALYTIC-APPROX');
    const utcSec = (Date.parse(BodyPoseProvider.BASE_EPOCH_ISO) - BodyPoseProvider.J2000_EPOCH_MS) / 1000 + 5.5 * 3600;
    expect(snap.tdbSecondsFromJ2000).toBeCloseTo(utcSec + 69.184, 6);

    for (const id of ids) {
      const st = snap.bodies[id];
      expect(st.id).toBe(id);
      expect(Number.isFinite(st.tdbSecondsFromJ2000)).toBe(true);
      for (const v of [st.positionKm, st.velocityKmPerSec, st.radiiKm]) {
        expect(v.every(Number.isFinite)).toBe(true);
      }
      expect(st.meanRadiusKm).toBeGreaterThan(0);
      expect(st.radiiKm.length).toBe(3);
      expect(st.quality).toBe('analytic-approximation');
      expect(st.positionFrameId).toBe('ECLIPTIC-ANALYTIC-APPROX');
      expect(st.cartographicFrameId).toBe('BODY-FIXED-RENDER-X0-YN-Z90E');
      const q = st.fixedToInertialQuaternion;
      expect(q.every(Number.isFinite)).toBe(true);
      expect(Math.hypot(q[0], q[1], q[2], q[3])).toBeCloseTo(1.0, 6);
      expect(typeof st.sourceVersion).toBe('string');
    }

    // 三轴半径保留扁率：地球 WGS84、土星强扁率
    const earth = snap.bodies.earth.radiiKm;
    expect(earth[0]).toBeCloseTo(6378.137, 1);
    expect(earth[2]).toBeCloseTo(6356.752, 1);
    expect(earth[2]).toBeLessThan(earth[0]);
    const saturn = snap.bodies.saturn.radiiKm;
    expect(saturn[0]).toBeCloseTo(60268, 0);
    expect(saturn[2]).toBeCloseTo(54364, 0);
  });

  it('P1-02: 有轨道天体的解析速度 = 位置数值中心差分导数；太阳速度为零允许', () => {
    const provider = new BodyPoseProvider();
    const t = 37.2;
    const h = 1.0; // 秒

    for (const id of Object.keys(BODIES) as BodyId[]) {
      const data = BODIES[id];
      const v = provider.getPhysicalVelocityKmPerSec(id, t);
      if (data.type === 'star') {
        // 太阳位于原点：速度恒零是正确解，不套"非零"要求
        expect(v).toEqual([0, 0, 0]);
        continue;
      }

      const pPlus = provider.getPhysicalPositionKm(id, t + h / 2 / 3600);
      const pMinus = provider.getPhysicalPositionKm(id, t - h / 2 / 3600);
      const vNum = [
        (pPlus[0] - pMinus[0]) / h,
        (pPlus[1] - pMinus[1]) / h,
        (pPlus[2] - pMinus[2]) / h,
      ];
      const err = Math.hypot(v[0] - vNum[0], v[1] - vNum[1], v[2] - vNum[2]);
      // 容差兼顾数值差分本身的浮点消去噪声（天体位置 ~1e9 km，秒级差分噪声 ~1e-6 km/s 量级）；
      // 结构性错误（漏加母星速度/方向错误）会是 km/s 量级，远超此阈
      const tol = Math.max(1e-4, Math.hypot(v[0], v[1], v[2]) * 1e-5);
      expect(err, `${id} 速度与数值导数偏差 ${err}`).toBeLessThan(tol);
      // 卫星速度应包含母星贡献 (非纯相对速度时也必须与全导数一致，上式已覆盖)
    }
  });

  it('P1-03: 地月/木星系/土星系物理比例一致——场景反算角直径与物理公式吻合', () => {
    const cases: Array<{ parent: BodyId; child: BodyId }> = [
      { parent: 'earth', child: 'moon' },
      { parent: 'jupiter', child: 'io' },
      { parent: 'saturn', child: 'titan' },
    ];

    for (const { parent, child } of cases) {
      const provider = new BodyPoseProvider('PHYSICAL_OBSERVATION');
      provider.setPhysicalReferenceBody(parent);
      // 完成过渡
      provider.update(10.0);
      expect(provider.getTransitionProgress()).toBe(1.0);

      const parentData = BODIES[parent];
      const childData = BODIES[child];
      const parentNavR = getNavDisplayRadius(parentData.radiusKm, parentData.type);
      const parentPose = provider.getBodyPose(parent, 0);
      const childPose = provider.getBodyPose(child, 0);

      // 参考行星保持导航半径为局部标尺
      expect(parentPose.displayRadius).toBeCloseTo(parentNavR, 6);

      // 物理比例：距离比与半径比都用同一物理公里数据换算
      const distScene = childPose.position.length();
      const expectDist = parentNavR * (childData.orbitSemiMajorAxisKm / parentData.radiusKm);
      expect(distScene).toBeCloseTo(expectDist, 4);

      const expectRadius = parentNavR * (childData.radiusKm / parentData.radiusKm);
      expect(childPose.displayRadius).toBeCloseTo(expectRadius, 6);

      // 渲染反算角直径 = 物理公式角直径 (同一几何，两种路径)
      const sceneAngular = 2 * Math.asin(Math.min(1, parentNavR / distScene)) / DEG;
      const physicalAngular = apparentAngularDiameterDeg(parentData.radiusKm, childData.orbitSemiMajorAxisKm);
      expect(Math.abs(sceneAngular - physicalAngular), `${parent}-${child}`).toBeLessThan(1e-6);
    }
  });

  it('P1-04: 天王星 97.77° 横躺极轴倾角在姿态四元数中精确还原', () => {
    const provider = new BodyPoseProvider();
    const q = provider.getFixedToInertialQuaternion('uranus', 0);
    const bodyNorthPole: [number, number, number] = [0, 1, 0];
    const inertialPole = rotateByQuaternion(bodyNorthPole, q);
    const angleDeg =
      Math.acos(
        Math.max(
          -1,
          Math.min(
            1,
            (inertialPole[0] * 0 + inertialPole[1] * 1 + inertialPole[2] * 0) /
              Math.hypot(inertialPole[0], inertialPole[1], inertialPole[2])
          )
        )
      ) / DEG;
    expect(angleDeg).toBeCloseTo(BODIES.uranus.axialTiltDeg, 9);
    expect(BODIES.uranus.axialTiltDeg).toBeCloseTo(97.77, 1);
  });
});

describe('批次 P1: 局部米制空间 (local-frame)', () => {
  it('P1-05: 大地坐标 ↔ body-fixed 球体往返与 WGS84 已知点', () => {
    // 球体 (月球 PA453) 往返
    const site = geodeticToBodyFixedM(20.35, 30.78, -2500, DATUM_MOON_SPHERE);
    const back = bodyFixedToPlanetocentric(site);
    expect(back.latDeg).toBeCloseTo(20.35, 9);
    expect(back.lonDeg).toBeCloseTo(30.78, 9);
    expect(back.radiusM).toBeCloseTo(1737400 - 2500, 6);

    // WGS84 已知点：赤道 0°经 高程0 -> x = a；北极 -> y = b
    const equator = geodeticToBodyFixedM(0, 0, 0, DATUM_WGS84);
    expect(equator[0]).toBeCloseTo(6378137.0, 3);
    expect(Math.hypot(equator[1], equator[2])).toBeCloseTo(0, 3);
    const pole = geodeticToBodyFixedM(90, 123.4, 0, DATUM_WGS84);
    expect(pole[1]).toBeCloseTo(6356752.314, 0);

    // 轴约定：+X=0°经、-Z=90°E
    const east90 = geodeticToBodyFixedM(0, 90, 0, DATUM_MOON_SPHERE);
    expect(east90[0]).toBeCloseTo(0, 6);
    expect(east90[2]).toBeCloseTo(-1737400, 3);

    // datum 选择
    expect(datumForBody('earth', 6371).name).toBe('WGS84');
    expect(datumForBody('moon', 1737.4).name).toBe('MOON_PA453');
    expect(datumForBody('venus', 6051.8).semiMajorM).toBeCloseTo(6051800, 0);
  });

  it('P1-06: observerRelativeMeters 按量级给出可实现误差预算 (double 相对精度)', () => {
    const magnitudesKm = [1e5, 1e8, 1e9, 4.5e9]; // 地月、1AU、外行星、海王星轨道量级
    for (const mag of magnitudesKm) {
      const target: [number, number, number] = [mag, -mag * 0.3, mag * 0.7];
      const observer: [number, number, number] = [mag + 1.7e-3, -mag * 0.3, mag * 0.7]; // 观察者在目标近旁 1.7m
      const rel = observerRelativeMeters(target, observer);
      const expectAbs = 1.7;
      const err = Math.abs(Math.hypot(rel[0], rel[1], rel[2]) - expectAbs);
      // double 相对精度 ~2.2e-16：误差上界 = 量级(米) × 1e-15 (留出安全余量)
      const budget = mag * 1000 * 1e-15;
      expect(err, `量级 ${mag} km 处误差 ${err} m 超出预算 ${budget} m`).toBeLessThan(Math.max(budget, 1e-9));
    }
  });

  it('P1-07: 地表站点 0/6/12/18/24 小时随自转的正反变换稳定性 (<1e-6°)', () => {
    const provider = new BodyPoseProvider();
    const lat = 20.35;
    const lon = 30.78;
    const heightM = -2500;
    const bodyPosKm: [number, number, number] = provider.getPhysicalPositionKm('moon', 0);
    const stationFixed = geodeticToBodyFixedM(lat, lon, heightM, DATUM_MOON_SPHERE);

    for (const tHours of [0, 6, 12, 18, 24]) {
      const quat = provider.getFixedToInertialQuaternion('moon', tHours);
      const bodyPosAtT: [number, number, number] = provider.getPhysicalPositionKm('moon', tHours);

      // 正变换：fixed -> inertial
      const inertial = bodyFixedToInertialKm(stationFixed, quat, bodyPosAtT);

      // 逆变换：inertial -> fixed (去中心 + 逆四元数；rel 为公里，回米制再比对)
      const relKm: [number, number, number] = [
        inertial[0] - bodyPosAtT[0],
        inertial[1] - bodyPosAtT[1],
        inertial[2] - bodyPosAtT[2],
      ];
      const invQuat: [number, number, number, number] = [-quat[0], -quat[1], -quat[2], quat[3]];
      const backFixedKm = rotateByQuaternion(relKm, invQuat);
      const backFixedM: [number, number, number] = [
        backFixedKm[0] * 1000,
        backFixedKm[1] * 1000,
        backFixedKm[2] * 1000,
      ];
      const geo = bodyFixedToPlanetocentric(backFixedM);

      expect(Math.abs(geo.latDeg - lat), `t=${tHours}h 纬度回算偏差`).toBeLessThan(1e-6);
      expect(Math.abs(geo.lonDeg - lon), `t=${tHours}h 经度回算偏差`).toBeLessThan(1e-6);
      expect(geo.radiusM).toBeCloseTo(1737400 + heightM, -1); // 米制往返不丢失高程
    }
    void bodyPosKm;
  });
});

describe('批次 P1: SURFACE_LOOK 站点随自转与米制近裁剪 (CameraController)', () => {
  it('P1-08: 站点/基向量应用同帧天体四元数，天体自转时机位跟随地理点', () => {
    const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 10000);
    const controller = new CameraController({ camera });

    const moonWorldPos = new THREE.Vector3(81.45, 0, 0);
    const surfaceRadius = 0.36815;
    const quatA = new THREE.Quaternion(); // 恒等
    const quatB = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      Math.PI / 3
    );

    const getBodyWorld = () => ({
      pos: moonWorldPos.clone(),
      radius: surfaceRadius,
      surfaceRadius,
      framingRadius: surfaceRadius,
      quaternion: quatA.clone(),
    });

    controller.executeCommand({
      type: 'enterSurfaceLook',
      bodyId: 'moon',
      lat: 20.35,
      lon: 30.78,
      eyeHeightM: 1.7,
      initialYawDeg: 225,
      initialPitchDeg: 12,
    });
    controller.update(0.016, getBodyWorld);

    // 期望机位 = bodyPos + q·(站点local) + q·u·eyeHeightScene
    const metricScale = surfaceRadius / 1737400;
    const heightProvider = TerrainHeightProvider.getInstance();
    const siteLocal = heightProvider.latLonToVector3('moon', 20.35, 30.78, surfaceRadius);
    const latRad = 20.35 * DEG;
    const lonRad = 30.78 * DEG;
    const cosLat = Math.cos(latRad);
    const uLocal = new THREE.Vector3(
      cosLat * Math.cos(lonRad),
      Math.sin(latRad),
      -cosLat * Math.sin(lonRad)
    ).normalize();

    const expectEye = (q: THREE.Quaternion) =>
      moonWorldPos
        .clone()
        .add(siteLocal.clone().applyQuaternion(q))
        .addScaledVector(uLocal.clone().applyQuaternion(q), 1.7 * metricScale);

    const eyeA = expectEye(quatA);
    expect(camera.position.x).toBeCloseTo(eyeA.x, 6);
    expect(camera.position.y).toBeCloseTo(eyeA.y, 6);
    expect(camera.position.z).toBeCloseTo(eyeA.z, 6);

    // 天体自转 60°：同一地理点的世界机位必须随之变换 (而非停留原地)
    const rotatedProvider = () => ({
      pos: moonWorldPos.clone(),
      radius: surfaceRadius,
      surfaceRadius,
      framingRadius: surfaceRadius,
      quaternion: quatB.clone(),
    });
    controller.update(0.016, rotatedProvider);
    const eyeB = expectEye(quatB);
    expect(camera.position.x).toBeCloseTo(eyeB.x, 6);
    expect(camera.position.y).toBeCloseTo(eyeB.y, 6);
    expect(camera.position.z).toBeCloseTo(eyeB.z, 6);
    // 机位确实随姿态移动 (非恒定)
    expect(camera.position.distanceTo(eyeA)).toBeGreaterThan(0.1);
  });

  it('P1-09: 1.7m 眼高下近裁剪面为 0.1m 米制等效，站点描述符为真实向量', () => {
    const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 10000);
    const controller = new CameraController({ camera });

    const surfaceRadius = 0.36815;
    const getBodyWorld = () => ({
      pos: new THREE.Vector3(81.45, 0, 0),
      radius: surfaceRadius,
      surfaceRadius,
      framingRadius: surfaceRadius,
      quaternion: new THREE.Quaternion(),
    });

    controller.executeCommand({
      type: 'enterSurfaceLook',
      bodyId: 'moon',
      lat: 20.35,
      lon: 30.78,
      eyeHeightM: 1.7,
    });
    controller.update(0.016, getBodyWorld);

    // 0.1m 的场景等效
    const expectNear = 0.1 * (surfaceRadius / 1737400);
    expect(camera.near).toBeCloseTo(expectNear, 12);
    // 不再是旧 1e-4 场景单位 (那在该比例下约 472m，而非 0.1mm)
    expect(camera.near).toBeLessThan(1e-4);

    // 站点描述符：真实 body-fixed 坐标与单位法线，非占位
    const pose = controller.getSurfaceStationPose();
    expect(pose).not.toBeNull();
    const station = pose!.station;
    expect(station.bodyId).toBe('moon');
    expect(station.datum).toBe('MOON_PA453');
    expect(station.heightM).toBeLessThan(-1400); // 谷底地面高程：真实 DTM 站点值 ≈ −1690.9 m (P2)
    expect(station.heightM).toBeGreaterThan(-2000);
    expect(station.eyeHeightM).toBe(1.7);
    const posLen = Math.hypot(...station.bodyFixedPosM);
    expect(posLen).toBeCloseTo(1737400 + station.heightM, -1);
    expect(station.bodyFixedPosM).not.toEqual([0, 0, 0]);
    const nLen = Math.hypot(...station.surfaceNormal);
    expect(nLen).toBeCloseTo(1.0, 9);
    expect(station.surfaceNormal).not.toEqual([0, 1, 0]);
    expect(station.orientationDeg?.yawDeg).toBe(225);
    expect(station.orientationDeg?.pitchDeg).toBe(12);

    // 非地面模式下无站点描述符
    controller.executeCommand({ type: 'flyTo', bodyId: 'moon', durationSec: 0.1 });
    controller.update(0.2, getBodyWorld);
    expect(controller.getSurfaceStationPose()).toBeNull();
  });
});
