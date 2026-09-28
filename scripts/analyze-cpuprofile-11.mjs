// 解析 .cpuprofile：按 self-time 排序热点 + 时间窗过滤（启动长任务段）
import fs from 'node:fs';
const file = process.argv[2];
const winStart = process.argv[3] ? Number(process.argv[3]) : null; // μs
const winEnd = process.argv[4] ? Number(process.argv[4]) : null;
const p = JSON.parse(fs.readFileSync(file, 'utf8'));
const nodes = new Map(p.nodes.map((n) => [n.id, n]));
// hitCount 是整个 profile 的；用 samples+timeDeltas 按时间窗统计 self
const self = new Map();
let t = 0;
for (let i = 0; i < p.samples.length; i++) {
  const dt = p.timeDeltas[i] ?? 0;
  t += dt;
  if (winStart != null && (t < winStart || t > winEnd)) continue;
  const id = p.samples[i];
  self.set(id, (self.get(id) ?? 0) + dt);
}
const rows = [...self.entries()]
  .map(([id, us]) => {
    const n = nodes.get(id);
    if (!n) return null;
    const cf = n.callFrame;
    return {
      ms: +(us / 1000).toFixed(0),
      fn: (cf.functionName || '(anonymous)'),
      url: (cf.url || '').replace(/^.*\/(node_modules|src)\//, '$1/').slice(0, 90),
      line: cf.lineNumber + 1,
    };
  })
  .filter(Boolean)
  .sort((a, b) => b.ms - a.ms)
  .slice(0, 25);
const total = [...self.values()].reduce((a, b) => a + b, 0) / 1000;
console.log(`window: ${winStart != null ? `${(winStart / 1000).toFixed(0)}ms..${(winEnd / 1000).toFixed(0)}ms` : 'full'}; sampled total ${total.toFixed(0)}ms`);
for (const r of rows) console.log(`${String(r.ms).padStart(6)}ms  ${r.fn}  ${r.url}:${r.line}`);
// top1 的祖先链
if (rows[0]) {
  let n = [...self.entries()].sort((a, b) => b[1] - a[1])[0];
  let cur = nodes.get(n[0]);
  console.log('\n--- top1 ancestry ---');
  const chain = [];
  while (cur && chain.length < 20) {
    chain.push(`${cur.callFrame.functionName || '(anon)'} ${(cur.callFrame.url || '').replace(/^.*\/(node_modules|src)\//, '$1/').split('?')[0]}:${cur.callFrame.lineNumber + 1}`);
    cur = cur.parent ? nodes.get(cur.parent) : null;
  }
  console.log(chain.join('\n  <- '));
}
