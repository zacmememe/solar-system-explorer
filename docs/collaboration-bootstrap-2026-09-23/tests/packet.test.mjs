import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { validatePacket } from '../tools/check-packet.mjs';

function fixture(t) {
 const root = fs.mkdtempSync(path.join(os.tmpdir(), 'solar-packet-'));
 t.after(() => fs.rmSync(root, { recursive: true, force: true }));
 fs.writeFileSync(path.join(root, 'run.txt'), 'synthetic fixture evidence; not app verification\n');
 const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'run.txt'))).digest('hex');
 const baseCommit = 'a'.repeat(40), candidateCommit = 'b'.repeat(40);
 const policy = { schemaVersion: 1, id: 'normal-v1', requiredChecks: ['typecheck','browser-ui'], requiredReviews: ['technical','visual'], requireCrossHarness: true };
 const packet = { schemaVersion: 1, taskId: 'DEMO-1', policyId: policy.id, baseCommit, candidateCommit, treeClean: true,
   authorSessions: ['z-impl-1'], authorHarnesses: ['zcode'], evidence: [{ path: 'run.txt', sha256: hash }],
   checks: policy.requiredChecks.map(id => ({ id, status: 'PASS', exitCode: 0, candidateCommit, evidence: ['run.txt'] })),
   reviews: policy.requiredReviews.map(kind => ({ kind, decision: 'APPROVE', sessionId: 'anti-review-1', harness: 'anti',
     readOnlyReview: true, baseCommit, candidateCommit, evidence: ['run.txt'] })) };
 return { root, packet, policy, expected: {baseCommit,candidateCommit} };
}
const check = f => validatePacket(f.packet,f.policy,f.expected,f.root);
test('complete frozen evidence is consistent',t=>assert.equal(check(fixture(t)).status,'CONSISTENT'));
test('changed merge base blocks previous evidence',t=>{const f=fixture(t);f.expected.baseCommit='c'.repeat(40);assert.equal(check(f).status,'BLOCKED')});
test('changed candidate blocks previous evidence',t=>{const f=fixture(t);f.expected.candidateCommit='c'.repeat(40);assert.equal(check(f).status,'BLOCKED')});
test('dirty candidate is blocked',t=>{const f=fixture(t);f.packet.treeClean=false;assert.equal(check(f).status,'BLOCKED')});
test('missing required check is blocked',t=>{const f=fixture(t);f.packet.checks.pop();assert.equal(check(f).status,'BLOCKED')});
test('blocked is not pass',t=>{const f=fixture(t);f.packet.checks[1].status='BLOCKED';assert.equal(check(f).status,'BLOCKED')});
test('nonzero exit despite PASS is blocked',t=>{const f=fixture(t);f.packet.checks[0].exitCode=1;assert.equal(check(f).status,'BLOCKED')});
test('stale check is blocked',t=>{const f=fixture(t);f.packet.checks[0].candidateCommit='c'.repeat(40);assert.equal(check(f).status,'BLOCKED')});
test('author session cannot approve own task',t=>{const f=fixture(t);f.packet.reviews[0].sessionId='z-impl-1';assert.equal(check(f).status,'BLOCKED')});
test('technical approval alone does not imply visual approval',t=>{const f=fixture(t);f.packet.reviews.pop();assert.equal(check(f).status,'BLOCKED')});
test('visual approval alone does not imply technical approval',t=>{const f=fixture(t);f.packet.reviews.shift();assert.equal(check(f).status,'BLOCKED')});
test('same harness review is not declared cross-harness',t=>{const f=fixture(t);f.packet.reviews.forEach(r=>r.harness='zcode');assert.equal(check(f).status,'BLOCKED')});
test('tampered evidence bytes are blocked',t=>{const f=fixture(t);fs.writeFileSync(path.join(f.root,'run.txt'),'changed');assert.equal(check(f).status,'BLOCKED')});
test('missing evidence is blocked',t=>{const f=fixture(t);fs.unlinkSync(path.join(f.root,'run.txt'));assert.equal(check(f).status,'BLOCKED')});
test('review with no evidence is blocked',t=>{const f=fixture(t);f.packet.reviews[0].evidence=[];assert.equal(check(f).status,'BLOCKED')});
test('duplicate required check cannot hide failure',t=>{const f=fixture(t);f.packet.checks.push({...f.packet.checks[0],status:'FAIL'});assert.equal(check(f).status,'BLOCKED')});
test('high risk needs architecture authority',t=>{const f=fixture(t);f.policy.requiredReviews.push('architecture');f.policy.architectureAuthorities=['codex','pro'];assert.equal(check(f).status,'BLOCKED');f.packet.reviews.push({...f.packet.reviews[0],kind:'architecture',harness:'codex',sessionId:'c-review-1'});assert.equal(check(f).status,'CONSISTENT')});
test('approval after reviewer changed code is blocked',t=>{const f=fixture(t);f.packet.reviews[0].readOnlyReview=false;assert.equal(check(f).status,'BLOCKED')});
test('policy identity is checked',t=>{const f=fixture(t);f.packet.policyId='author-weakened-v1';assert.equal(check(f).status,'BLOCKED')});
test('evidence root path traversal is blocked',t=>{const f=fixture(t);const outside=path.join(path.dirname(f.root),path.basename(f.root)+'-outside.txt');fs.writeFileSync(outside,'outside');t.after(()=>fs.rmSync(outside,{force:true}));f.packet.evidence[0]={path:'../'+path.basename(outside),sha256:crypto.createHash('sha256').update('outside').digest('hex')};assert.equal(check(f).status,'BLOCKED')});
test('malformed packet fails closed',t=>{const f=fixture(t);assert.equal(validatePacket(null,f.policy,f.expected,f.root).status,'BLOCKED')});
