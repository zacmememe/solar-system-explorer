// Integration checks use an isolated Git fixture under the ignored D-drive export folder.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const parent = path.join(root, 'review-exports');
fs.mkdirSync(parent, { recursive: true });
const fixture = fs.mkdtempSync(path.join(parent, 'export-check-'));
function write(file, text) {
  fs.mkdirSync(path.dirname(path.join(fixture, file)), { recursive: true });
  fs.writeFileSync(path.join(fixture, file), text);
}
function git(...args) {
  return execFileSync('git', args, { cwd: fixture, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}
function run(...args) {
  return spawnSync(process.execPath, ['scripts/export-review.mjs', ...args], { cwd: fixture, encoding: 'utf8' });
}
function exported(result) {
  assert.equal(result.status, 0, result.stderr);
  const review = result.stdout.match(/^Review: (.+)$/m)?.[1].trim();
  assert.ok(review, 'Exporter must identify its output');
  const folder = path.dirname(review);
  const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json'), 'utf8'));
  for (const item of manifest.selectedPaths) {
    const data = fs.readFileSync(path.join(folder, 'snapshot', item.path));
    assert.equal(crypto.createHash('sha256').update(data).digest('hex'), item.sha256);
  }
  if (process.platform === 'win32') {
    assert.ok(fs.existsSync(folder + '.zip'));
    assert.equal(fs.readFileSync(folder + '.zip').subarray(0, 2).toString(), 'PK');
  }
  return { folder, manifest };
}

write('scripts/export-review.mjs', fs.readFileSync(path.join(root, 'scripts/export-review.mjs')));
write('.gitignore', 'review-exports/\n.env\n');
write('README.md', '# Fixture\n');
write('src/中文.ts', 'export const value = 1;\n');
write('public/sample.bin', Buffer.from([1, 2, 3]));
git('init', '-b', 'main');
git('add', '.');
git('-c', 'user.name=Review Export Check', '-c', 'user.email=review@example.invalid', 'commit', '-m', 'fixture baseline');
const base = git('rev-parse', 'HEAD');
write('src/中文.ts', 'export const value = 2;\n');
write('src/new.ts', 'export const added = true;\n');
write('.env', 'fixture-local-value\n');

const committed = exported(run());
assert.equal(committed.manifest.commit, base);
assert.equal(committed.manifest.mode, 'committed');
assert.equal(committed.manifest.localChangesPresentAtStart, true);
assert.equal(fs.readFileSync(path.join(committed.folder, 'snapshot/src/中文.ts'), 'utf8'), 'export const value = 1;\n');
assert.ok(!fs.existsSync(path.join(committed.folder, 'snapshot/src/new.ts')));
assert.ok(!fs.existsSync(path.join(committed.folder, 'snapshot/.env')));
assert.ok(!fs.existsSync(path.join(committed.folder, 'snapshot/public/sample.bin')));
assert.equal(committed.manifest.assets.files.length, 1);

const working = exported(run('--working-tree', '--with-images', '--base', base));
assert.equal(working.manifest.mode, 'working-tree');
assert.equal(fs.readFileSync(path.join(working.folder, 'snapshot/src/中文.ts'), 'utf8'), 'export const value = 2;\n');
assert.ok(fs.existsSync(path.join(working.folder, 'snapshot/src/new.ts')));
assert.ok(fs.readFileSync(path.join(working.folder, 'changes.patch'), 'utf8').includes('+export const value = 2;'));
assert.equal(working.manifest.images.missing.length, 5);

// Deliberately synthetic credential-like string; never a real credential.
const synthetic = ['gh', 'p_', 'a'.repeat(30)].join('');
write('src/secret.ts', `export const secret = '${synthetic}';\n`);
const blocked = run('--working-tree');
assert.notEqual(blocked.status, 0);
assert.ok(blocked.stderr.includes('Possible credential'));
assert.ok(!blocked.stderr.includes(synthetic));
assert.notEqual(run('--base').status, 0);
console.log('PASS: committed snapshot, dirty snapshot, untracked source, Unicode paths, hashes, ZIP, asset inventory, diff, missing images, secret rejection and invalid options.');
console.log(`Fixture retained for inspection: ${fixture}`);
