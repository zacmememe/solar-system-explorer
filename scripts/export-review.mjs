import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
let workingTree = false;
let withImages = false;
let baseArg;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--working-tree') workingTree = true;
  else if (args[i] === '--with-images') withImages = true;
  else if (args[i] === '--base' && args[i + 1] && !args[i + 1].startsWith('--')) baseArg = args[++i];
  else if (args[i] === '--help') {
    console.log('npm run review:export -- [--working-tree] [--with-images] [--base COMMIT]');
    console.log('Default: committed HEAD. Output: review-exports/. No tests, commit, push or deploy.');
    process.exit(0);
  } else throw new Error(`Unknown or incomplete option: ${args[i]}`);
}

function git(args, encoding = 'utf8') {
  return execFileSync('git', args, { cwd: root, encoding, maxBuffer: 64 * 1024 * 1024 });
}
function resolveCommit(ref) {
  return git(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]).trim();
}
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const commit = resolveCommit('HEAD');
const base = baseArg ? resolveCommit(baseArg) : null;
const initialStatus = git(['status', '--porcelain=v1', '-z']);
const tree = git(['ls-tree', '-r', '-l', '-z', commit]).split('\0').filter(Boolean).map(row => {
  const tab = row.indexOf('\t');
  const [mode, type, oid, size] = row.slice(0, tab).trim().split(/\s+/);
  return { path: row.slice(tab + 1), mode, type, gitBlob: oid, bytes: Number(size) };
});
const byPath = new Map(tree.map(item => [item.path, item]));
const allPaths = workingTree
  ? [...new Set(git(['ls-files', '--cached', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean))].sort()
  : tree.filter(item => item.type === 'blob').map(item => item.path);
const rootFiles = new Set(['README.md', 'AGENTS.md', '.gitignore', 'package.json', 'package-lock.json',
  'index.html', 'tsconfig.json', 'vite.config.ts', 'vitest.config.ts', 'vercel.json']);
const textExtensions = /\.(?:[cm]?[jt]sx?|css|json|md|html|ya?ml|txt)$/i;
const imagePaths = new Set([
  'artifacts/scene-review/01-earth-framed.png',
  'artifacts/scene-review/02-saturn-rings-sunlit.png',
  'artifacts/scene-review/03-moon-closeup.png',
  'artifacts/hud-integration/1440x900.png',
  'artifacts/hud-integration/390x844.png',
]);
function isText(file) {
  return rootFiles.has(file) || (/^(?:src|tests|scripts|docs|sources)\//.test(file) && textExtensions.test(file));
}
function sensitiveName(file) {
  return file.split('/').some(part => /^\.env(?:\.|$)/i.test(part) && part !== '.env.example')
    || /(?:^|\/)(?:credentials(?:\.[^/]*)?|id_rsa|id_ed25519|\.npmrc)$/i.test(file)
    || /\.(?:pem|key|p12|pfx)$/i.test(file);
}
function checkText(file, data) {
  const text = data.toString('utf8');
  if (data.includes(0)) throw new Error(`Unexpected binary in text selection: ${file}`);
  const rules = [
    /(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}|sk-(?:proj-)?[A-Za-z0-9_-]{25,}|vcp_[A-Za-z0-9_]{20,})/,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /(?:token|api[_ -]?key|secret|password)\s*[=:：]\s*["'`]?([A-Za-z0-9_-]{20,})/i,
    /Bearer\s+[A-Za-z0-9_.-]{25,}/,
  ];
  if (rules.some(rule => rule.test(text))) {
    throw new Error(`Possible credential in ${file}; export stopped. The matched value is not printed.`);
  }
}
function readFile(file) {
  if (sensitiveName(file)) throw new Error(`Sensitive filename refused: ${file}`);
  if (!workingTree) {
    if (byPath.get(file)?.mode === '120000') throw new Error(`Symlink refused: ${file}`);
    return git(['cat-file', 'blob', `${commit}:${file}`], null);
  }
  const full = path.resolve(root, file);
  if (!fs.existsSync(full)) return null; // Deleted working-tree file.
  if (fs.lstatSync(full).isSymbolicLink() || fs.realpathSync(full) !== fs.realpathSync(root) + path.sep + file.split('/').join(path.sep)) {
    throw new Error(`Symlink or redirected path refused: ${file}`);
  }
  return fs.readFileSync(full);
}

const selected = allPaths.filter(file => isText(file) || (withImages && imagePaths.has(file)));
const snapshots = [];
for (const file of selected) {
  const data = readFile(file);
  if (!data) continue;
  if (data.length > 5 * 1024 * 1024) throw new Error(`Selected file exceeds 5 MiB: ${file}`);
  if (isText(file)) checkText(file, data);
  snapshots.push({ path: file, data, bytes: data.length, sha256: sha256(data), text: isText(file) });
}
const assets = [];
for (const file of allPaths.filter(file => file.startsWith('public/'))) {
  const data = readFile(file);
  if (data) assets.push({ path: file, bytes: data.length, sha256: sha256(data) });
}
const diffBase = base ?? commit;
const diff = git(['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--unified=3', diffBase,
  ...(workingTree ? [] : [commit]), '--', ...snapshots.filter(item => item.text).map(item => item.path)]);
checkText('changes.patch', Buffer.from(diff));

// A committed export is immutable even when Antigravity has local work in progress.
// A working-tree export is checked twice to catch concurrent edits of included files.
if (workingTree) {
  for (const item of [...snapshots, ...assets]) {
    const data = readFile(item.path);
    if (!data || sha256(data) !== item.sha256) throw new Error(`Changed during export: ${item.path}; pause editing and retry.`);
  }
  if (git(['status', '--porcelain=v1', '-z']) !== initialStatus || resolveCommit('HEAD') !== commit) {
    throw new Error('Git state changed during export; pause editing and retry.');
  }
}

const generatedAt = new Date().toISOString();
const name = `${generatedAt.replace(/[:.]/g, '-')}-${commit.slice(0, 8)}${workingTree ? '-working-tree' : ''}`;
const output = path.join(root, 'review-exports', name);
fs.mkdirSync(output, { recursive: true });
function write(relative, content) {
  const full = path.join(output, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}
for (const item of snapshots) write(`snapshot/${item.path}`, item.data);
const manifest = {
  schemaVersion: 1, generatedAt, mode: workingTree ? 'working-tree' : 'committed', commit,
  branch: git(['branch', '--show-current']).trim(), base,
  localChangesPresentAtStart: Boolean(initialStatus),
  localChangesIncluded: workingTree,
  testsExecutedByExporter: false,
  selectedPaths: snapshots.map(({ data, text, ...item }) => item),
  assets: { binaryFilesIncluded: false, files: assets },
  images: { requested: withImages, captureCommitVerified: false,
    missing: withImages ? [...imagePaths].filter(file => !snapshots.some(item => item.path === file)) : [] },
  excluded: ['node_modules', 'dist', 'credentials', 'local backups', 'raw conversations', 'historical handoff packages', 'unselected artifacts'],
};
write('manifest.json', JSON.stringify(manifest, null, 2) + '\n');
write('changes.patch', diff || '# No tracked text differences for the selected comparison.\n');

// Plain-text companions allow upload without relying on ZIP support in a given model.
let part = 1;
let context = '';
const contextFiles = [];
function flush() {
  if (!context) return;
  const file = `source-context-${String(part++).padStart(2, '0')}.md`;
  write(file, `# Source context — ${commit}${workingTree ? ' + working tree' : ''}\n\n${context}`);
  contextFiles.push(file);
  context = '';
}
for (const item of snapshots.filter(item => item.text)) {
  const text = item.data.toString('utf8');
  const fence = '`'.repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map(match => match[0].length + 1)));
  const section = `## ${item.path}\n\nSHA-256: ${item.sha256}\n\n${fence}\n${text}\n${fence}\n\n`;
  if (Buffer.byteLength(context + section) > 250_000 && context) flush();
  context += section;
}
flush();
write('REVIEW.md', `# 太阳系漫游审查快照\n\n` +
  `- 导出时间（UTC）：${generatedAt}\n- 基准 commit：${commit}\n` +
  `- 内容：${workingTree ? '工作区快照，包含选中范围内尚未提交的修改及新增文件' : '该 commit 的已提交内容，未纳入本地修改'}\n` +
  `- 比较基线：${diffBase}\n- 源码/文档及图片文件：${snapshots.length}\n` +
  `- 本地是否另有修改：${initialStatus ? '是' : '否'}\n- 导出器执行测试：否\n\n` +
  `先阅读 snapshot/README.md、snapshot/AGENTS.md 和 snapshot/docs/review-prompt.md。源码原文在 snapshot/，也按文件边界整合到 ${contextFiles.join('、')}。manifest.json 记录每个文件的哈希。\n\n` +
  `changes.patch 是选中范围内的 Git 文本差异，工作区新增且未跟踪的文件仅在快照中提供完整内容，不会出现在该 diff 中。\n\n` +
  `public/ 纹理二进制没有随包复制，路径与哈希见 manifest.json。历史聊天、旧交接包和多数生成物也不在审查范围。\n\n` +
  `随包图片只来自已有文件，本次未重新截图，不能证明与此 commit 对应。历史测试报告和文档中的通过记录也不是本轮验证。\n\n` +
  `请先报告实际读过的文件、调用链与覆盖缺口，再给问题证据、推荐方案、实施顺序和验收标准。不要声称已运行本地代码。\n`);

if (process.platform === 'win32') {
  const quote = value => "'" + value.replaceAll("'", "''") + "'";
  const command = `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory(${quote(output)}, ${quote(output + '.zip')})`;
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { cwd: root, stdio: 'pipe' });
  console.log(`ZIP: ${output}.zip`);
}
console.log(`Review: ${path.join(output, 'REVIEW.md')}`);
console.log(`Commit: ${commit}; mode: ${manifest.mode}; files: ${snapshots.length}`);
console.log('No tests, commit, push or deployment were performed by this exporter.');
