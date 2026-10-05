import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OnlinePlayback } from '../src/lib/server/online-playback.js';
import { MediaGrants } from '../src/lib/server/telegram-app.js';
import type { DownloadJob, Track } from '../src/lib/types.js';
function fixture() {
  const jobs: DownloadJob[] = [];
  let creates = 0;
  const player = new OnlinePlayback({ list: async () => jobs,
    track: async (provider, id) => ({ provider, id, title: id, artists: ['Artist'], album: 'Album', cover: '', durationMs: 240000, sourceUrl: '' }),
    create: async (track: Track) => { creates++; jobs.unshift({id:`job-${track.id}`, track, audioSource:track.provider, format:'original', status:'completed', stage:'ready', createdAt:new Date().toISOString(), updatedAt:new Date().toISOString()}); },
    file: async id => ({ path:`/audio/${id}`, job:jobs.find(job=>job.id===id)! }), compatible: async path => path+'.m4a',
    grants:new MediaGrants('test-only'), identity:ip=>`hashed:${ip}`,
  });
  return {player,jobs,count:()=>creates};
}
test('online playback permits more than five Spotify songs and shares concurrent preparation', async () => {
  const {player,count} = fixture();
  for (let i=0;i<8;i++) assert.equal((await player.start('ip','spotify',String(i),'https://music.example')).available,true);
  await Promise.all(Array.from({length:6},()=>player.start('ip','qq','same-song','https://music.example')));
  assert.equal(count(),9);
});
test('prepared QQ audio is browser compatible and grants cannot cross IP, provider or track', async () => {
  const {player} = fixture(); const result = await player.start('ip','qq','track','https://music.example');
  assert.equal(result.limited,false); const url = new URL(result.url!);
  const job=url.searchParams.get('job')!, grant=url.searchParams.get('grant')!;
  assert.equal(await player.file('ip','qq','track',job,grant), '/audio/job-track.m4a');
  await assert.rejects(player.file('other-ip','qq','track',job,grant), {code:'LISTEN_GRANT'});
  await assert.rejects(player.file('ip','netease','track',job,grant), {code:'LISTEN_GRANT'});
  await assert.rejects(player.file('ip','qq','other-track',job,grant), {code:'LISTEN_GRANT'});
});
test('failed preparations expose the actual source failure and can be retried', async () => {
  const {player,jobs,count} = fixture(); await player.start('ip','qq','track','https://music.example');
  jobs[0]!.status='failed'; jobs[0]!.error='No source available'; jobs[0]!.errorCode='NO_AUDIO';
  await assert.rejects(player.status('ip','qq','track','https://music.example'), {code:'NO_AUDIO',message:'No source available'});
  assert.equal((await player.start('ip','qq','track','https://music.example')).available,true); assert.equal(count(),2);
});
