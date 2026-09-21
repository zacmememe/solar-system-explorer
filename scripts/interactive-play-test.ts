/**
 * 太阳系漫游 · 沉浸式深度自主实机游玩与质感走查脚本
 * 模拟真实用户游玩路径：
 * 1. 初始地球-月球空间距离与晨昏线观测
 * 2. 飞往天王星（检验向阳面黄金侧光角、倾斜立式冰晶光环）
 * 3. 飞往海王星与海卫一（检验暗色尘埃环、深蓝大气与冰火山羽流）
 * 4. 飞往木卫二（检验高精细双脊冰裂痕与混沌地形）
 * 5. 飞往木卫一（检验活火山破火口与硫磺沉降）
 * 6. 飞往土星（检验光环投射在本体云层的黑带阴影与光环背阳阴影）
 * 7. 飞往火卫一（检验斯蒂克尼巨坑与三轴不规则物理形貌）
 */

import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CHROME_PATH = fs.existsSync('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe')
  ? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  : 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const TARGET_URL = process.env.TEST_URL || 'http://localhost:4173';
const OUTPUT_DIR = path.resolve(__dirname, '..', 'artifacts', 'playtest');
const BRAIN_DIR = 'C:\\Users\\MECHREVO\\.gemini\\antigravity\\brain\\f88fad2f-0fce-4b25-8399-7bdf09905e8c\\playtest';

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log('🎮 启动沉浸式自主实机游玩走查...');
  console.log(`目标环境: ${TARGET_URL}`);

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  if (!fs.existsSync(BRAIN_DIR)) {
    fs.mkdirSync(BRAIN_DIR, { recursive: true });
  }

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: [
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--use-gl=angle',
      '--use-angle=d3d11',
      '--window-size=1600,1000',
      '--no-sandbox',
    ],
    defaultViewport: { width: 1600, height: 1000 },
  });

  const page = await browser.newPage();

  async function capture(filename: string, desc: string) {
    const localPath = path.join(OUTPUT_DIR, filename);
    const brainPath = path.join(BRAIN_DIR, filename);
    await page.screenshot({ path: localPath });
    fs.copyFileSync(localPath, brainPath);
    console.log(`📸 [已截帧] ${desc} -> ${filename}`);
  }

  try {
    await page.goto(TARGET_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(2500);

    // 1. 地球与月球系统全景
    await capture('play-01-earth-system.png', '地球与月球系统（侧光晨昏线与月球轨道）');

    // 2. 飞往天王星
    console.log('🚀 飞往天王星 (Uranus)...');
    await page.click('button[data-testid="planet-btn-uranus"]');
    await sleep(3200);
    await capture('play-02-uranus-sunlit.png', '天王星向阳面黄金侧光与垂直立式光环');

    // 3. 飞往海王星
    console.log('🚀 飞往海王星 (Neptune)...');
    await page.click('button[data-testid="planet-btn-neptune"]');
    await sleep(3200);
    await capture('play-03-neptune-sunlit.png', '海王星深蓝大气、暗环与海卫一');

    // 4. 飞往海卫一 Triton
    console.log('🚀 飞往海卫一 (Triton)...');
    await page.waitForSelector('button[data-testid="moon-btn-triton"]');
    await page.click('button[data-testid="moon-btn-triton"]');
    await sleep(3200);
    await capture('play-04-triton-geysers.png', '海卫一极冠冰火山羽流与哈密瓜皮地形');

    // 5. 飞往木星与木卫二 Europa
    console.log('🚀 飞往木星 (Jupiter)...');
    await page.click('button[data-testid="planet-btn-jupiter"]');
    await sleep(1000);
    await capture('play-09-interplanetary-flight-arc.png', '星际霍曼转移航程推进弧（飞船实时推进）');
    await sleep(2400);
    await page.waitForSelector('button[data-testid="moon-btn-europa"]');
    await page.click('button[data-testid="moon-btn-europa"]');
    await sleep(3200);
    await capture('play-05-europa-lineae.png', '木卫二纯白水冰壳与精细双脊冰裂痕网络');

    // 6. 飞往木卫一 Io
    console.log('🚀 飞往木卫一 (Io)...');
    await page.click('button[data-testid="moon-btn-io"]');
    await sleep(3200);
    await capture('play-06-io-volcanoes.png', '木卫一硫磺活火山群与熔岩湖');

    // 7. 飞往土星与土星光环
    console.log('🚀 飞往土星 (Saturn)...');
    await page.click('button[data-testid="planet-btn-saturn"]');
    await sleep(3200);
    await capture('play-07-saturn-ring-shadow.png', '土星本体云层受光环双向投影阴影');

    // 8. 飞往火星与火卫一 Phobos
    console.log('🚀 飞往火星 (Mars)...');
    await page.click('button[data-testid="planet-btn-mars"]');
    await sleep(3200);
    await page.waitForSelector('button[data-testid="moon-btn-phobos"]');
    await page.click('button[data-testid="moon-btn-phobos"]');
    await sleep(3200);
    await capture('play-08-phobos-crater.png', '火卫一斯蒂克尼巨坑与非球体三轴形貌');

    console.log('✨ 自主实机游玩走查完成！');
  } catch (err) {
    console.error('游玩走查异常:', err);
  } finally {
    await browser.close();
  }
}

main();
