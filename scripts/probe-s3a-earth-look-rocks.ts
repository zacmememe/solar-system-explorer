/**
 * S3a 探针：
 * 1) 月面看地球稳定性（S1 近面动态化的补验证——用户曾报"地球鳞片状闪烁"）：
 *    触地姿态下相机对准地球，连拍 10 帧计算地球盘区域逐帧平均绝对差（MAD）。
 * 2) 程序碎石场（示意层）触地四向截图，供视觉核验。
 */
import puppeteer from 'puppeteer-core';
import * as path from 'path';
import { execFileSync } from 'node:child_process';

const TARGET_URL = process.env.TEST_URL || 'http://localhost:4173';
const EDGE_PATH = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = 'D:/solar-evidence/pro-review';
const FF = 'D:/Apps/ffmpeg/bin/ffmpeg.exe';

async function main() {
  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=d3d11', '--enable-webgl', '--window-size=1440,900'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => !!(window as any).__solarEngine?.getLunarValleyMesh?.()?.visible, { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 3000));

  // ---- 1) 月面看地球：按站点 ENU 基精确对准地球 ----
  const aim = await page.evaluate(() => {
    const engine = (window as any).__solarEngine;
    const T = (window as any).THREE;
    const lat = 20.2108, lon = 30.7997;
    const moon = engine.getBodyWorldPose('moon');
    const earth = engine.getBodyWorldPose('earth');
    const latRad = (lat * Math.PI) / 180, lonRad = (lon * Math.PI) / 180;
    const cosLat = Math.cos(latRad);
    const u = new T.Vector3(cosLat * Math.cos(lonRad), Math.sin(latRad), -cosLat * Math.sin(lonRad));
    const e = new T.Vector3(-Math.sin(lonRad), 0, -Math.cos(lonRad));
    const n = new T.Vector3().crossVectors(u, e);
    const d = new T.Vector3(earth.pos.x - moon.pos.x, earth.pos.y - moon.pos.y, earth.pos.z - moon.pos.z).normalize();
    const uW = u.clone().applyQuaternion(moon.quaternion);
    const eW = e.clone().applyQuaternion(moon.quaternion);
    const nW = n.clone().applyQuaternion(moon.quaternion);
    return {
      yaw: (Math.atan2(d.dot(eW), d.dot(nW)) * 180) / Math.PI,
      pitch: (Math.asin(Math.max(-1, Math.min(1, d.dot(uW)))) * 180) / Math.PI,
    };
  });
  await page.evaluate((a: { yaw: number; pitch: number }) => {
    (window as any).__solarEngine.executeCameraCommand({
      type: 'enterSurfaceLook', bodyId: 'moon', lat: 20.2108, lon: 30.7997,
      eyeHeightM: 1.7, initialYawDeg: a.yaw, initialPitchDeg: a.pitch,
    });
  }, aim);
  console.log(`地球瞄准: yaw=${aim.yaw.toFixed(1)}° pitch=${aim.pitch.toFixed(1)}°`);
  await new Promise((r) => setTimeout(r, 2000));

  const mads: number[] = [];
  let prev: Buffer | null = null;
  const W = 120, H = 120;
  for (let i = 0; i < 10; i++) {
    const shot = path.join(OUT, `s3a-earthlook-${i}.png`);
    await page.screenshot({ path: shot });
    // 以地球实际屏幕投影为中心的 120x120（避开 HUD 文本区）
    const center = await page.evaluate(() => {
      const engine = (window as any).__solarEngine;
      const T = (window as any).THREE;
      const cam = engine.getCamera();
      const earth = engine.getBodyWorldPose('earth');
      const p = new T.Vector3(earth.pos.x, earth.pos.y, earth.pos.z).project(cam);
      return { x: Math.round(((p.x + 1) / 2) * 1440), y: Math.round(((1 - p.y) / 2) * 900) };
    });
    const cx = Math.max(0, Math.min(1440 - W, center.x - W / 2));
    const cy = Math.max(0, Math.min(900 - H, center.y - H / 2));
    const buf = execFileSync(FF, ['-v', 'error', '-i', shot, '-vf', `crop=${W}:${H}:${cx}:${cy},format=gray`, '-frames:v', '1', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 24, cwd: OUT });
    if (prev) {
      let d = 0;
      for (let k = 0; k < W * H; k += 3) d += Math.abs(buf[k] - prev[k]);
      mads.push(d / (W * H / 3));
    }
    prev = Buffer.from(buf);
    await new Promise((r) => setTimeout(r, 350));
  }
  console.log('Earth-look 帧间 MAD:', mads.map((m) => m.toFixed(2)).join(', '));
  const maxMad = Math.max(...mads);

  // ---- 2) 碎石场四向截图（1.7m 平视）----
  for (const [name, yaw] of [['n', 0], ['e', 90], ['s', 180], ['w', 270]] as const) {
    await page.evaluate((y: number) => {
      (window as any).__solarEngine.executeCameraCommand({
        type: 'enterSurfaceLook', bodyId: 'moon', lat: 20.2108, lon: 30.7997,
        eyeHeightM: 1.7, initialYawDeg: y, initialPitchDeg: 0,
      });
    }, yaw);
    await new Promise((r) => setTimeout(r, 700));
    await page.screenshot({ path: path.join(OUT, `92-s3a-rockfield-${name}.png`) });
  }
  await browser.close();

  const pass = maxMad < 1.5; // 鳞片闪烁时 MAD 通常 >4（对照 S1 前 4.9–10.6 量级）
  console.log(`max MAD = ${maxMad.toFixed(2)} → ${pass ? '✅ 稳定（无鳞片闪烁）' : '❌ 仍闪烁'}`);
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
