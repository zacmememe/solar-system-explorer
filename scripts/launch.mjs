import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

process.chdir(rootDir);

console.clear?.();
console.log('\x1b[36m======================================================================\x1b[0m');
console.log('\x1b[1m\x1b[33m             🪐 太阳系漫游 · 本地一键启动器 🚀\x1b[0m');
console.log('\x1b[36m======================================================================\x1b[0m\n');

// 1. 检查 node_modules 依赖
if (!fs.existsSync(path.join(rootDir, 'node_modules'))) {
  console.log('\x1b[33m[提示] 首次运行，正在自动安装项目依赖，请稍候...\x1b[0m');
  try {
    execSync('npm install', { stdio: 'inherit', cwd: rootDir });
    console.log('\x1b[32m[完成] 项目依赖安装成功！\x1b[0m\n');
  } catch (err) {
    console.error('\x1b[31m[错误] 依赖安装失败，请检查网络后重试。\x1b[0m');
    process.exit(1);
  }
}

console.log('请选择启动模式：');
console.log('  \x1b[32m[1] 极速畅玩模式\x1b[0m \x1b[90m(推荐 · 运行预编译包，帧率最高 60+ FPS，最低资源占用)\x1b[0m');
console.log('  \x1b[34m[2] 实时开发模式\x1b[0m \x1b[90m(代码热重载，保存代码即可即时生效，适合测试改动)\x1b[0m');
console.log('  \x1b[35m[3] 重新打包并启动\x1b[0m \x1b[90m(重新编译最新的生产包 dist 后启动)\x1b[0m\n');

function launchVite(mode) {
  if (mode === '3') {
    console.log('\n\x1b[35m[提示] 正在执行全量打包编译 (约需 10 秒)...\x1b[0m');
    try {
      execSync('npm run build', { stdio: 'inherit', cwd: rootDir });
    } catch {
      console.error('\x1b[31m[错误] 编译失败，请检查错误提示。\x1b[0m');
      process.exit(1);
    }
    mode = '1';
  }

  if (mode === '1') {
    const distHtml = path.join(rootDir, 'dist', 'index.html');
    if (!fs.existsSync(distHtml)) {
      console.log('\n\x1b[33m[提示] 检测到尚未生成生产包，正在自动执行首次打包...\x1b[0m');
      try {
        execSync('npm run build', { stdio: 'inherit', cwd: rootDir });
      } catch {
        console.error('\x1b[31m[错误] 打包失败，将尝试切换至实时开发模式启动...\x1b[0m');
        mode = '2';
      }
    }
  }

  const viteBin = path.join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js');

  if (mode === '2') {
    console.log('\n\x1b[36m======================================================================\x1b[0m');
    console.log('\x1b[32m 🛠️ 正在以【实时开发模式】启动服务...\x1b[0m');
    console.log('\x1b[33m 🚀 浏览器正在自动弹出：http://localhost:5173\x1b[0m');
    console.log('\x1b[90m 💡 退出提示：游玩结束后，直接关闭本命令行窗口或按 Ctrl+C 即可退出。\x1b[0m');
    console.log('\x1b[36m======================================================================\x1b[0m\n');
    const child = spawn(process.execPath, [viteBin, '--port', '5173', '--open'], {
      stdio: 'inherit',
      cwd: rootDir,
    });
    child.on('exit', (code) => process.exit(code ?? 0));
  } else {
    console.log('\n\x1b[36m======================================================================\x1b[0m');
    console.log('\x1b[32m 🪐 正在以【极速畅玩模式】启动服务...\x1b[0m');
    console.log('\x1b[33m 🚀 浏览器正在自动弹出：http://localhost:4173\x1b[0m');
    console.log('\x1b[90m 💡 退出提示：游玩结束后，直接关闭本命令行窗口或按 Ctrl+C 即可退出。\x1b[0m');
    console.log('\x1b[36m======================================================================\x1b[0m\n');
    const child = spawn(process.execPath, [viteBin, 'preview', '--port', '4173', '--open'], {
      stdio: 'inherit',
      cwd: rootDir,
    });
    child.on('exit', (code) => process.exit(code ?? 0));
  }
}

// 倒计时选择器
let countdown = 3;
let resolved = false;

function finish(choice) {
  if (resolved) return;
  resolved = true;
  if (process.stdin.isTTY) {
    try {
      process.stdin.setRawMode(false);
    } catch {}
  }
  process.stdin.pause();
  clearInterval(timer);
  launchVite(choice);
}

const timer = setInterval(() => {
  countdown--;
  if (countdown <= 0) {
    process.stdout.write(`\r>> 未选择，正在自动进入模式 [1] 极速畅玩模式...\n`);
    finish('1');
  } else {
    process.stdout.write(`\r>> 请输入选项 [1-3] (倒计时 \x1b[1m\x1b[33m${countdown}\x1b[0m 秒自动进入 [1]): `);
  }
}, 1000);

process.stdout.write(`>> 请输入选项 [1-3] (倒计时 \x1b[1m\x1b[33m${countdown}\x1b[0m 秒自动进入 [1]): `);

if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (key) => {
    if (key === '\u0003') { // Ctrl+C
      process.exit(0);
    }
    if (key === '1' || key === '\r' || key === '\n') {
      console.log('\n>> 已选择：[1] 极速畅玩模式');
      finish('1');
    } else if (key === '2') {
      console.log('\n>> 已选择：[2] 实时开发模式');
      finish('2');
    } else if (key === '3') {
      console.log('\n>> 已选择：[3] 重新打包并启动');
      finish('3');
    }
  });
} else {
  // 非交互终端环境下（如测试执行）
  setTimeout(() => {
    finish('1');
  }, 100);
}
