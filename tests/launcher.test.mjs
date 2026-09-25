import { test } from 'vitest';
import assert from 'node:assert/strict';
import { launch } from '../scripts/launch.mjs';

test('every launch rebuilds before opening its actual preview server', async () => {
  const calls = [];
  const overrides = {
    build: async () => { calls.push('build'); },
    startPreview: async options => {
      calls.push('preview');
      assert.equal(options.preview.host, '127.0.0.1');
      assert.equal(options.preview.strictPort, false);
      assert.equal(options.preview.open, false);
      assert.equal(options.preview.headers['Cache-Control'], 'no-store');
      return { printUrls: () => calls.push('url') };
    },
  };
  await launch({ open: false }, overrides);
  await launch({ open: false }, overrides);
  assert.deepEqual(calls, ['build', 'preview', 'url', 'build', 'preview', 'url']);
});

test('failed build never starts a preview of an existing old dist', async () => {
  let opened = false;
  await assert.rejects(launch({}, {
    build: () => { throw new Error('TypeScript build failed'); },
    startPreview: () => { opened = true; },
  }), /TypeScript build failed/);
  assert.equal(opened, false);
});
