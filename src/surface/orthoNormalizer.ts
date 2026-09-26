/** Exact P99.5 order statistic of ALL packed uint16 samples, including masked
 * pixels. Preserve the historical zero/empty fallback; masking happens at RGBA
 * conversion. Histogram avoids millions of boxed numbers and O(n log n) sorting. */
export function orthoP995(data: Uint16Array): number {
  if (!data.length) return 4096;
  const bins = new Uint32Array(65536);
  for (let i = 0; i < data.length; i++) bins[data[i]]++;
  const rank = Math.floor((data.length - 1) * .995);
  let cumulative = 0;
  for (let value = 0; value < bins.length; value++) {
    cumulative += bins[value];
    if (cumulative > rank) return value || 4096;
  }
  return 4096;
}
