import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ListenQuota } from '../src/lib/server/listen-quota.js';
import { clientAddress } from '../src/lib/server/client-address.js';
const beforeMidnight = Date.parse('2026-10-04T15:59:00Z');
test('five distinct songs per IP survive restart, replays are free and midnight resets the quota', async () => {
  const root = await mkdtemp(join(tmpdir(), 'muism-listen-'));
  try {
    let quota = new ListenQuota(root);
    for (let i = 0; i < 5; i++) { await quota.reserve('203.0.113.8', String(i), beforeMidnight); await quota.commit('203.0.113.8', String(i), beforeMidnight); }
    assert.equal((await quota.reserve('203.0.113.8', '0', beforeMidnight)).remaining, 0);
    await assert.rejects(quota.reserve('203.0.113.8', 'sixth', beforeMidnight), { code: 'SPOTIFY_LISTEN_LIMIT', status: 429 });
    const key = await quota.key('203.0.113.8', beforeMidnight);
    quota = new ListenQuota(root);
    assert.equal(await quota.key('203.0.113.8', beforeMidnight), key);
    await assert.rejects(quota.reserve('203.0.113.8', 'sixth', beforeMidnight), { code: 'SPOTIFY_LISTEN_LIMIT' });
    assert.equal((await quota.reserve('203.0.113.9', 'sixth', beforeMidnight)).remaining, 4);
    assert.equal((await quota.reserve('203.0.113.8', 'sixth', beforeMidnight + 60000)).remaining, 4);
    assert.equal(await quota.has('203.0.113.8', '0', true, beforeMidnight + 60000), false);
    assert.equal((await readFile(join(root, 'quota.json'), 'utf8')).includes('203.0.113'), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('parallel tabs cannot reserve more than five; failed preparations refund their reservation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'muism-listen-'));
  try {
    const quota = new ListenQuota(root);
    const replies = await Promise.allSettled(Array.from({length: 12}, (_,i) => quota.reserve('same-ip', String(i), beforeMidnight)));
    assert.equal(replies.filter(x=>x.status==='fulfilled').length, 5);
    await quota.release('same-ip', '1', beforeMidnight);
    assert.equal((await quota.reserve('same-ip', 'replacement', beforeMidnight)).remaining, 0);
    await quota.commit('same-ip', '0', beforeMidnight); await quota.release('same-ip', '0', beforeMidnight);
    assert.equal(await quota.has('same-ip', '0', true, beforeMidnight), true);
    await assert.rejects(quota.reserve('same-ip', 'extra', beforeMidnight), {code:'SPOTIFY_LISTEN_LIMIT'});
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('client IP comes from the socket unless a trusted proxy header is explicitly configured', () => {
  const event={request:new Request('https://music.ism.tw',{headers:{'cf-connecting-ip':'198.51.100.1','x-forwarded-for':'198.51.100.2','x-muism-client-ip':'2001:0db8:0:0:0:0:0:1'}}),getClientAddress:()=> '::ffff:127.0.0.1'};
  assert.equal(clientAddress(event,''),'127.0.0.1');
  assert.equal(clientAddress(event,'x-muism-client-ip'),'2001:db8::1');
  assert.throws(()=>clientAddress(event,'missing'),{code:'CLIENT_IP'});
  assert.throws(()=>clientAddress({...event,getClientAddress:()=> 'not-an-ip'},''),{code:'CLIENT_IP'});
});
