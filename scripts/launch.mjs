import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Build first; a failed build must never open the previous dist. */
export async function launch({ open = true, port = 4173 } = {}, overrides = {}) {
  const build = overrides.build ?? (() => {
    if (!fs.existsSync(path.join(rootDir, 'node_modules', 'vite'))) {
      throw new Error('缺少项目依赖。请先在项目目录运行 npm ci --cache D:/Caches/npm，然后重试。');
    }
    // Follow the project build command, including future additional build steps.
    execSync('npm run build', { cwd: rootDir, stdio: 'inherit' });
  });
  const startPreview = overrides.startPreview ?? (async (options) => {
    const { preview } = await import('vite');
    return preview(options);
  });

  console.log('太阳系漫游：正在检查并构建当前本地源码，请稍候……');
  await build();
  console.log('构建成功，正在打开本次生成的版本。');
  const server = await startPreview({
    root: rootDir,
    preview: {
      host: '127.0.0.1', port, strictPort: false, open,
      headers: { 'Cache-Control': 'no-store' },
    },
  });
  // Vite opens the actual assigned port, including when 4173 is occupied.
  server.printUrls();
  console.log('请使用上方地址；退出时关闭此窗口或按 Ctrl+C。');
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  launch({ open: !process.argv.includes('--no-open') }).catch(error => {
    console.error('启动失败：没有打开旧版本。\n' + (error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  });
}
