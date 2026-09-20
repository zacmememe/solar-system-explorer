import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TOKEN = process.env.VERCEL_TOKEN || process.argv[2] || '';
const TEAM_ID = process.env.VERCEL_TEAM_ID || 'team_AxIhctzAfh9COcVvBBDnjGqJ';
const PROJECT_NAME = 'solar-system-explorer';

if (!TOKEN) {
  console.error('请提供 VERCEL_TOKEN 环境变量或作为命令行参数传递');
  process.exit(1);
}

interface DeployFile {
  relativePath: string;
  fullPath: string;
  sha1: string;
  size: number;
}

function getAllFiles(dirPath: string, rootDir: string): DeployFile[] {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  let files: DeployFile[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(getAllFiles(fullPath, rootDir));
    } else {
      const buffer = fs.readFileSync(fullPath);
      const sha1 = crypto.createHash('sha1').update(buffer).digest('hex');
      const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, '/');
      files.push({
        relativePath,
        fullPath,
        sha1,
        size: buffer.length,
      });
    }
  }

  return files;
}

async function ensureProject(): Promise<void> {
  const checkUrl = `https://api.vercel.com/v9/projects/${PROJECT_NAME}?teamId=${TEAM_ID}`;
  const checkRes = await fetch(checkUrl, {
    headers: { 'Authorization': `Bearer ${TOKEN}` },
  });

  if (checkRes.status === 200) {
    console.log(`[Vercel API] 项目 ${PROJECT_NAME} 已存在。`);
    return;
  }

  console.log(`[Vercel API] 项目 ${PROJECT_NAME} 尚未创建，正在新建...`);
  const createUrl = `https://api.vercel.com/v9/projects?teamId=${TEAM_ID}`;
  const createRes = await fetch(createUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: PROJECT_NAME,
      framework: null,
    }),
  });

  if (!createRes.ok) {
    const err = await createRes.text();
    console.warn(`[Vercel API] 创建项目提示: ${createRes.status} ${err}`);
  } else {
    console.log(`[Vercel API] 项目 ${PROJECT_NAME} 创建成功！`);
  }
}

async function uploadFile(file: DeployFile): Promise<void> {
  const buffer = fs.readFileSync(file.fullPath);
  const url = `https://api.vercel.com/v2/files?teamId=${TEAM_ID}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/octet-stream',
      'Content-Length': buffer.length.toString(),
      'x-vercel-digest': file.sha1,
    },
    body: buffer,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`上传文件失败 [${file.relativePath}]: ${res.status} ${text}`);
  }

  console.log(`  ✓ 已校验/上传: ${file.relativePath} (${(file.size / 1024).toFixed(1)} KB)`);
}

async function main() {
  console.log('====================================================');
  console.log('🚀 开始通过 Vercel API 部署静态生产包');
  console.log('====================================================');

  await ensureProject();

  const distDir = path.resolve(__dirname, '..', 'dist');
  if (!fs.existsSync(distDir)) {
    throw new Error('未找到 dist/ 目录，请先执行 npm run build');
  }

  const files = getAllFiles(distDir, distDir);
  console.log(`共发现 ${files.length} 个生产文件，准备同步...`);

  for (const file of files) {
    await uploadFile(file);
  }

  console.log('\n正在向 Vercel 提交生产部署请求...');

  const deployPayload = {
    name: PROJECT_NAME,
    target: 'production',
    files: files.map((f) => ({
      file: f.relativePath,
      sha: f.sha1,
      size: f.size,
    })),
    projectSettings: {
      framework: null,
    },
  };

  const deployRes = await fetch(`https://api.vercel.com/v13/deployments?teamId=${TEAM_ID}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(deployPayload),
  });

  if (!deployRes.ok) {
    const errText = await deployRes.text();
    throw new Error(`部署创建失败: ${deployRes.status} ${errText}`);
  }

  const deployData: any = await deployRes.json();
  console.log('\n🎉 部署创建成功！');
  console.log(`部署 ID: ${deployData.id}`);
  console.log(`生产访问 URL: https://${deployData.url}`);

  if (deployData.alias && deployData.alias.length > 0) {
    console.log('\n🌟 官方主域名网址:');
    for (const alias of deployData.alias) {
      console.log(`  👉 https://${alias}`);
    }
  }

  console.log(`\n部署状态: ${deployData.readyState || 'BUILDING/READY'}`);
}

main().catch((err) => {
  console.error('\n❌ 部署出错:', err);
  process.exit(1);
});
