/**
 * 航天器高拟真 3D 几何网格构建器 VehicleMeshBuilder (2.0 终极博物馆级拟真版)
 * 遵循 04-VEHICLES.zh-CN.md 规范：
 * 1. 彻底根除立方体粗糙建模，采用真实航天工程外形与多面切角结构；
 * 2. 真实米制尺寸建模（1 Scene Unit = 1 米）；
 * 3. 搭载程序化高分辨率 PBR 贴图（太阳能单晶硅栅线、金色 Kapton/Mylar 多层隔热褶皱、空间站白色隔热外壳与铆钉）；
 * 4. 真实视窗材质（深色防反光偏振航天玻璃，严禁荧光扁平色块）；
 * 5. 丰富的机械结构细节：RCS 姿态喷管四联装、天线三脚架、太阳翼回转机构、减速伞罩、月球探测触针。
 */

import * as THREE from 'three';
import type { VehicleId } from '../contracts/vehicle';
import {
  getSolarPanelTexture,
  getGoldFoilTexture,
  getHullPanelTexture,
  getDarkCarbonTexture,
} from './VehicleTextures';

export class VehicleMeshBuilder {
  /**
   * 构建指定航天器的完整 3D Group
   */
  public static buildVehicle(id: VehicleId): THREE.Group {
    const group = new THREE.Group();
    group.name = `vehicle-${id}`;

    switch (id) {
      case 'apollo-lm':
        this.buildApolloLM(group);
        break;
      case 'voyager-1':
        this.buildVoyager(group);
        break;
      case 'james-webb':
        this.buildWebb(group);
        break;
      case 'iss':
        this.buildISS(group);
        break;
      case 'tiangong':
        this.buildTiangong(group);
        break;
      case 'cassini':
        this.buildCassini(group);
        break;
      case 'hubble':
        this.buildHubble(group);
        break;
    }

    return group;
  }

  // =========================================================================
  // 1. 阿波罗 11 号登月舱 (Apollo 11 Lunar Module "Eagle")
  // =========================================================================
  private static buildApolloLM(parent: THREE.Group): void {
    const goldTex = getGoldFoilTexture();
    const hullTex = getHullPanelTexture();
    const darkTex = getDarkCarbonTexture();

    // 材质定义
    const goldMylarMat = new THREE.MeshStandardMaterial({
      map: goldTex,
      metalness: 0.88,
      roughness: 0.28,
    });
    const ascentHullMat = new THREE.MeshStandardMaterial({
      map: hullTex,
      metalness: 0.65,
      roughness: 0.38,
    });
    const darkTitaniumMat = new THREE.MeshStandardMaterial({
      map: darkTex,
      metalness: 0.9,
      roughness: 0.22,
    });
    // 真实深色防反光航天座舱玻璃
    const cockpitGlassMat = new THREE.MeshPhysicalMaterial({
      color: 0x0f172a,
      metalness: 0.95,
      roughness: 0.08,
      reflectivity: 0.9,
      clearcoat: 1.0,
      clearcoatRoughness: 0.1,
    });

    // -----------------------------------------------------------------------
    // A. 下降级 (Descent Stage)
    // -----------------------------------------------------------------------
    // 八角柱主体外形（包覆金色 Mylar 隔热毯）
    const descentGeo = new THREE.CylinderGeometry(2.1, 2.3, 1.6, 8);
    const descentMesh = new THREE.Mesh(descentGeo, goldMylarMat);
    descentMesh.position.y = -0.8;
    parent.add(descentMesh);

    // 下降级侧壁黑镍隔热面板 (Quadrant 2/4 标志性黑色隔热带)
    const blackPanelGeo = new THREE.PlaneGeometry(1.6, 1.4);
    for (const angle of [Math.PI / 4, (5 * Math.PI) / 4]) {
      const bp = new THREE.Mesh(blackPanelGeo, darkTitaniumMat);
      bp.position.set(2.15 * Math.sin(angle), -0.8, 2.15 * Math.cos(angle));
      bp.rotation.y = angle;
      parent.add(bp);
    }

    // 下降级主火箭发动机大喷管 (DPS: Descent Propulsion System)
    const engineGeo = new THREE.ConeGeometry(0.85, 1.3, 24, 2, true);
    const engineMesh = new THREE.Mesh(engineGeo, darkTitaniumMat);
    engineMesh.rotation.x = Math.PI;
    engineMesh.position.y = -1.95;
    parent.add(engineMesh);

    // 发动机热屏蔽环
    const shieldRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.86, 0.06, 12, 24),
      goldMylarMat
    );
    shieldRing.rotation.x = Math.PI / 2;
    shieldRing.position.y = -2.55;
    parent.add(shieldRing);

    // 四组主着陆支架与足垫 (Landing Gear)
    for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI) / 2 + Math.PI / 4;
      const legGroup = new THREE.Group();
      legGroup.rotation.y = angle;

      // 主支撑外伸斜梁 (含隔热金箔包覆)
      const mainStrut = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.08, 3.4, 12),
        goldMylarMat
      );
      mainStrut.position.set(2.1, -1.8, 0);
      mainStrut.rotation.z = Math.PI / 3.3;
      legGroup.add(mainStrut);

      // 二级减震 A 字交叉支撑臂
      for (const sign of [-1, 1]) {
        const secStrut = new THREE.Mesh(
          new THREE.CylinderGeometry(0.04, 0.04, 2.4, 8),
          darkTitaniumMat
        );
        secStrut.position.set(1.6, -1.7, sign * 0.55);
        secStrut.rotation.z = Math.PI / 3.8;
        secStrut.rotation.x = sign * 0.28;
        legGroup.add(secStrut);
      }

      // 碗状自平衡着陆足垫 (Footpad: 直径 0.9m)
      const pad = new THREE.Mesh(
        new THREE.CylinderGeometry(0.48, 0.45, 0.1, 16),
        goldMylarMat
      );
      pad.position.set(3.5, -2.65, 0);
      legGroup.add(pad);

      // 月表触针 (Lunar surface sensing probe: 1.7m 长金属探针)
      if (i !== 0) { // 前腿无探针，防阻碍航天员下登月梯
        const probe = new THREE.Mesh(
          new THREE.CylinderGeometry(0.015, 0.015, 1.7, 6),
          darkTitaniumMat
        );
        probe.position.set(3.5, -3.5, 0);
        legGroup.add(probe);
      }

      parent.add(legGroup);
    }

    // 登月舷梯与前门出舱平台 (Ladder & Porch: 位于 +Z 前向支架)
    const ladderGroup = new THREE.Group();
    ladderGroup.rotation.y = Math.PI / 4;
    for (let r = 0; r < 9; r++) {
      const rung = new THREE.Mesh(
        new THREE.CylinderGeometry(0.02, 0.02, 0.42, 8),
        darkTitaniumMat
      );
      rung.rotation.z = Math.PI / 2;
      rung.position.set(1.4 + r * 0.22, -0.9 - r * 0.18, 0);
      ladderGroup.add(rung);
    }
    // 出舱小平台 (Porch)
    const porch = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.06, 0.45),
      darkTitaniumMat
    );
    porch.position.set(1.3, -0.75, 0);
    ladderGroup.add(porch);
    parent.add(ladderGroup);

    // -----------------------------------------------------------------------
    // B. 上升级 (Ascent Stage)
    // -----------------------------------------------------------------------
    // 核心座舱：多面切角舱体（圆柱形前舱 + 梯形切角前舱壁）
    const cabinCenter = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 1.25, 1.45, 16),
      ascentHullMat
    );
    cabinCenter.position.set(0, 0.72, 0.05);
    parent.add(cabinCenter);

    // 前向驾驶区切角突出部 (Cockpit nose face)
    const noseGeo = new THREE.CylinderGeometry(0.95, 1.05, 1.35, 6);
    const nose = new THREE.Mesh(noseGeo, ascentHullMat);
    nose.position.set(0, 0.68, 0.85);
    nose.rotation.y = Math.PI / 6;
    parent.add(nose);

    // 两侧燃料贮箱弧形舱室 (Midsection Propellant Enclosures)
    for (const sign of [-1, 1]) {
      const tankPod = new THREE.Mesh(
        new THREE.CylinderGeometry(0.68, 0.68, 1.35, 16),
        goldMylarMat
      );
      tankPod.rotation.z = Math.PI / 2;
      tankPod.position.set(sign * 1.35, 0.65, 0.05);
      parent.add(tankPod);
    }

    // 后部仪器设备舱 (Aft Equipment Bay)
    const aftBay = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 1.25, 0.9),
      darkTitaniumMat
    );
    aftBay.position.set(0, 0.68, -0.95);
    parent.add(aftBay);

    // 航天员前视窗：两扇向下倾斜 25° 的特征倒三角深色视窗
    const windowShape = new THREE.Shape();
    windowShape.moveTo(0, 0.28);
    windowShape.lineTo(0.24, -0.2);
    windowShape.lineTo(-0.24, -0.2);
    windowShape.closePath();
    const windowGeo = new THREE.ShapeGeometry(windowShape);

    for (const sign of [-1, 1]) {
      const winMesh = new THREE.Mesh(windowGeo, cockpitGlassMat);
      winMesh.position.set(sign * 0.42, 0.95, 1.38);
      winMesh.rotation.x = -0.38; // 向下看月表
      winMesh.rotation.y = sign * 0.22;
      winMesh.rotation.z = Math.PI; // 倒三角
      parent.add(winMesh);
    }

    // 顶部舱外对接口与头顶观测窗 (Overhead Docking Tunnel)
    const dockTunnel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.48, 0.48, 0.35, 20),
      darkTitaniumMat
    );
    dockTunnel.position.set(0, 1.55, 0.2);
    parent.add(dockTunnel);

    // 四组十字形姿态控制发动机喷管组件 (RCS Quads)
    for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI) / 2 + Math.PI / 4;
      const rcsMount = new THREE.Group();
      rcsMount.rotation.y = angle;
      rcsMount.position.set(1.55 * Math.sin(angle), 0.85, 1.55 * Math.cos(angle));

      // 桁架安装悬臂
      const outrigger = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.04, 0.5, 8),
        darkTitaniumMat
      );
      outrigger.rotation.z = Math.PI / 2;
      rcsMount.add(outrigger);

      // 四向十字微型发动机喷管
      for (let j = 0; j < 4; j++) {
        const nozz = new THREE.Mesh(
          new THREE.ConeGeometry(0.05, 0.16, 10),
          darkTitaniumMat
        );
        nozz.rotation.z = (j * Math.PI) / 2;
        nozz.position.x = 0.12 * Math.cos((j * Math.PI) / 2);
        nozz.position.y = 0.12 * Math.sin((j * Math.PI) / 2);
        rcsMount.add(nozz);
      }
      parent.add(rcsMount);
    }

    // S-Band 可转向高增益网状抛物面天线 (S-band Steerable Antenna)
    const sBandGroup = new THREE.Group();
    sBandGroup.position.set(0.85, 1.65, -0.6);
    const sDish = new THREE.Mesh(
      new THREE.SphereGeometry(0.38, 16, 8, 0, Math.PI * 2, 0, Math.PI / 3),
      darkTitaniumMat
    );
    sDish.rotation.x = Math.PI * 0.8;
    sBandGroup.add(sDish);
    parent.add(sBandGroup);
  }

  // =========================================================================
  // 2. 旅行者 1 号深空飞掠探测器 (Voyager 1)
  // =========================================================================
  private static buildVoyager(parent: THREE.Group): void {
    const goldTex = getGoldFoilTexture();
    const darkTex = getDarkCarbonTexture();

    const dishWhiteMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.28,
      metalness: 0.1,
    });
    const goldRecordMat = new THREE.MeshStandardMaterial({
      map: goldTex,
      metalness: 0.95,
      roughness: 0.15,
    });
    const busMat = new THREE.MeshStandardMaterial({
      map: darkTex,
      metalness: 0.75,
      roughness: 0.35,
    });
    const trussMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.85,
      roughness: 0.25,
    });

    // 1. 顶部 3.7 米大口径白色抛物面高增益天线 (High-Gain Antenna)
    const dishGeo = new THREE.SphereGeometry(1.85, 36, 18, 0, Math.PI * 2, 0, Math.PI / 3.2);
    const dish = new THREE.Mesh(dishGeo, dishWhiteMat);
    dish.rotation.x = Math.PI;
    dish.position.y = 0.55;
    parent.add(dish);

    // 背面结构加筋环
    const rimRing = new THREE.Mesh(new THREE.TorusGeometry(1.84, 0.04, 8, 36), trussMat);
    rimRing.rotation.x = Math.PI / 2;
    rimRing.position.y = 0.55;
    parent.add(rimRing);

    // 副反射器中心圆锥与支撑三脚架 (Sub-reflector Tripod)
    const subReflector = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.28, 16), busMat);
    subReflector.position.y = 1.68;
    parent.add(subReflector);

    for (let i = 0; i < 3; i++) {
      const angle = (i * Math.PI * 2) / 3;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1.25), trussMat);
      leg.position.set(0.62 * Math.cos(angle), 1.05, 0.62 * Math.sin(angle));
      leg.rotation.x = 0.45 * Math.sin(angle);
      leg.rotation.z = -0.45 * Math.cos(angle);
      parent.add(leg);
    }

    // 2. 中部：十边形电子设备舱主体 (10-sided Bus)
    const busGeo = new THREE.CylinderGeometry(0.92, 0.92, 0.52, 10);
    const bus = new THREE.Mesh(busGeo, busMat);
    bus.position.y = 0.18;
    parent.add(bus);

    // 3. 镀金旅行者唱片 (The Golden Record: 附刻印纹理)
    const recordGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.03, 32);
    const record = new THREE.Mesh(recordGeo, goldRecordMat);
    record.rotation.z = Math.PI / 2;
    record.position.set(0.94, 0.18, 0);
    parent.add(record);

    // 4. 13 米磁强计三角桁架伸展臂 (Magnetometer Boom)
    const magBoom = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 5.2, 8),
      trussMat
    );
    magBoom.rotation.z = Math.PI / 2.3;
    magBoom.position.set(2.6, 0.1, -0.4);
    parent.add(magBoom);

    // 磁强计末端双探头
    const magSensor = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), goldRecordMat);
    magSensor.position.set(5.1, 1.1, -0.4);
    parent.add(magSensor);

    // 5. RTG 放射性同位素温差热电机伸臂与 3 座发电机
    const rtgBoom = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 2.2, 8),
      trussMat
    );
    rtgBoom.rotation.z = -Math.PI / 2.6;
    rtgBoom.position.set(-1.25, -0.22, 0.35);
    parent.add(rtgBoom);

    for (let i = 0; i < 3; i++) {
      const rtgCanister = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.16, 0.52, 16),
        busMat
      );
      rtgCanister.position.set(-2.05 - i * 0.28, -0.65 - i * 0.12, 0.45);
      parent.add(rtgCanister);

      // 散热辐射翼片环
      const fin = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.02, 6, 16), trussMat);
      fin.rotation.x = Math.PI / 2;
      fin.position.copy(rtgCanister.position);
      parent.add(fin);
    }

    // 6. 科学扫描平台 (Science Scan Platform: 广角/窄角相机、红外干涉仪)
    const scanPlatform = new THREE.Group();
    scanPlatform.position.set(0, -0.45, 0.85);

    const cam1 = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.45, 12), busMat);
    cam1.rotation.x = Math.PI / 2;
    scanPlatform.add(cam1);

    const cam2 = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.35, 12), busMat);
    cam2.rotation.x = Math.PI / 2;
    cam2.position.set(0.22, 0, 0);
    scanPlatform.add(cam2);

    parent.add(scanPlatform);
  }

  // =========================================================================
  // 3. 詹姆斯·韦伯太空望远镜 (James Webb Space Telescope - JWST)
  // =========================================================================
  private static buildWebb(parent: THREE.Group): void {
    const goldTex = getGoldFoilTexture();
    const darkTex = getDarkCarbonTexture();

    const goldMirrorMat = new THREE.MeshStandardMaterial({
      map: goldTex,
      metalness: 0.98,
      roughness: 0.1,
    });
    const sunshieldTopMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      metalness: 0.82,
      roughness: 0.28,
      side: THREE.DoubleSide,
    });
    const sunshieldBottomMat = new THREE.MeshStandardMaterial({
      color: 0x9333ea, // 底面特征性 Kapton 硅化紫粉色
      metalness: 0.75,
      roughness: 0.35,
      side: THREE.DoubleSide,
    });
    const carbonFrameMat = new THREE.MeshStandardMaterial({
      map: darkTex,
      metalness: 0.85,
      roughness: 0.25,
    });

    // 1. 五层微弧度网球场菱形遮阳薄膜 (5-Layer Sunshield)
    for (let layer = 0; layer < 5; layer++) {
      const shieldShape = new THREE.Shape();
      const w = 4.3 - layer * 0.12;
      const l = 6.4 - layer * 0.15;
      shieldShape.moveTo(0, l);
      shieldShape.lineTo(w, 0);
      shieldShape.lineTo(0, -l);
      shieldShape.lineTo(-w, 0);
      shieldShape.closePath();

      const shieldGeo = new THREE.ShapeGeometry(shieldShape);
      const shield = new THREE.Mesh(
        shieldGeo,
        layer < 2 ? sunshieldBottomMat : sunshieldTopMat
      );
      shield.rotation.x = Math.PI / 2;
      shield.position.y = -0.55 - layer * 0.09;
      parent.add(shield);
    }

    // 左右张紧展开桁架 (Spreader Boom)
    const boom = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 8.8, 8),
      carbonFrameMat
    );
    boom.rotation.z = Math.PI / 2;
    boom.position.set(0, -0.75, 0);
    parent.add(boom);

    // 2. 镀金六边形主镜阵列 (18 块精密六边形镜面组合，带中央通光孔)
    const mirrorGroup = new THREE.Group();
    mirrorGroup.position.set(0, 0.85, 0.1);

    const hexRadius = 0.44;
    const hexGeo = new THREE.CircleGeometry(hexRadius, 6);

    const hexPositions: [number, number][] = [
      // 内环 6 块
      [0, 0.78], [0.68, 0.39], [0.68, -0.39], [0, -0.78], [-0.68, -0.39], [-0.68, 0.39],
      // 外环 12 块
      [0, 1.56], [0.68, 1.17], [1.36, 0.78], [1.36, 0], [1.36, -0.78], [0.68, -1.17],
      [0, -1.56], [-0.68, -1.17], [-1.36, -0.78], [-1.36, 0], [-1.36, 0.78], [-0.68, 1.17],
    ];

    for (const [hx, hy] of hexPositions) {
      const hexMesh = new THREE.Mesh(hexGeo, goldMirrorMat);
      hexMesh.position.set(hx, hy, 0);
      mirrorGroup.add(hexMesh);
    }

    // 主镜背衬碳纤维蜂窝背板 (Backplane)
    const backplane = new THREE.Mesh(
      new THREE.CylinderGeometry(1.9, 1.9, 0.25, 12),
      carbonFrameMat
    );
    backplane.rotation.x = Math.PI / 2;
    backplane.position.z = -0.15;
    mirrorGroup.add(backplane);

    // 中央次镜光学子系统塔 (Aft Optics Subsystem tower)
    const aosTower = new THREE.Mesh(
      new THREE.CylinderGeometry(0.24, 0.28, 0.6, 12),
      carbonFrameMat
    );
    aosTower.rotation.x = Math.PI / 2;
    aosTower.position.z = 0.3;
    mirrorGroup.add(aosTower);

    parent.add(mirrorGroup);

    // 3. 副镜支撑三脚架与圆形次镜 (Secondary Mirror Assembly)
    const secMirrorPos = new THREE.Vector3(0, 0.85, 2.35);
    const secMirror = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.22, 0.06, 16),
      goldMirrorMat
    );
    secMirror.rotation.x = Math.PI / 2;
    secMirror.position.copy(secMirrorPos);
    parent.add(secMirror);

    // 顶端上桁架
    const topStrut = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 2.5, 8),
      carbonFrameMat
    );
    topStrut.position.set(0, 2.05, 1.25);
    topStrut.rotation.x = -Math.PI / 4.2;
    parent.add(topStrut);

    // 左右下桁架
    for (const sign of [-1, 1]) {
      const strut = new THREE.Mesh(
        new THREE.CylinderGeometry(0.025, 0.025, 2.6, 8),
        carbonFrameMat
      );
      strut.position.set(sign * 1.05, -0.18, 1.25);
      strut.rotation.x = Math.PI / 4.4;
      strut.rotation.z = -sign * 0.42;
      parent.add(strut);
    }

    // 4. 遮阳帆底部的航天器平台与可倾转太阳能帆板 (Spacecraft Bus & Solar Wing)
    const bus = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.65, 1.1), carbonFrameMat);
    bus.position.set(0, -1.35, 0);
    parent.add(bus);

    const solarTex = getSolarPanelTexture();
    const solarMat = new THREE.MeshStandardMaterial({
      map: solarTex,
      metalness: 0.9,
      roughness: 0.2,
      side: THREE.DoubleSide,
    });
    const solarWing = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 3.2), solarMat);
    solarWing.position.set(0, -1.5, -1.8);
    solarWing.rotation.x = -Math.PI / 3;
    parent.add(solarWing);
  }

  // =========================================================================
  // 4. 国际空间站 (International Space Station - ISS)
  // =========================================================================
  private static buildISS(parent: THREE.Group): void {
    const solarTex = getSolarPanelTexture();
    const hullTex = getHullPanelTexture();
    const darkTex = getDarkCarbonTexture();

    const trussMat = new THREE.MeshStandardMaterial({
      map: darkTex,
      metalness: 0.82,
      roughness: 0.3,
    });
    const moduleMat = new THREE.MeshStandardMaterial({
      map: hullTex,
      metalness: 0.6,
      roughness: 0.35,
    });
    const solarMat = new THREE.MeshStandardMaterial({
      map: solarTex,
      // Covered solar cells are not a continuous metal surface. At .92 the
      // dark cell texture loses almost all diffuse response in space lighting.
      // Keep the texture/specular roughness; do not brighten with emission.
      name: 'iss-solar-cells',
      metalness: 0,
      roughness: 0.18,
      side: THREE.DoubleSide,
    });
    const radiatorMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      metalness: 0.3,
      roughness: 0.6,
      side: THREE.DoubleSide,
    });
    const cupolaGlassMat = new THREE.MeshPhysicalMaterial({
      color: 0x0284c7,
      metalness: 0.9,
      roughness: 0.1,
      clearcoat: 1.0,
    });

    // 1. 中央贯通式主综合桁架 (ITS: Integrated Truss Structure: 跨度 109m 比例)
    const trussMesh = new THREE.Mesh(new THREE.BoxGeometry(10.2, 0.28, 0.28), trussMat);
    parent.add(trussMesh);

    // 桁架加固斜拉交叉结构
    for (let x = -4.5; x <= 4.5; x += 1.5) {
      const ring = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.42, 0.42), trussMat);
      ring.position.x = x;
      parent.add(ring);
    }

    // 2. 8 组巨大双面太阳能电池翼 (SAW)
    for (const side of [-1, 1]) {
      for (let i = 0; i < 2; i++) {
        const xOffset = side * (3.3 + i * 1.5);
        for (const ySign of [-1, 1]) {
          const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 2.45), solarMat);
          panel.position.set(xOffset, ySign * 1.45, 0);
          parent.add(panel);

          // 电池翼中央展开盒 (Mast canister)
          const mast = new THREE.Mesh(
            new THREE.CylinderGeometry(0.04, 0.04, 2.5, 8),
            trussMat
          );
          mast.position.set(xOffset, ySign * 1.45, 0);
          parent.add(mast);
        }
      }
    }

    // 3. 垂直白色主动散热辐射板 (Thermal Radiators: 垂直于太阳翼)
    for (const side of [-1, 1]) {
      const radiator = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 1.8), radiatorMat);
      radiator.position.set(side * 1.6, 0, -1.05);
      radiator.rotation.y = Math.PI / 2;
      parent.add(radiator);
    }

    // 4. 纵向加压舱段群 (Destiny, Unity, Harmony, Zarya, Zvezda)
    for (let m = -2; m <= 2; m++) {
      const mod = new THREE.Mesh(
        new THREE.CylinderGeometry(0.32, 0.32, 1.25, 20),
        moduleMat
      );
      mod.rotation.x = Math.PI / 2;
      mod.position.set(0, 0, m * 1.25);
      parent.add(mod);

      // 对接舱环与强化带
      const band = new THREE.Mesh(
        new THREE.TorusGeometry(0.33, 0.025, 8, 20),
        trussMat
      );
      band.position.set(0, 0, m * 1.25);
      parent.add(band);
    }

    // 国际实验舱段横向扩展 (Columbus / Kibo / JEM EF)
    for (const sign of [-1, 1]) {
      const lab = new THREE.Mesh(
        new THREE.CylinderGeometry(0.29, 0.29, 1.15, 16),
        moduleMat
      );
      lab.rotation.z = Math.PI / 2;
      lab.position.set(sign * 0.85, 0, 0.65);
      parent.add(lab);
    }

    // 5. 欧洲制造圆顶观测舱 (Cupola: 7 扇观地视窗)
    const cupola = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.28, 0.22, 7),
      cupolaGlassMat
    );
    cupola.position.set(0, -0.38, 0.65);
    parent.add(cupola);

    // 6. 加拿大双臂机械臂 (Canadarm2)
    const armGroup = new THREE.Group();
    armGroup.position.set(0.35, 0.25, 0.65);
    const arm1 = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 8), trussMat);
    arm1.position.set(0, 0.45, 0);
    armGroup.add(arm1);
    const arm2 = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.8, 8), trussMat);
    arm2.position.set(0, 0.9, 0.35);
    arm2.rotation.x = Math.PI / 3;
    armGroup.add(arm2);
    parent.add(armGroup);
  }

  // =========================================================================
  // 5. 中国天宫空间站 (China Tiangong Space Station)
  // =========================================================================
  private static buildTiangong(parent: THREE.Group): void {
    const solarTex = getSolarPanelTexture();
    const hullTex = getHullPanelTexture();
    const darkTex = getDarkCarbonTexture();

    const moduleMat = new THREE.MeshStandardMaterial({
      map: hullTex,
      metalness: 0.58,
      roughness: 0.32,
    });
    const solarMat = new THREE.MeshStandardMaterial({
      map: solarTex,
      metalness: 0.94,
      roughness: 0.16,
      side: THREE.DoubleSide,
    });
    const goldMat = new THREE.MeshStandardMaterial({
      color: 0xd97706,
      metalness: 0.9,
      roughness: 0.2,
    });
    const trussMat = new THREE.MeshStandardMaterial({
      map: darkTex,
      metalness: 0.8,
      roughness: 0.3,
    });

    // 1. 中部：天和核心舱 (Tianhe Core Module: 长 16.6 米大柱段+小柱段)
    // 大柱段（生活控制区）
    const tianheBig = new THREE.Mesh(
      new THREE.CylinderGeometry(0.44, 0.44, 1.6, 24),
      moduleMat
    );
    tianheBig.rotation.x = Math.PI / 2;
    tianheBig.position.set(0, 0, -0.4);
    parent.add(tianheBig);

    // 小柱段（实验资源区）
    const tianheSmall = new THREE.Mesh(
      new THREE.CylinderGeometry(0.33, 0.33, 1.2, 24),
      moduleMat
    );
    tianheSmall.rotation.x = Math.PI / 2;
    tianheSmall.position.set(0, 0, 0.9);
    parent.add(tianheSmall);

    // 前端五向节点舱 (Spherical Docking Hub: 直径 2.8 米)
    const nodeSphere = new THREE.Mesh(new THREE.SphereGeometry(0.38, 24, 18), moduleMat);
    nodeSphere.position.set(0, 0, 1.6);
    parent.add(nodeSphere);

    // 节点舱对接端口 (Docking Ports)
    for (const dir of [
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, -1, 0),
    ]) {
      const port = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.1, 16), trussMat);
      port.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      port.position.copy(dir.clone().multiplyScalar(0.42)).add(nodeSphere.position);
      parent.add(port);
    }

    // 2. 问天实验舱 (Wentian Lab Module - 侧面 +X)
    const wentian = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.42, 2.4, 20),
      moduleMat
    );
    wentian.rotation.z = Math.PI / 2;
    wentian.position.set(1.45, 0, 1.6);
    parent.add(wentian);

    // 问天柔性双自由度太阳能电池翼 (巨大单侧太阳翼)
    const wtSolar1 = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 3.6), solarMat);
    wtSolar1.position.set(3.4, 0, 1.6);
    wtSolar1.rotation.y = Math.PI / 2;
    parent.add(wtSolar1);

    // 3. 梦天实验舱 (Mengtian Lab Module - 侧面 -X)
    const mengtian = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.42, 2.4, 20),
      moduleMat
    );
    mengtian.rotation.z = Math.PI / 2;
    mengtian.position.set(-1.45, 0, 1.6);
    parent.add(mengtian);

    const mtSolar1 = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 3.6), solarMat);
    mtSolar1.position.set(-3.4, 0, 1.6);
    mtSolar1.rotation.y = Math.PI / 2;
    parent.add(mtSolar1);

    // 4. 天和核心舱自带双翼太阳电池翼
    for (const sign of [-1, 1]) {
      const thSolar = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 1.9), solarMat);
      thSolar.position.set(sign * 1.5, 0, -1.0);
      thSolar.rotation.y = Math.PI / 2;
      parent.add(thSolar);
    }

    // 5. 中国空间站 7 自由度核心舱机械臂 (Chinarm)
    const armGroup = new THREE.Group();
    armGroup.position.set(0.45, 0.35, -0.2);
    const armBoom1 = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.95, 8), goldMat);
    armBoom1.position.set(0, 0.45, 0);
    armGroup.add(armBoom1);
    const armBoom2 = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.85, 8), goldMat);
    armBoom2.position.set(0, 0.9, 0.4);
    armBoom2.rotation.x = Math.PI / 3;
    armGroup.add(armBoom2);
    parent.add(armGroup);

    // 6. 对接的神舟载人飞船 (Shenzhou Manned Spacecraft: 停靠于前向端口)
    const szGroup = new THREE.Group();
    szGroup.position.set(0, 0, 2.5);

    // 轨道舱 + 返回舱 + 推进舱
    const orbitalMod = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 12), moduleMat);
    szGroup.add(orbitalMod);

    const reentryMod = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.26, 0.28, 16),
      darkTex ? trussMat : moduleMat
    );
    reentryMod.rotation.x = Math.PI / 2;
    reentryMod.position.set(0, 0, 0.35);
    szGroup.add(reentryMod);

    const serviceMod = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.28, 0.55, 16),
      moduleMat
    );
    serviceMod.rotation.x = Math.PI / 2;
    serviceMod.position.set(0, 0, 0.75);
    szGroup.add(serviceMod);

    // 神舟太阳能电池翼
    for (const sign of [-1, 1]) {
      const szWing = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 1.1), solarMat);
      szWing.position.set(sign * 0.9, 0, 0.75);
      szGroup.add(szWing);
    }
    parent.add(szGroup);
  }

  // =========================================================================
  // 6. 卡西尼-惠更斯号土星探测器 (Cassini-Huygens)
  // =========================================================================
  private static buildCassini(parent: THREE.Group): void {
    const goldTex = getGoldFoilTexture();
    const hullTex = getHullPanelTexture();
    const darkTex = getDarkCarbonTexture();

    const dishMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.25,
      metalness: 0.15,
    });
    const goldProbeMat = new THREE.MeshStandardMaterial({
      map: goldTex,
      metalness: 0.92,
      roughness: 0.2,
    });
    const busMat = new THREE.MeshStandardMaterial({
      map: hullTex,
      metalness: 0.65,
      roughness: 0.35,
    });
    const darkEngineMat = new THREE.MeshStandardMaterial({
      map: darkTex,
      metalness: 0.9,
      roughness: 0.25,
    });

    // 1. 顶部 4 米直径高增益天线 (HGA: 同时充当飞往土星时的防太阳辐射盾)
    const dish = new THREE.Mesh(
      new THREE.SphereGeometry(2.0, 32, 16, 0, Math.PI * 2, 0, Math.PI / 3.4),
      dishMat
    );
    dish.rotation.x = Math.PI;
    dish.position.y = 1.05;
    parent.add(dish);

    // 2. 探测器主体圆柱结构与电子设备舱 (Main Propulsion / Equipment Module)
    const bodyUpper = new THREE.Mesh(
      new THREE.CylinderGeometry(1.05, 1.05, 1.8, 20),
      busMat
    );
    bodyUpper.position.y = 0.15;
    parent.add(bodyUpper);

    const bodyLower = new THREE.Mesh(
      new THREE.CylinderGeometry(1.05, 0.85, 1.2, 20),
      darkEngineMat
    );
    bodyLower.position.y = -1.2;
    parent.add(bodyLower);

    // 3. 惠更斯号泰坦着陆器 (Huygens Titan Probe: 附着于探测器侧面，圆盘飞碟状)
    const huygens = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.75, 0.5, 20),
      goldProbeMat
    );
    huygens.rotation.z = -Math.PI / 2.2;
    huygens.position.set(-1.3, 0.25, 0);
    parent.add(huygens);

    // 4. 双联主火箭发动机喷管 (Dual 445 N Main Rocket Engines)
    for (const sign of [-1, 1]) {
      const engine = new THREE.Mesh(
        new THREE.ConeGeometry(0.35, 0.75, 16, 1, true),
        darkEngineMat
      );
      engine.rotation.x = Math.PI;
      engine.position.set(sign * 0.35, -2.1, 0);
      parent.add(engine);
    }

    // 5. 三座 RTG 核热电机
    for (let i = 0; i < 3; i++) {
      const angle = (i * Math.PI * 2) / 3 + 0.3;
      const rtg = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.18, 0.65, 12),
        darkEngineMat
      );
      rtg.position.set(1.25 * Math.cos(angle), -0.7, 1.25 * Math.sin(angle));
      parent.add(rtg);
    }

    // 6. 11 米长磁强计伸展长臂 (Magnetometer Boom) 与 RPWS 偶极天线
    const boom = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 4.8, 8),
      darkEngineMat
    );
    boom.rotation.z = Math.PI / 2.5;
    boom.position.set(2.4, 0.4, 0.3);
    parent.add(boom);

    // 三根 10 米长的无线电等离子体天线 (RPWS Antenna rods: 呈 90° 伸展)
    for (const dir of [
      new THREE.Vector3(1, 0.5, 0).normalize(),
      new THREE.Vector3(0, 0.5, 1).normalize(),
      new THREE.Vector3(-0.7, 0.5, -0.7).normalize(),
    ]) {
      const ant = new THREE.Mesh(
        new THREE.CylinderGeometry(0.015, 0.015, 3.8, 6),
        dishMat
      );
      ant.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      ant.position.copy(dir.clone().multiplyScalar(1.9)).add(new THREE.Vector3(0, 0.8, 0));
      parent.add(ant);
    }
  }

  // =========================================================================
  // 7. 哈勃太空望远镜 (Hubble Space Telescope - HST)
  // =========================================================================
  private static buildHubble(parent: THREE.Group): void {
    const hullTex = getHullPanelTexture();
    const solarTex = getSolarPanelTexture();
    const darkTex = getDarkCarbonTexture();

    // 材质定义
    // A. 前部遮光罩高反光镜面钛银隔热多层隔热毯 (Silver MLI Blanket)
    const silverMliMat = new THREE.MeshStandardMaterial({
      color: 0xd8e2dc,
      metalness: 0.9,
      roughness: 0.2,
    });
    // B. 后部仪器设备舱 (Aft Shroud) 涂层面板与航天器外壳
    const aftHullMat = new THREE.MeshStandardMaterial({
      map: hullTex,
      color: 0xf1f5f9,
      metalness: 0.6,
      roughness: 0.35,
    });
    // C. 筒内超黑吸光消光涂层 (High-absorption Black Anodized / Z306)
    const interiorBlackMat = new THREE.MeshStandardMaterial({
      color: 0x050508,
      metalness: 0.1,
      roughness: 0.95,
      side: THREE.DoubleSide,
    });
    // D. 2.4 米超高精度双曲面镀铝主反射镜
    const primaryMirrorMat = new THREE.MeshStandardMaterial({
      color: 0x93c5fd, // 极淡微蓝银光高反射
      metalness: 0.98,
      roughness: 0.04,
    });
    // E. 太阳翼光伏板 (ESA SA3 柔性硅光伏阵列)
    const solarMat = new THREE.MeshStandardMaterial({
      map: solarTex,
      metalness: 0.85,
      roughness: 0.25,
      side: THREE.DoubleSide,
    });
    // F. 深色碳素结构桁架与天线支架
    const darkStructureMat = new THREE.MeshStandardMaterial({
      map: darkTex,
      color: 0x334155,
      metalness: 0.8,
      roughness: 0.3,
    });
    // G. 高增益抛物面天线白色高反射复合材料
    const dishMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      metalness: 0.3,
      roughness: 0.4,
      side: THREE.DoubleSide,
    });

    // -----------------------------------------------------------------------
    // 1. 前部遮光镜筒 (Forward Light Shield - 长度 4.5m，直径 3.0m)
    // -----------------------------------------------------------------------
    const lightShieldGeo = new THREE.CylinderGeometry(1.5, 1.5, 4.2, 32, 1, true);
    const lightShieldMesh = new THREE.Mesh(lightShieldGeo, silverMliMat);
    lightShieldMesh.position.y = 2.4;
    parent.add(lightShieldMesh);

    // 内部消光衬套（防止外壳内壁透光）
    const innerShieldGeo = new THREE.CylinderGeometry(1.48, 1.48, 4.18, 32, 1, true);
    const innerShieldMesh = new THREE.Mesh(innerShieldGeo, interiorBlackMat);
    innerShieldMesh.position.y = 2.4;
    parent.add(innerShieldMesh);

    // 镜筒开口前端加强保护环
    const rimGeo = new THREE.TorusGeometry(1.5, 0.05, 16, 32);
    const rimMesh = new THREE.Mesh(rimGeo, silverMliMat);
    rimMesh.rotation.x = Math.PI / 2;
    rimMesh.position.y = 4.5;
    parent.add(rimMesh);

    // -----------------------------------------------------------------------
    // 2. 活动遮光保护门 (Aperture Door - 倾斜 45° 敞开)
    // -----------------------------------------------------------------------
    const doorGroup = new THREE.Group();
    doorGroup.position.set(0, 4.5, -1.5); // 铰链位于 Z 轴负侧边缘

    const doorOuterMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(1.52, 1.52, 0.06, 32),
      silverMliMat
    );
    doorOuterMesh.position.set(0, 0, 1.5); // 相对铰链偏移回圆心
    doorGroup.add(doorOuterMesh);

    const doorInnerMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(1.5, 1.5, 0.04, 32),
      interiorBlackMat
    );
    doorInnerMesh.position.set(0, -0.02, 1.5);
    doorGroup.add(doorInnerMesh);

    // 铰链机构
    const hingeGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.8, 16);
    const hingeMesh = new THREE.Mesh(hingeGeo, darkStructureMat);
    hingeMesh.rotation.z = Math.PI / 2;
    doorGroup.add(hingeMesh);

    // 开启 42° 仰角
    doorGroup.rotation.x = -Math.PI * 0.23;
    parent.add(doorGroup);

    // -----------------------------------------------------------------------
    // 3. 2.4 米主反射镜与次镜支撑光轴系统 (Primary & Secondary Mirrors)
    // -----------------------------------------------------------------------
    // 主镜基座底盘与凹面反射镜
    const primaryMirror = new THREE.Mesh(
      new THREE.CylinderGeometry(1.2, 1.2, 0.15, 32),
      primaryMirrorMat
    );
    primaryMirror.position.y = 1.2;
    parent.add(primaryMirror);

    // 主镜中心挡光锥筒 (Central Baffle Tube)
    const centralBaffle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.32, 1.2, 24),
      interiorBlackMat
    );
    centralBaffle.position.y = 1.8;
    parent.add(centralBaffle);

    // 次镜总成与遮光罩 (Secondary Mirror Assembly at y = 3.8)
    const secondaryMirror = new THREE.Mesh(
      new THREE.CylinderGeometry(0.24, 0.24, 0.4, 24),
      interiorBlackMat
    );
    secondaryMirror.position.y = 3.8;
    parent.add(secondaryMirror);

    // 次镜 4 根支撑十字架 (Secondary Support Spider Vanes)
    for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI) / 2;
      const spider = new THREE.Mesh(
        new THREE.BoxGeometry(0.02, 0.06, 1.24),
        darkStructureMat
      );
      spider.position.set(
        0.74 * Math.sin(angle),
        3.8,
        0.74 * Math.cos(angle)
      );
      spider.rotation.y = angle;
      parent.add(spider);
    }

    // -----------------------------------------------------------------------
    // 4. 后部仪器设备舱 (Equipment Section & Aft Shroud - 直径 4.2m)
    // -----------------------------------------------------------------------
    // 锥形过渡过渡壳体 (Conical Transition: 3.0m -> 4.2m)
    const coneTransGeo = new THREE.CylinderGeometry(1.5, 2.1, 0.8, 32);
    const coneTransMesh = new THREE.Mesh(coneTransGeo, aftHullMat);
    coneTransMesh.position.y = -0.1;
    parent.add(coneTransMesh);

    // 仪器舱主圆筒体 (Aft Shroud Main Cylinder: 直径 4.2m, 高度 3.6m)
    const aftShroudGeo = new THREE.CylinderGeometry(2.1, 2.1, 3.6, 32);
    const aftShroudMesh = new THREE.Mesh(aftShroudGeo, aftHullMat);
    aftShroudMesh.position.y = -2.3;
    parent.add(aftShroudMesh);

    // 后端主框架密封底板 (Aft Bulkhead)
    const aftBaseGeo = new THREE.CylinderGeometry(2.1, 2.05, 0.2, 32);
    const aftBaseMesh = new THREE.Mesh(aftBaseGeo, darkStructureMat);
    aftBaseMesh.position.y = -4.2;
    parent.add(aftBaseMesh);

    // 环绕加强结构筋带 (Reinforcement Ribs)
    for (const yRib of [-0.6, -2.1, -3.8]) {
      const ribGeo = new THREE.TorusGeometry(2.12, 0.04, 8, 32);
      const ribMesh = new THREE.Mesh(ribGeo, darkStructureMat);
      ribMesh.rotation.x = Math.PI / 2;
      ribMesh.position.y = yRib;
      parent.add(ribMesh);
    }

    // 宇航员太空行走维护抓握扶手 (Yellow/Gold EVA Handrails)
    const handrailMat = new THREE.MeshStandardMaterial({
      color: 0xfacc15,
      metalness: 0.7,
      roughness: 0.3,
    });
    for (let j = 0; j < 6; j++) {
      const angle = (j * Math.PI * 2) / 6;
      const handrail = new THREE.Mesh(
        new THREE.CylinderGeometry(0.02, 0.02, 1.8, 8),
        handrailMat
      );
      handrail.position.set(2.14 * Math.sin(angle), -2.4, 2.14 * Math.cos(angle));
      parent.add(handrail);
    }

    // -----------------------------------------------------------------------
    // 5. 双翼柔性太阳能电池翼 (Solar Array 3 - SA3 翼展达 12 米)
    // -----------------------------------------------------------------------
    for (const side of [-1, 1]) {
      // 太阳翼旋转驱动机构 (Solar Array Drive Mechanism - SADM)
      const sadm = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.18, 0.6, 16),
        darkStructureMat
      );
      sadm.rotation.z = Math.PI / 2;
      sadm.position.set(side * 2.3, 0.0, 0);
      parent.add(sadm);

      // 横向伸展支承圆管
      const boom = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.06, 1.2, 12),
        silverMliMat
      );
      boom.rotation.z = Math.PI / 2;
      boom.position.set(side * 3.0, 0.0, 0);
      parent.add(boom);

      // 太阳能电池翼主板 (每侧板长 5.5m，宽 2.2m)
      const panel = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, 5.5, 2.2),
        solarMat
      );
      panel.position.set(side * 4.4, 0.0, 0);
      parent.add(panel);

      // 太阳翼展开张力支撑横梁 (Spreader Bars)
      for (const yEnd of [-2.75, 2.75]) {
        const spreader = new THREE.Mesh(
          new THREE.BoxGeometry(0.08, 0.08, 2.3),
          handrailMat
        );
        spreader.position.set(side * 4.4, yEnd, 0);
        parent.add(spreader);
      }
    }

    // -----------------------------------------------------------------------
    // 6. 双高增益抛物面微波天线 (Dual High Gain Antennas - HGA)
    // -----------------------------------------------------------------------
    for (const side of [-1, 1]) {
      const hgaBoom = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.04, 1.4, 8),
        darkStructureMat
      );
      // 倾斜伸向设备舱前侧斜上方
      hgaBoom.position.set(side * 2.5, 0.6, side * 0.8);
      hgaBoom.rotation.z = side * 0.5;
      hgaBoom.rotation.x = side * 0.4;
      parent.add(hgaBoom);

      // 抛物面主反射天线锅 (直径 1.3m)
      const dish = new THREE.Mesh(
        new THREE.ConeGeometry(0.65, 0.25, 24, 1, true),
        dishMat
      );
      dish.position.set(side * 3.1, 0.9, side * 1.3);
      dish.rotation.z = -side * 0.6;
      dish.rotation.x = Math.PI / 2 + side * 0.4;
      parent.add(dish);

      // 天线馈源杆
      const feed = new THREE.Mesh(
        new THREE.CylinderGeometry(0.015, 0.015, 0.35, 6),
        darkStructureMat
      );
      feed.position.copy(dish.position).add(new THREE.Vector3(0, 0.15, 0.15));
      parent.add(feed);
    }

    // -----------------------------------------------------------------------
    // 7. 航天飞机机械臂抓取固定销钉 (RMS Grapple Fixtures)
    // -----------------------------------------------------------------------
    for (const angle of [0, Math.PI]) {
      const grapple = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.05, 0.35, 12),
        handrailMat
      );
      grapple.position.set(2.15 * Math.cos(angle), -1.8, 2.15 * Math.sin(angle));
      grapple.rotation.z = Math.PI / 2;
      parent.add(grapple);
    }
  }
}
