/**
 * Read-only consistency checker. NO merge, push, model calls, or test execution.
 * Supply policy from a trusted baseline, NOT from the proposed change.
 * It checks declared evidence; it cannot authenticate reviewers or prove claims true.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

const SHA = /^[0-9a-f]{40}$/;
const HASH = /^[0-9a-f]{64}$/;
export function validatePacket(packet, policy, expected, evidenceRoot) {
  const errors = [];
  const fail = text => errors.push(text);
  if (!packet || typeof packet !== 'object' || Array.isArray(packet))
    return { status: 'BLOCKED', errors: ['packet must be an object'] };
  if (!policy || policy.schemaVersion !== 1)
    return { status: 'BLOCKED', errors: ['trusted policy schema is missing'] };
  for (const key of ['baseCommit', 'candidateCommit']) {
    if (!SHA.test(expected?.[key] ?? '')) fail(`expected ${key} must be an explicit full SHA`);
    if (!SHA.test(packet[key] ?? '') || packet[key] !== expected?.[key]) fail(`${key} mismatch`);
  }
  if (packet.schemaVersion !== 1) fail('unsupported packet schema');
  if (!packet.taskId || typeof packet.taskId !== 'string') fail('taskId missing');
  if (packet.policyId !== policy.id) fail('policyId mismatch');
  if (packet.treeClean !== true) fail('candidate working tree is not declared clean');
  const authors = Array.isArray(packet.authorSessions) ? packet.authorSessions : [];
  const authorHarnesses = Array.isArray(packet.authorHarnesses) ? packet.authorHarnesses : [];
  if (!authors.length || authors.some(x => typeof x !== 'string' || !x)) fail('authorSessions missing/invalid');
  if (!authorHarnesses.length || authorHarnesses.some(x => typeof x !== 'string' || !x)) fail('authorHarnesses missing/invalid');
  const evidence = Array.isArray(packet.evidence) ? packet.evidence : [];
  const validEvidence = new Set();
  let root;
  try { root = fs.realpathSync(evidenceRoot); }
  catch { fail('evidence root missing'); }
  for (const item of evidence) {
    if (!item || typeof item.path !== 'string' || !HASH.test(item.sha256 ?? '')) {
      fail('evidence entry invalid'); continue;
    }
    if (validEvidence.has(item.path)) { fail(`duplicate evidence ${item.path}`); continue; }
    if (!root) continue;
    try {
      const resolved = fs.realpathSync(path.resolve(root, item.path));
      const relative = path.relative(root, resolved);
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
        throw new Error('outside evidence root');
      if (!fs.statSync(resolved).isFile()) throw new Error('not a file');
      const hash = crypto.createHash('sha256').update(fs.readFileSync(resolved)).digest('hex');
      if (hash !== item.sha256) throw new Error('hash mismatch');
      validEvidence.add(item.path);
    } catch (error) { fail(`evidence ${item.path}: ${error.message}`); }
  }
  const hasEvidence = entry => Array.isArray(entry?.evidence) && entry.evidence.length > 0 &&
    entry.evidence.every(x => typeof x === 'string' && validEvidence.has(x));
  const checks = Array.isArray(packet.checks) ? packet.checks : [];
  if (!Array.isArray(policy.requiredChecks) || !policy.requiredChecks.length) fail('trusted requiredChecks empty');
  for (const id of policy.requiredChecks ?? []) {
    const entries = checks.filter(x => x && x.id === id);
    if (entries.length !== 1) { fail(`check ${id} must appear exactly once`); continue; }
    const c = entries[0];
    if (c.status !== 'PASS' || c.exitCode !== 0) fail(`check ${id} did not pass`);
    if (c.candidateCommit !== expected?.candidateCommit) fail(`check ${id} is stale`);
    if (!hasEvidence(c)) fail(`check ${id} lacks verified evidence`);
  }
  const reviews = Array.isArray(packet.reviews) ? packet.reviews : [];
  const qualified = [];
  if (!Array.isArray(policy.requiredReviews)) fail('trusted requiredReviews missing');
  for (const kind of policy.requiredReviews ?? []) {
    const usable = reviews.filter(r => r && r.kind === kind && r.decision === 'APPROVE' &&
      typeof r.sessionId === 'string' && r.sessionId && !authors.includes(r.sessionId) &&
      typeof r.harness === 'string' && r.harness && r.readOnlyReview === true &&
      r.baseCommit === expected?.baseCommit && r.candidateCommit === expected?.candidateCommit && hasEvidence(r));
    if (!usable.length) fail(`review ${kind} missing, stale, self-review, or unsubstantiated`);
    qualified.push(...usable);
  }
  if (policy.requireCrossHarness === true && !qualified.some(r => !authorHarnesses.includes(r.harness)))
    fail('no qualified cross-harness review');
  if (Array.isArray(policy.architectureAuthorities) && policy.architectureAuthorities.length &&
      !qualified.some(r => r.kind === 'architecture' && policy.architectureAuthorities.includes(r.harness)))
    fail('architecture approval missing');
  return { status: errors.length ? 'BLOCKED' : 'CONSISTENT', errors,
    warning: 'CONSISTENT means declared evidence is internally consistent, NOT that the software is correct or reviewers are authenticated.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [packetFile, policyFile, evidenceRoot, baseCommit, candidateCommit] = process.argv.slice(2);
  if (!packetFile || !policyFile || !evidenceRoot || !baseCommit || !candidateCommit) {
    console.error('Usage: node check-packet.mjs packet.json trusted-policy.json evidence-root EXPECTED_BASE_SHA EXPECTED_CANDIDATE_SHA');
    process.exitCode = 2;
  } else {
    try {
      const result = validatePacket(JSON.parse(fs.readFileSync(packetFile, 'utf8')),
        JSON.parse(fs.readFileSync(policyFile, 'utf8')), { baseCommit, candidateCommit }, evidenceRoot);
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = result.status === 'CONSISTENT' ? 0 : 2;
    } catch (error) { console.error(`BLOCKED: ${error.message}`); process.exitCode = 2; }
  }
}
