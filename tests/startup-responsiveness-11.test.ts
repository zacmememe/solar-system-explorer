/**
 * F-STARTUP-RESPONSIVENESS-11 · G1 失败恢复语义（Z18-04 类级）
 * 1. RasterTerrainSource.load 失败不缓存 rejected promise：同页再次 load 产生
 *    新请求；故障解除后成功，旧 loadError 清理。
 * 2. JezeroTerrainSource.load 同律。
 * 数据：真实打包包字节（stub fetch 返回），首轮流 404 制造受控故障。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { RasterTerrainSource } from '../src/surface/RasterTerrainSource';
import { JezeroTerrainSource } from '../src/surface/JezeroTerrainSource';

const RASTER_DIR = path.resolve('public/data/dem/apollo17-v1');
const JEZERO_DIR = path.resolve('public/data/dem/jezero-hirise-v1');

function makeFetchStub(dir: string, opts: { failAll?: () => boolean }) {
  let calls = 0;
  const fetchStub = (async (input: RequestInfo | URL): Promise<Response> => {
    calls += 1;
    const url = String(input);
    if (opts.failAll?.()) {
      return new Response('stub failure', { status: 404 });
    }
    const name = url.split('/').pop() ?? '';
    const p = path.join(dir, name);
    if (name === 'metadata.json') {
      const text = readFileSync(p, 'utf8');
      return new Response(text, { status: 200 });
    }
    const buf = readFileSync(p);
    return new Response(buf, { status: 200 });
  }) as typeof fetch;
  return { fetchStub, getCalls: () => calls };
}

describe('F-STARTUP-RESPONSIVENESS-11：装载失败不永久锁死同页重试', () => {
  it('RasterTerrainSource：404 → failed；解除故障 → 同一实例再 load 发起新请求并成功', async () => {
    const src = new RasterTerrainSource();
    let failFirst = true;
    const { fetchStub, getCalls } = makeFetchStub(RASTER_DIR, { failAll: () => failFirst });
    const realFetch = globalThis.fetch;
    globalThis.fetch = fetchStub;
    try {
      await expect(src.load('https://stub/apollo17')).rejects.toThrow(/404/);
      expect(src.state).toBe('failed');
      expect(src.isReady).toBe(false);
      const callsAfterFirst = getCalls();

      // 同页重试：解除故障，再次 load 必须是新请求（fetch 再被调用）且成功
      failFirst = false;
      await src.load('https://stub/apollo17');
      expect(getCalls()).toBeGreaterThan(callsAfterFirst);
      expect(src.state).toBe('ready');
      expect(src.isReady).toBe(true);
      expect(src.error).toBeNull(); // 旧错误清理，不残留 failed 态
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('JezeroTerrainSource：metadata 404 → failed；解除后同页再 load 成功且旧错误清理', async () => {
    const src = new JezeroTerrainSource();
    let failFirst = true;
    const { fetchStub } = makeFetchStub(JEZERO_DIR, { failAll: () => failFirst });
    const realFetch = globalThis.fetch;
    globalThis.fetch = fetchStub;
    try {
      await expect(src.load('https://stub/jezero')).rejects.toThrow();
      expect(src.state).toBe('failed');
      failFirst = false;
      await src.load('https://stub/jezero');
      expect(src.state).toBe('ready');
      expect(src.error).toBeNull();
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('成功后 load 幂等：复用 resolved promise 不重复发请求', async () => {
    const src = new RasterTerrainSource();
    const { fetchStub, getCalls } = makeFetchStub(RASTER_DIR, {});
    const realFetch = globalThis.fetch;
    globalThis.fetch = fetchStub;
    try {
      await src.load('https://stub/apollo17');
      await src.load('https://stub/apollo17');
      const n = getCalls();
      await src.load('https://stub/apollo17');
      expect(getCalls()).toBe(n); // 无新请求
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
