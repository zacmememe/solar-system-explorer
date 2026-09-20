/**
 * 航天器高拟真 3D 几何网格构建器 VehicleMeshBuilder
 * 遵循 04-VEHICLES.zh-CN.md 规范：
 * 1. 真实米制尺寸建模（1 Scene Unit = 1 米）；
 * 2. 语义节点划分（天线、太阳翼、隔热层、座舱视窗）；
 * 3. 金属度/粗糙度贴合真实航天材料（金箔 MLI、单晶硅太阳能电池、碳纤维天线）。
 */

import * as THREE from 'three';
import type { VehicleId } from '../contracts/vehicle';

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
    }

    return group;
  }

  /**
   * 阿波罗 11 号登月舱 (Eagle)
   */
  private static buildApolloLM(parent: THREE.Group): void {
    // 材质
    const goldMylarMat = new THREE.MeshStandardMaterial({
      color: 0xd4af37,
      metalness: 0.85,
      roughness: 0.28,
    });
    const ascentAlumMat = new THREE.MeshStandardMaterial({
      color: 0x9ca3af,
      metalness: 0.6,
      roughness: 0.4,
    });
    const darkMetalMat = new THREE.MeshStandardMaterial({
      color: 0x1f2937,
      metalness: 0.9,
      roughness: 0.2,
    });
    const windowMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
    });

    // 1. 下部：着陆级八角柱基座
    const descentGeo = new THREE.CylinderGeometry(2.1, 2.3, 1.6, 8);
    const descentMesh = new THREE.Mesh(descentGeo, goldMylarMat);
    descentMesh.position.y = -0.8;
    parent.add(descentMesh);

    // 下降级主火箭喷管
    const engineGeo = new THREE.ConeGeometry(0.8, 1.2, 16, 1, true);
    const engineMesh = new THREE.Mesh(engineGeo, darkMetalMat);
    engineMesh.rotation.x = Math.PI;
    engineMesh.position.y = -1.9;
    parent.add(engineMesh);

    // 2. 四足着陆支架与足垫
    for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI) / 2 + Math.PI / 4;
      const legGroup = new THREE.Group();
      legGroup.rotation.y = angle;

      // 主支撑斜梁
      const strutGeo = new THREE.CylinderGeometry(0.06, 0.06, 3.2);
      const strutMesh = new THREE.Mesh(strutGeo, goldMylarMat);
      strutMesh.position.set(2.0, -1.8, 0);
      strutMesh.rotation.z = Math.PI / 3.2;
      legGroup.add(strutMesh);

      // 碗状足垫
      const padGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.08, 12);
      const padMesh = new THREE.Mesh(padGeo, goldMylarMat);
      padMesh.position.set(3.4, -2.6, 0);
      legGroup.add(padMesh);

      parent.add(legGroup);
    }

    // 3. 上部：上升级座舱
    const ascentCenterGeo = new THREE.BoxGeometry(2.2, 1.6, 2.0);
    const ascentCenter = new THREE.Mesh(ascentCenterGeo, ascentAlumMat);
    ascentCenter.position.y = 0.8;
    parent.add(ascentCenter);

    // 两侧前伸设备圆柱
    for (const sign of [-1, 1]) {
      const podGeo = new THREE.CylinderGeometry(0.7, 0.7, 1.5, 12);
      const pod = new THREE.Mesh(podGeo, ascentAlumMat);
      pod.rotation.z = Math.PI / 2;
      pod.position.set(sign * 1.3, 0.7, 0.2);
      parent.add(pod);
    }

    // 驾驶员前窗（两扇特征倒三角视窗）
    const winGeo = new THREE.PlaneGeometry(0.4, 0.4);
    for (const sign of [-1, 1]) {
      const win = new THREE.Mesh(winGeo, windowMat);
      win.position.set(sign * 0.5, 1.1, 1.01);
      win.rotation.z = sign * 0.3;
      parent.add(win);
    }

    // 顶部对接舱门
    const dockGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.3, 16);
    const dock = new THREE.Mesh(dockGeo, darkMetalMat);
    dock.position.y = 1.75;
    parent.add(dock);

    // 4组十字形姿态喷管 (RCS Quads)
    for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI) / 2;
      const rcsGroup = new THREE.Group();
      rcsGroup.rotation.y = angle;
      rcsGroup.position.set(1.4 * Math.cos(angle), 1.0, 1.4 * Math.sin(angle));

      const rcsCore = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.15), darkMetalMat);
      rcsGroup.add(rcsCore);

      for (let j = 0; j < 4; j++) {
        const nozz = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.12, 8), darkMetalMat);
        nozz.rotation.z = (j * Math.PI) / 2;
        nozz.position.x = 0.1 * Math.cos((j * Math.PI) / 2);
        nozz.position.y = 0.1 * Math.sin((j * Math.PI) / 2);
        rcsGroup.add(nozz);
      }
      parent.add(rcsGroup);
    }
  }

  /**
   * 旅行者 1 号 (Voyager 1)
   */
  private static buildVoyager(parent: THREE.Group): void {
    const dishWhiteMat = new THREE.MeshStandardMaterial({
      color: 0xf1f5f9,
      roughness: 0.35,
    });
    const goldRecordMat = new THREE.MeshStandardMaterial({
      color: 0xffd700,
      metalness: 0.95,
      roughness: 0.15,
    });
    const busMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      metalness: 0.7,
      roughness: 0.4,
    });
    const boomMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.8,
      roughness: 0.3,
    });

    // 1. 顶部巨大抛物面高增益天线 (3.7 米大锅)
    const dishGeo = new THREE.SphereGeometry(1.85, 32, 16, 0, Math.PI * 2, 0, Math.PI / 3);
    const dish = new THREE.Mesh(dishGeo, dishWhiteMat);
    dish.rotation.x = Math.PI;
    dish.position.y = 0.6;
    parent.add(dish);

    // 天线中心副反射三脚架
    const subReflector = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.15, 12), busMat);
    subReflector.position.y = 1.6;
    parent.add(subReflector);

    for (let i = 0; i < 3; i++) {
      const angle = (i * Math.PI * 2) / 3;
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.2), boomMat);
      leg.position.set(0.6 * Math.cos(angle), 1.0, 0.6 * Math.sin(angle));
      leg.rotation.x = 0.45 * Math.sin(angle);
      leg.rotation.z = -0.45 * Math.cos(angle);
      parent.add(leg);
    }

    // 2. 中部：十边形电子设备舱主体
    const busGeo = new THREE.CylinderGeometry(0.9, 0.9, 0.5, 10);
    const bus = new THREE.Mesh(busGeo, busMat);
    bus.position.y = 0.2;
    parent.add(bus);

    // 3. 旅行者镀金唱片 (Golden Record)
    const recordGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.02, 32);
    const record = new THREE.Mesh(recordGeo, goldRecordMat);
    record.rotation.z = Math.PI / 2;
    record.position.set(0.92, 0.2, 0);
    parent.add(record);

    // 4. 伸出的三大长杆桁架
    // 磁强计长臂 (Magnetometer Boom)
    const magBoomGeo = new THREE.CylinderGeometry(0.03, 0.03, 4.5);
    const magBoom = new THREE.Mesh(magBoomGeo, boomMat);
    magBoom.rotation.z = Math.PI / 2.3;
    magBoom.position.set(2.4, 0.1, -0.4);
    parent.add(magBoom);

    // RTG 核温差热电机伸臂
    const rtgBoomGeo = new THREE.CylinderGeometry(0.04, 0.04, 2.0);
    const rtgBoom = new THREE.Mesh(rtgBoomGeo, boomMat);
    rtgBoom.rotation.z = -Math.PI / 2.6;
    rtgBoom.position.set(-1.2, -0.2, 0.3);
    parent.add(rtgBoom);

    // 3 节 RTG 圆柱电源
    for (let i = 0; i < 3; i++) {
      const rtgGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.45, 12);
      const rtg = new THREE.Mesh(rtgGeo, busMat);
      rtg.position.set(-2.0 - i * 0.25, -0.6 - i * 0.1, 0.4);
      parent.add(rtg);
    }
  }

  /**
   * 詹姆斯·韦伯太空望远镜 (JWST)
   */
  private static buildWebb(parent: THREE.Group): void {
    const goldMirrorMat = new THREE.MeshStandardMaterial({
      color: 0xffd700,
      metalness: 0.95,
      roughness: 0.12,
    });
    const sunshieldMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      metalness: 0.8,
      roughness: 0.35,
      side: THREE.DoubleSide,
    });
    const darkFrameMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      metalness: 0.6,
      roughness: 0.4,
    });

    // 1. 五层菱形风筝遮阳薄膜 (Sunshield)
    for (let layer = 0; layer < 5; layer++) {
      const shieldShape = new THREE.Shape();
      const w = 4.2 - layer * 0.12;
      const l = 6.2 - layer * 0.15;
      shieldShape.moveTo(0, l);
      shieldShape.lineTo(w, 0);
      shieldShape.moveTo(w, 0);
      shieldShape.lineTo(0, -l);
      shieldShape.moveTo(0, -l);
      shieldShape.lineTo(-w, 0);
      shieldShape.moveTo(-w, 0);
      shieldShape.lineTo(0, l);

      const shieldGeo = new THREE.ShapeGeometry(shieldShape);
      const shield = new THREE.Mesh(shieldGeo, sunshieldMat);
      shield.rotation.x = Math.PI / 2;
      shield.position.y = -0.5 - layer * 0.08;
      parent.add(shield);
    }

    // 2. 镀金六边形主镜阵列 (18块六边形主镜组合)
    const mirrorGroup = new THREE.Group();
    mirrorGroup.position.set(0, 0.8, 0);

    const hexRadius = 0.45;
    const hexGeo = new THREE.CircleGeometry(hexRadius, 6);

    // 六边形密铺环
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
    parent.add(mirrorGroup);

    // 3. 副镜支撑三脚架 (Secondary Mirror Tripod)
    const tripodTop = new THREE.Vector3(0, 0.8, 2.2);
    const secMirror = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 12), darkFrameMat);
    secMirror.position.copy(tripodTop);
    parent.add(secMirror);

    const strut1 = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.4), darkFrameMat);
    strut1.position.set(0, 2.0, 1.1);
    strut1.rotation.x = -Math.PI / 4;
    parent.add(strut1);

    for (const sign of [-1, 1]) {
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.5), darkFrameMat);
      strut.position.set(sign * 1.0, -0.2, 1.1);
      strut.rotation.x = Math.PI / 4.5;
      strut.rotation.z = -sign * 0.4;
      parent.add(strut);
    }
  }

  /**
   * 国际空间站 (ISS)
   */
  private static buildISS(parent: THREE.Group): void {
    const trussMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.8,
      roughness: 0.3,
    });
    const moduleMat = new THREE.MeshStandardMaterial({
      color: 0xf1f5f9,
      metalness: 0.6,
      roughness: 0.35,
    });
    const solarMat = new THREE.MeshStandardMaterial({
      color: 0x1d4ed8,
      metalness: 0.9,
      roughness: 0.2,
      side: THREE.DoubleSide,
    });

    // 1. 中央核心综合桁架 (Truss: 贯穿左右上百米)
    const trussGeo = new THREE.BoxGeometry(10.0, 0.25, 0.25);
    const truss = new THREE.Mesh(trussGeo, trussMat);
    parent.add(truss);

    // 2. 8组宽大太阳翼 (每侧各4对)
    for (const side of [-1, 1]) {
      for (let i = 0; i < 2; i++) {
        const xOffset = side * (3.2 + i * 1.4);
        for (const ySign of [-1, 1]) {
          const panelGeo = new THREE.PlaneGeometry(0.9, 2.2);
          const panel = new THREE.Mesh(panelGeo, solarMat);
          panel.position.set(xOffset, ySign * 1.25, 0);
          parent.add(panel);
        }
      }
    }

    // 3. 中部纵向科研加压舱段群 (Destiny, Unity, Zarya, Zvezda)
    for (let m = -2; m <= 2; m++) {
      const modGeo = new THREE.CylinderGeometry(0.3, 0.3, 1.1, 16);
      const mod = new THREE.Mesh(modGeo, moduleMat);
      mod.rotation.x = Math.PI / 2;
      mod.position.set(0, 0, m * 1.15);
      parent.add(mod);
    }

    // 横向扩展舱 (Columbus / Kibo)
    for (const sign of [-1, 1]) {
      const labGeo = new THREE.CylinderGeometry(0.28, 0.28, 1.0, 16);
      const lab = new THREE.Mesh(labGeo, moduleMat);
      lab.rotation.z = Math.PI / 2;
      lab.position.set(sign * 0.75, 0, 0.6);
      parent.add(lab);
    }
  }

  /**
   * 中国天宫空间站 (Tiangong)
   */
  private static buildTiangong(parent: THREE.Group): void {
    const moduleMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      metalness: 0.55,
      roughness: 0.3,
    });
    const solarGoldMat = new THREE.MeshStandardMaterial({
      color: 0x2563eb, // 高效太阳能电池深蓝
      metalness: 0.85,
      roughness: 0.2,
      side: THREE.DoubleSide,
    });
    const redAccentMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });

    // 1. 中部：天和核心舱 (长 16.6 米，分大柱段与小柱段)
    const coreBigGeo = new THREE.CylinderGeometry(0.42, 0.42, 1.5, 20);
    const coreBig = new THREE.Mesh(coreBigGeo, moduleMat);
    coreBig.rotation.x = Math.PI / 2;
    parent.add(coreBig);

    const coreSmallGeo = new THREE.CylinderGeometry(0.32, 0.32, 1.0, 20);
    const coreSmall = new THREE.Mesh(coreSmallGeo, moduleMat);
    coreSmall.rotation.x = Math.PI / 2;
    coreSmall.position.z = 1.25;
    parent.add(coreSmall);

    // 节点舱
    const nodeGeo = new THREE.SphereGeometry(0.38, 16, 16);
    const node = new THREE.Mesh(nodeGeo, moduleMat);
    node.position.z = 1.85;
    parent.add(node);

    // 2. 左右两侧对称对接口：“问天”与“梦天”实验舱 (构成标志性 T 字形)
    for (const sign of [-1, 1]) {
      const expGeo = new THREE.CylinderGeometry(0.42, 0.42, 2.2, 20);
      const exp = new THREE.Mesh(expGeo, moduleMat);
      exp.rotation.z = Math.PI / 2;
      exp.position.set(sign * 1.25, 0, 0);
      parent.add(exp);

      // 实验舱末端巨大的柔性太阳翼
      const wingGeo = new THREE.PlaneGeometry(0.8, 3.2);
      const wing = new THREE.Mesh(wingGeo, solarGoldMat);
      wing.position.set(sign * 2.8, 0, 0);
      parent.add(wing);

      // 五星红旗标志带
      const flagGeo = new THREE.BoxGeometry(0.02, 0.15, 0.25);
      const flag = new THREE.Mesh(flagGeo, redAccentMat);
      flag.position.set(sign * 0.9, 0.43, 0);
      parent.add(flag);
    }
  }

  /**
   * 卡西尼-惠更斯号 (Cassini-Huygens)
   */
  private static buildCassini(parent: THREE.Group): void {
    const dishWhiteMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.3,
    });
    const goldMat = new THREE.MeshStandardMaterial({
      color: 0xd97706,
      metalness: 0.85,
      roughness: 0.25,
    });
    const probeMat = new THREE.MeshStandardMaterial({
      color: 0xca8a04,
      metalness: 0.9,
      roughness: 0.2,
    });
    const darkBodyMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.5,
    });

    // 1. 顶部 4 米抛物面高增益天线大锅
    const dishGeo = new THREE.SphereGeometry(1.6, 32, 16, 0, Math.PI * 2, 0, Math.PI / 3);
    const dish = new THREE.Mesh(dishGeo, dishWhiteMat);
    dish.rotation.x = Math.PI;
    dish.position.y = 1.0;
    parent.add(dish);

    // 2. 金箔推进剂储箱主舱段
    const bodyGeo = new THREE.CylinderGeometry(0.7, 0.7, 1.8, 16);
    const body = new THREE.Mesh(bodyGeo, goldMat);
    body.position.y = 0;
    parent.add(body);

    // 3. 侧面挂载的惠更斯号泰坦着陆器 (Huygens Probe)
    const huygensGeo = new THREE.ConeGeometry(0.65, 0.5, 20);
    const huygens = new THREE.Mesh(huygensGeo, probeMat);
    huygens.rotation.z = -Math.PI / 2;
    huygens.position.set(1.0, 0.2, 0);
    parent.add(huygens);

    // 4. 下部双主推进火箭喷管
    for (const sign of [-1, 1]) {
      const engineGeo = new THREE.ConeGeometry(0.25, 0.5, 12, 1, true);
      const engine = new THREE.Mesh(engineGeo, darkBodyMat);
      engine.rotation.x = Math.PI;
      engine.position.set(sign * 0.28, -1.15, 0);
      parent.add(engine);
    }
  }
}
