/**
 * 太阳系漫游 · 批次 P1 实机端到端验收脚本 (verify-p1-physics-core.ts)
 * 验证目标（对应 docs/plans/2026-09-23-p1-physics-metric-core.md T6）：
 * 1. 全系统物理快照 (getPhysicalSystemSnapshot) 全量有效：有限值、诚实时间基/坐标系标识、近似 TDB 换算；
 * 2. 月面 SURFACE_LOOK：站点随天体自转 (0/6/12h 同一地理点世界机位随四元数旋转、逆变换回算经纬度不变)；
 * 3. 1.7m 眼高下近裁剪面 = 0.1m 米制等效 (非旧 1e-4 场景单位)；
 * 4. V3 书签闭环：捕获 → localStorage 存 schemaVersion 3 → 推进 12h → 恢复，站点/眼高/朝向/观察模式一致、眼位净空 ≈ 眼高 (不埋地)；
 * 5. 观察模式合并行为：physical ↔ terrain-study 切换云层联动与用户云层选择保留；
 * 6. 帧率采样来自主引擎渲染循环计数 (getRenderFrameCount)，非独立 rAF。
 *
 * 诚实性约定：所有 pass/fail 由实测断言得出；任一断言失败 → 报告标 FAILED 并以非零码退出。
 */

import puppeteer from 'puppeteer-core';
import * as path from 'path';
import * as fs from 'fs';
import { isValidBookmarkAnyVersion } from '../src/utils/bookmarkStorage';
import { upgradeBookmarkToV3 } from '../src/contracts/bookmark';

const TARGET_URL = process.env.TEST_URL || 'http://localhost:4173';
const EDGE_PATH = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUTPUT_DIR = (process.env.EVIDENCE_DIR ? path.resolve(process.env.EVIDENCE_DIR) : 'D:/solar-evidence/pro-review');
const COMMIT = process.env.P1_COMMIT || 'worktree-uncommitted';

interface CheckResult {
  name: string;
  pass: boolean;
  detail: Record<string, unknown>;
}

const checks: CheckResult[] = [];

function record(name: string, pass: boolean, detail: Record<string, unknown>) {
  checks.push({ name, pass, detail });
  console.log(`${pass ? '✅' : '❌'} [${pass ? 'PASS' : 'FAIL'}] ${name}`);
  console.log(`   ${JSON.stringify(detail)}`);
}

async function runP1Verification() {
  console.log('='.repeat(80));
  console.log('🛰️ 太阳系漫游 · 批次 P1【公共物理与米制空间内核】实机端到端验收');
  console.log(`目标 URL: ${TARGET_URL} (必须是本地 preview 的当前构建)`);
  console.log(`执行浏览器: ${EDGE_PATH}`);
  console.log(`关联 commit: ${COMMIT}`);
  console.log('='.repeat(80));

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--use-gl=angle',
      '--use-angle=d3d11',
      '--enable-webgl',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--window-size=1440,900',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });

  const consoleErrors: string[] = [];
  const consoleWarnings: string[] = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error') {
      consoleErrors.push(text);
      console.error('❌ [浏览器控制台 Error]:', text);
    } else if (msg.type() === 'warn') {
      consoleWarnings.push(text);
    }
  });

  const saveScreenshot = async (filename: string) => {
    const localPath = path.join(OUTPUT_DIR, filename);
    await page.screenshot({ path: localPath });
    console.log(`📸 截图已保存: ${filename}`);
  };

  try {
    console.log('正在加载本地构建页面...');
    await page.goto(TARGET_URL, { waitUntil: 'networkidle0', timeout: 45000 });
    await new Promise((r) => setTimeout(r, 2500));

    const engineReady = await page.evaluate(() => !!(window as any).__solarEngine);
    if (!engineReady) {
      throw new Error('window.__solarEngine 不可用，应用未完成挂载');
    }

    // ---------- 检查 1: 全系统物理快照 ----------
    console.log('\n【检查 1】全系统物理快照完整性、诚实标识与近似 TDB 时间基...');
    const snapshotCheck = await page.evaluate(() => {
      const engine = (window as any).__solarEngine;
      const snap = engine.getPhysicalSystemSnapshot();
      const ids = Object.keys(snap.bodies);
      let allFinite = true;
      let honestFrames = true;
      let qualityOk = true;
      let quatNormOk = true;
      const badList: string[] = [];
      for (const id of ids) {
        const st = snap.bodies[id];
        const finite =
          [st.positionKm, st.velocityKmPerSec, st.radiiKm, st.fixedToInertialQuaternion]
            .every((v: unknown[]) => Array.isArray(v) && v.every(Number.isFinite)) &&
          Number.isFinite(st.tdbSecondsFromJ2000) && Number.isFinite(st.meanRadiusKm);
        if (!finite) { allFinite = false; badList.push(`${id}:nonfinite`); }
        if (st.positionFrameId !== 'ECLIPTIC-ANALYTIC-APPROX' || st.cartographicFrameId !== 'BODY-FIXED-RENDER-X0-YN-Z90E') {
          honestFrames = false; badList.push(`${id}:frame`);
        }
        if (st.quality !== 'analytic-approximation') { qualityOk = false; badList.push(`${id}:quality`); }
        const q = st.fixedToInertialQuaternion;
        if (Math.abs(Math.hypot(q[0], q[1], q[2], q[3]) - 1) > 1e-6) { quatNormOk = false; badList.push(`${id}:quat`); }
      }
      return {
        bodyCount: ids.length,
        tdbSecondsFromJ2000: snap.tdbSecondsFromJ2000,
        simTimeHours: snap.simTimeHours,
        frameId: snap.frameId,
        allFinite,
        honestFrames,
        qualityOk,
        quatNormOk,
        badList,
      };
    });
    const tdbApproxOk =
      Math.abs(snapshotCheck.tdbSecondsFromJ2000 - (843307200 + snapshotCheck.simTimeHours * 3600 + 69.184)) < 1e-6;
    record(
      'P1-WEB-01 物理快照全量有效 (有限值/诚实坐标系标识/analytic-approximation/四元数归一/近似TDB)',
      snapshotCheck.bodyCount >= 20 &&
        snapshotCheck.allFinite &&
        snapshotCheck.honestFrames &&
        snapshotCheck.qualityOk &&
        snapshotCheck.quatNormOk &&
        tdbApproxOk &&
        snapshotCheck.frameId === 'ECLIPTIC-ANALYTIC-APPROX',
      { ...snapshotCheck, tdbApproxOk }
    );

    // ---------- 检查 2: 月面 SURFACE_LOOK + 站点随自转 + 米制近裁剪 ----------
    console.log('\n【检查 2】月面地表观察：切入物理比例 + SURFACE_LOOK，验证站点随自转与 0.1m 近裁剪面...');
    await page.evaluate(() => {
      const engine = (window as any).__solarEngine;
      // 聚焦月球并切换物理观察策略 (地月系为参考系统)
      engine.executeCameraCommand({ type: 'select', bodyId: 'moon' });
      engine.setPresentationPolicy('PHYSICAL_OBSERVATION', 0.5);
    });
    // 等待策略过渡完成 (0.5s 过渡 + 余量)
    await new Promise((r) => setTimeout(r, 2500));

    // 水平视角 (pitch 0) 进入：画面检查需要地平线居中、地形占下半幅。
    // lookAtSkyTarget 会把相机上仰看向地球 (P1 修正潮汐锁向后地球真实位于 +52° 仰角)，
    // 届时画面以天空为主，因此像素级画面检查必须在看地动作之前执行。
    await page.evaluate(() => {
      const engine = (window as any).__solarEngine;
      engine.executeCameraCommand({
        type: 'enterSurfaceLook',
        bodyId: 'moon',
        lat: 20.35,
        lon: 30.78,
        eyeHeightM: 1.7,
        initialYawDeg: 225,
        initialPitchDeg: 0,
      });
    });
    await new Promise((r) => setTimeout(r, 1800));

    // 采集 t0 站点状态
    const t0 = await page.evaluate(() => {
      const engine = (window as any).__solarEngine;
      const pose = engine.getSurfaceStationPose();
      const cam = engine.getCamera();
      const moon = engine.getBodyWorldPose('moon');
      return {
        station: pose?.station ?? null,
        metricScale: pose?.metricScale ?? null,
        nearPlane: cam.near,
        cameraPos: [cam.position.x, cam.position.y, cam.position.z],
        moonPos: [moon.pos.x, moon.pos.y, moon.pos.z],
        moonQuat: [moon.quaternion.x, moon.quaternion.y, moon.quaternion.z, moon.quaternion.w],
      };
    });

    const nearExpect = 0.1 * t0.metricScale;
    const station = t0.station;
    if (!station || t0.metricScale == null) {
      record(
        'P1-WEB-02 SURFACE_LOOK 站点描述符为真实数据 (非零 body-fixed 向量/单位法线/谷底高程/眼高区分)',
        false,
        { error: 'getSurfaceStationPose() 返回空——SURFACE_LOOK 未生效或被抢占', snapshot: t0 }
      );
      throw new Error('SURFACE_LOOK 站点状态不可用，后续检查无法执行');
    }
    const stationVecOk =
      !!station &&
      Array.isArray(station.bodyFixedPosM) &&
      station.bodyFixedPosM.every(Number.isFinite) &&
      !(station.bodyFixedPosM[0] === 0 && station.bodyFixedPosM[1] === 0 && station.bodyFixedPosM[2] === 0);
    const normalOk =
      !!station &&
      Array.isArray(station.surfaceNormal) &&
      Math.abs(Math.hypot(...station.surfaceNormal) - 1) < 1e-6 &&
      !(station.surfaceNormal[0] === 0 && station.surfaceNormal[1] === 1 && station.surfaceNormal[2] === 0);
    record(
      'P1-WEB-02 SURFACE_LOOK 站点描述符为真实数据 (非零 body-fixed 向量/单位法线/谷底高程/眼高区分)',
      stationVecOk &&
        normalOk &&
        station.heightM < -1400 && // P2 起真实 DTM 站点值 ≈ −1690.9 m（原高斯 −2500 断言已废止）
        station.heightM > -2000 &&
        station.eyeHeightM === 1.7 &&
        station.datum === 'MOON_PA453',
      {
        heightM: station?.heightM,
        eyeHeightM: station?.eyeHeightM,
        datum: station?.datum,
        bodyFixedPosM: station?.bodyFixedPosM,
        surfaceNormal: station?.surfaceNormal,
      }
    );
    record(
      'P1-WEB-03 近裁剪面 = 0.1m 米制等效 (1.7m 眼高)',
      Math.abs(t0.nearPlane - nearExpect) < nearExpect * 1e-3 && t0.nearPlane < 1e-4,
      { nearPlane: t0.nearPlane, expected: nearExpect, metricScale: t0.metricScale }
    );

    // 画面内容真值检查：同任务内 renderer.render + gl.readPixels 采样非黑像素占比。
    // 防回归：2026-09-23 曾出现状态断言全过但视口纯黑 (near≈2.1e-8 下月面网格
    // 绕序+DoubleSide 使整屏输出 0)，此后像素级断言成为必检项。
    const pixelProbe = await page.evaluate(() => {
      const engine = (window as any).__solarEngine;
      const r = engine.renderer;
      r.render(engine.scene, engine.camera);
      const gl = r.getContext();
      const W = gl.drawingBufferWidth;
      const H = gl.drawingBufferHeight;
      let nonBlack = 0;
      let maxLum = 0;
      const total = 24 * 14;
      for (let ix = 0; ix < 24; ix++) {
        for (let iy = 0; iy < 14; iy++) {
          const p = new Uint8Array(4);
          gl.readPixels(
            Math.floor(((ix + 0.5) / 24) * W),
            Math.floor(((iy + 0.5) / 14) * H),
            1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p
          );
          const lum = 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
          if (lum > 4) nonBlack++;
          if (lum > maxLum) maxLum = lum;
        }
      }
      return { nonBlack, total, ratio: Number((nonBlack / total).toFixed(3)), maxLum: Math.round(maxLum) };
    });
    record(
      'P1-WEB-03b 画面内容非黑 (readPixels 采样，防黑屏回归)',
      pixelProbe.ratio >= 0.25 && pixelProbe.maxLum > 30,
      pixelProbe
    );

    await saveScreenshot('70-p1-moon-surface-look-t0.png');

    // 转向天空看地球（与 App 恢复书签后的 lookTarget 流程一致；地球在站点上空约 +52°）
    await page.evaluate(() => {
      const engine = (window as any).__solarEngine;
      engine.executeCameraCommand({ type: 'lookAtSkyTarget', targetBodyId: 'earth' });
    });
    await new Promise((r) => setTimeout(r, 800));

    // 站点随自转：推进 6h / 12h，同一地理点世界机位必须变化，且逆变换回算站点方向不变
    console.log('\n【检查 3】推进模拟时钟 6h/12h，验证地表站点随天体自转变换...');
    const rotationSamples: Array<{ hours: number; cameraPos: number[]; localDir: number[]; aglM: number }> = [];
    const sampleAt = async (hours: number) => {
      await page.evaluate((h) => {
        const engine = (window as any).__solarEngine;
        engine.setSimTimeHours(h);
      }, hours);
      await new Promise((r) => setTimeout(r, 400));
      return page.evaluate(() => {
        const engine = (window as any).__solarEngine;
        const cam = engine.getCamera();
        const moon = engine.getBodyWorldPose('moon');
        const pose = engine.getSurfaceStationPose();
        // rel = cam - moonPos，逆旋转回 body-local，得到眼位相对天体的局部方向
        const [qx, qy, qz, qw] = [moon.quaternion.x, moon.quaternion.y, moon.quaternion.z, -moon.quaternion.w];
        const rx = cam.position.x - moon.pos.x;
        const ry = cam.position.y - moon.pos.y;
        const rz = cam.position.z - moon.pos.z;
        const tx = 2 * (qy * rz - qz * ry);
        const ty = 2 * (qz * rx - qx * rz);
        const tz = 2 * (qx * ry - qy * rx);
        const bx = rx + qw * tx + (qy * tz - qz * ty);
        const by = ry + qw * ty + (qz * tx - qx * tz);
        const bz = rz + qw * tz + (qx * ty - qy * tx);
        const len = Math.hypot(bx, by, bz);
        // len 为场景单位：先除以 metricScale 转米，再减基准半径与地面高程得净空
        const lenM = pose ? len / pose.metricScale : NaN;
        const aglM = pose ? lenM - 1737400 - pose.station.heightM : NaN;
        return {
          cameraPos: [cam.position.x, cam.position.y, cam.position.z],
          localDir: [bx / len, by / len, bz / len],
          aglM,
          station: pose?.station ?? null,
        };
      });
    };

    const s0 = { cameraPos: t0.cameraPos, localDir: null as number[] | null, aglM: NaN, station };
    // t0 的 localDir 需要重算 (上面 evaluate 未算)——用当前 t0 数据在 node 侧补算
    {
      const [qx, qy, qz, qw] = [t0.moonQuat[0], t0.moonQuat[1], t0.moonQuat[2], -t0.moonQuat[3]];
      const rx = t0.cameraPos[0] - t0.moonPos[0];
      const ry = t0.cameraPos[1] - t0.moonPos[1];
      const rz = t0.cameraPos[2] - t0.moonPos[2];
      const tx = 2 * (qy * rz - qz * ry);
      const ty = 2 * (qz * rx - qx * rz);
      const tz = 2 * (qx * ry - qy * rx);
      const bx = rx + qw * tx + (qy * tz - qz * ty);
      const by = ry + qw * ty + (qz * tx - qx * tz);
      const bz = rz + qw * tz + (qx * ty - qy * tx);
      const len = Math.hypot(bx, by, bz);
      s0.localDir = [bx / len, by / len, bz / len];
      const lenM = len / t0.metricScale;
      s0.aglM = lenM - 1737400 - station.heightM;
    }

    const s6 = await sampleAt(6);
    const s12 = await sampleAt(12);
    rotationSamples.push(
      { hours: 0, cameraPos: s0.cameraPos, localDir: s0.localDir!, aglM: s0.aglM },
      { hours: 6, cameraPos: s6.cameraPos, localDir: s6.localDir, aglM: s6.aglM },
      { hours: 12, cameraPos: s12.cameraPos, localDir: s12.localDir, aglM: s12.aglM }
    );

    const dirDelta06 = Math.hypot(
      s0.localDir![0] - s6.localDir[0], s0.localDir![1] - s6.localDir[1], s0.localDir![2] - s6.localDir[2]
    );
    const dirDelta012 = Math.hypot(
      s0.localDir![0] - s12.localDir[0], s0.localDir![1] - s12.localDir[1], s0.localDir![2] - s12.localDir[2]
    );
    const worldMove06 = Math.hypot(
      s0.cameraPos[0] - s6.cameraPos[0], s0.cameraPos[1] - s6.cameraPos[1], s0.cameraPos[2] - s6.cameraPos[2]
    );
    const agls = rotationSamples.map((s) => s.aglM);
    const aglStable = agls.every((a) => Math.abs(a - 1.7) < 0.05);
    record(
      'P1-WEB-04 同一地理点 0/6/12h：世界机位随自转变化，body-local 站点方向不变，净空恒为 1.7m',
      worldMove06 > 0.01 && dirDelta06 < 1e-9 && dirDelta012 < 1e-9 && aglStable,
      { worldMoveAt6h: worldMove06, localDirDelta06h: dirDelta06, localDirDelta12h: dirDelta012, aglM: agls }
    );

    await saveScreenshot('71-p1-moon-surface-look-t12h.png');

    // ---------- 检查 4: V3 书签保存 → 推进 12h → 恢复 ----------
    console.log('\n【检查 4】V3 书签：捕获 → localStorage 校验 → 推进 12h → 恢复一致性...');
    // 恢复到 t=0 附近再捕获书签 (保持确定性)
    await page.evaluate(() => {
      const engine = (window as any).__solarEngine;
      engine.setSimTimeHours(0);
    });
    await new Promise((r) => setTimeout(r, 500));

    const bookmarkCheck = await page.evaluate(() => {
      const engine = (window as any).__solarEngine;
      // 与 UI 保存同一捕获入口
      return engine.captureObservationSnapshot('P1 验收·月面谷底站点');
    });

    // node 侧用产品同源校验/迁移函数验证书签结构 (tsx 直接 import 源码模块)
    const bookmarkValid = isValidBookmarkAnyVersion(bookmarkCheck);
    const bookmarkRound = upgradeBookmarkToV3(JSON.parse(JSON.stringify(bookmarkCheck)));

    // 写入 localStorage (与 saveBookmark 相同的键与数组结构)，随后读回校验
    const storageCheck = await page.evaluate((bm: any) => {
      const KEY = 'solar_explorer_bookmarks_v3';
      const existing = localStorage.getItem(KEY);
      const arr = existing ? JSON.parse(existing) : [];
      const withoutDup = arr.filter((b: any) => b.id !== bm.id);
      withoutDup.unshift(bm);
      localStorage.setItem(KEY, JSON.stringify(withoutDup));
      const stored = JSON.parse(localStorage.getItem(KEY)!).find((b: any) => b.id === bm.id);
      return {
        schemaVersion: stored.schemaVersion,
        hasStation: !!stored.surfaceStation,
        station: stored.surfaceStation ?? null,
        observationMode: stored.observationMode,
        sourceVersion: stored.sourceVersion,
      };
    }, bookmarkCheck);

    const savedStation = storageCheck.station;
    record(
      'P1-WEB-05 V3 书签结构 (产品校验函数通过 + 迁移往返保站点) 与 localStorage 存储 (schemaVersion=3)',
      bookmarkValid &&
        bookmarkRound.schemaVersion === 3 &&
        !!bookmarkRound.surfaceStation &&
        storageCheck.schemaVersion === 3 &&
        storageCheck.hasStation &&
        savedStation.bodyFixedPosM.every(Number.isFinite) &&
        Math.hypot(...savedStation.surfaceNormal) > 0.99 &&
        savedStation.eyeHeightM === 1.7 &&
        savedStation.orientationDeg?.yawDeg === 225 &&
        storageCheck.observationMode === 'physical',
      {
        bookmarkValid,
        storageSchemaVersion: storageCheck.schemaVersion,
        observationMode: storageCheck.observationMode,
        sourceVersion: storageCheck.sourceVersion,
        stationKeys: savedStation ? Object.keys(savedStation) : [],
      }
    );

    // 推进 12h 后按书签恢复 (与 App.handleRestoreBookmark 同参数路径)
    await page.evaluate(() => {
      const engine = (window as any).__solarEngine;
      engine.setSimTimeHours(12);
    });
    await new Promise((r) => setTimeout(r, 500));

    await page.evaluate((saved: any) => {
      const engine = (window as any).__solarEngine;
      engine.executeCameraCommand({
        type: 'enterSurfaceLook',
        bodyId: saved.bodyId,
        lat: saved.latDeg,
        lon: saved.lonDeg,
        eyeHeightM: saved.eyeHeightM,
        initialYawDeg: saved.orientationDeg?.yawDeg,
        initialPitchDeg: saved.orientationDeg?.pitchDeg,
      });
      engine.executeCameraCommand({ type: 'lookAtSkyTarget', targetBodyId: 'earth' });
    }, savedStation);
    await new Promise((r) => setTimeout(r, 800));

    const restored = await page.evaluate(() => {
      const engine = (window as any).__solarEngine;
      const pose = engine.getSurfaceStationPose();
      const cam = engine.getCamera();
      const moon = engine.getBodyWorldPose('moon');
      const [qx, qy, qz, qw] = [moon.quaternion.x, moon.quaternion.y, moon.quaternion.z, -moon.quaternion.w];
      const rx = cam.position.x - moon.pos.x;
      const ry = cam.position.y - moon.pos.y;
      const rz = cam.position.z - moon.pos.z;
      const tx = 2 * (qy * rz - qz * ry);
      const ty = 2 * (qz * rx - qx * rz);
      const tz = 2 * (qx * ry - qy * rx);
      const bx = rx + qw * tx + (qy * tz - qz * ty);
      const by = ry + qw * ty + (qz * tx - qx * tz);
      const bz = rz + qw * tz + (qx * ty - qy * tx);
      const len = Math.hypot(bx, by, bz);
      return {
        station: pose?.station ?? null,
        near: cam.near,
        aglM: (len / (pose?.metricScale ?? 1)) - 1737400 - (pose?.station.heightM ?? 0),
      };
    });

    const rs = restored.station;
    const latOk = Math.abs(rs.latDeg - savedStation.latDeg) < 1e-9;
    const lonOk = Math.abs(rs.lonDeg - savedStation.lonDeg) < 1e-9;
    const eyeOk = rs.eyeHeightM === savedStation.eyeHeightM;
    const orientOk =
      rs.orientationDeg.yawDeg === savedStation.orientationDeg.yawDeg &&
      rs.orientationDeg.pitchDeg === savedStation.orientationDeg.pitchDeg;
    record(
      'P1-WEB-06 推进 12h 后恢复 V3 书签：站点/眼高/朝向一致，净空 ≈ 眼高 (未埋地)',
      latOk && lonOk && eyeOk && orientOk && Math.abs(restored.aglM - 1.7) < 0.05,
      {
        latDeg: rs.latDeg, lonDeg: rs.lonDeg, eyeHeightM: rs.eyeHeightM,
        orientationDeg: rs.orientationDeg, aglM: restored.aglM, near: restored.near,
      }
    );

    await saveScreenshot('72-p1-bookmark-restored-t12h.png');

    // ---------- 检查 5: 观察模式合并行为 (云层联动 + 用户选择保留) ----------
    console.log('\n【检查 5】合并后的 setObservationMode：云层联动与用户云层选择保留...');
    const modeCheck = await page.evaluate(() => {
      const engine = (window as any).__solarEngine;
      const seq: Record<string, unknown> = {};
      engine.setShowClouds(true);
      seq.physicalDefaultCloudVisible = engine.getBodyNode('earth')?.cloudMesh?.visible ?? null;
      engine.setObservationMode('terrain-study');
      seq.terrainCloudVisible = engine.getBodyNode('earth')?.cloudMesh?.visible ?? null;
      seq.engineObservationMode = engine.getObservationMode();
      engine.setObservationMode('physical');
      seq.backToPhysicalCloudVisible = engine.getBodyNode('earth')?.cloudMesh?.visible ?? null;
      // 用户手动关云后切换模式再切回，应保留用户选择
      engine.setShowClouds(false);
      engine.setObservationMode('terrain-study');
      engine.setObservationMode('physical');
      seq.userCloudsOffPreserved = engine.getBodyNode('earth')?.cloudMesh?.visible ?? null;
      engine.setShowClouds(true); // 还原
      return seq;
    });
    record(
      'P1-WEB-07 观察模式合并行为 (terrain 隐藏云、physical 恢复、用户手动关云被保留)',
      modeCheck.physicalDefaultCloudVisible === true &&
        modeCheck.terrainCloudVisible === false &&
        modeCheck.engineObservationMode === 'terrain-study' &&
        modeCheck.backToPhysicalCloudVisible === true &&
        modeCheck.userCloudsOffPreserved === false,
      modeCheck
    );

    // ---------- 检查 6: 主引擎渲染帧率 ----------
    console.log('\n【检查 6】主引擎渲染循环帧率采样 (getRenderFrameCount，非独立 rAF)...');
    const perf = await page.evaluate(async () => {
      const engine = (window as any).__solarEngine;
      const startFrames = engine.getRenderFrameCount();
      const start = performance.now();
      await new Promise((r) => setTimeout(r, 5000));
      const endFrames = engine.getRenderFrameCount();
      const elapsed = (performance.now() - start) / 1000;
      const fps = (endFrames - startFrames) / elapsed;
      return { startFrames, endFrames, frames: endFrames - startFrames, elapsedSec: elapsed, fps: Number(fps.toFixed(1)) };
    });
    record(
      'P1-WEB-08 主引擎渲染帧率 (5s 实测)',
      perf.frames > 0 && perf.fps >= 30,
      perf
    );

    // ---------- 汇总 ----------
    const failed = checks.filter((c) => !c.pass);
    const status = failed.length === 0 && consoleErrors.length === 0 ? 'PASSED' : 'FAILED';
    const report = {
      batch: 'P1',
      name: '公共物理与米制空间内核实机端到端验收',
      commit: COMMIT,
      targetUrl: TARGET_URL,
      timestamp: new Date().toISOString(),
      status,
      checks,
      performance: perf,
      screenshots: [
        '70-p1-moon-surface-look-t0.png',
        '71-p1-moon-surface-look-t12h.png',
        '72-p1-bookmark-restored-t12h.png',
      ],
      consoleErrors,
      consoleWarnings,
    };
    const reportPath = path.join(OUTPUT_DIR, 'batch-p1-physics-core-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
    console.log(`\n📄 验收报告已生成: ${reportPath}`);

    console.log('='.repeat(80));
    console.log(`${status === 'PASSED' ? '🎉' : '💥'} 批次 P1 实机验收结果: ${status}`);
    console.log(`- 检查项: ${checks.length - failed.length}/${checks.length} 通过`);
    console.log(`- 控制台错误: ${consoleErrors.length}`);
    if (failed.length > 0) {
      console.log('失败项:');
      for (const f of failed) console.log(`  ❌ ${f.name}`);
    }
    console.log('='.repeat(80));

    if (status !== 'PASSED') {
      await browser.close();
      process.exitCode = 1;
      return;
    }
  } catch (err) {
    console.error('验收脚本执行失败:', err);
    const reportPath = path.join(OUTPUT_DIR, 'batch-p1-physics-core-report.json');
    fs.writeFileSync(
      reportPath,
      JSON.stringify(
        {
          batch: 'P1',
          commit: COMMIT,
          targetUrl: TARGET_URL,
          timestamp: new Date().toISOString(),
          status: 'FAILED',
          error: String(err),
          checks,
          consoleErrors,
          consoleWarnings,
        },
        null,
        2
      ),
      'utf8'
    );
    throw err;
  } finally {
    await browser.close().catch(() => undefined);
  }
}

runP1Verification().catch(() => process.exit(1));
