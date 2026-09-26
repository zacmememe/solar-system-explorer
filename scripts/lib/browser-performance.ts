import type { Page } from 'puppeteer-core';

/** Browser RAF intervals, not GPU time or renderer.render (multi-pass) counts. */
export async function sampleBrowserPerformance(page: Page, label: string, durationMs = 2000) {
  // tsx/esbuild emits __name in serialized callbacks; supply its pure helper in this isolated page.
  await page.evaluate('globalThis.__name ??= ((fn) => fn)');
  return page.evaluate((label, durationMs) => new Promise<{
    label: string; status: 'complete' | 'timeout'; frames: number; engineFrames: number;
    elapsedMs: number; avgMs: number | null; p95Ms: number | null; visibility: string;
  }>(resolve => {
    const engine = (window as any).__solarEngine;
    const startFrames = engine.getRenderFrameCount(), start = performance.now();
    const intervals: number[] = [];
    let previous: number | null = null, raf = 0, done = false;
    const finish = (status: 'complete' | 'timeout') => {
      if (done) return;
      done = true;
      clearTimeout(timer); cancelAnimationFrame(raf);
      const sorted = [...intervals].sort((a, b) => a - b);
      resolve({label, status, frames: intervals.length, engineFrames: engine.getRenderFrameCount() - startFrames,
        elapsedMs: performance.now() - start,
        avgMs: sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : null,
        p95Ms: sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))] : null,
        visibility: document.visibilityState});
    };
    const timer = window.setTimeout(() => finish('timeout'), Math.max(5000, durationMs * 3));
    const tick = (now: number) => {
      if (previous !== null) intervals.push(now - previous);
      previous = now;
      if (now - start >= durationMs) finish('complete');
      else raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }), label, durationMs);
}
