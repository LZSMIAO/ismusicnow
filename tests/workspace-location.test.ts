import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readWorkspaceLocation,workspaceUrl,sourceResource,type WorkspaceLocation} from '../src/lib/workspace-location.js';
test('share URLs use concise paths and never carry the upstream link or search history',()=>{
 const base:WorkspaceLocation={view:'search',provider:'netease',resource:'普信主义',query:'普信主义'};
 const artist={...base,view:'artist' as const,resource:'https://music.163.com/artist?id=35654284'};
 assert.equal(workspaceUrl(artist),'/artist/netease/35654284');
 const parsed=readWorkspaceLocation(new URL(workspaceUrl(artist),'https://music.example'));
 assert.equal(parsed.resource,artist.resource);assert.equal(parsed.query,'');
 assert.equal(workspaceUrl({...base,view:'guide'}),'/guide'); assert.equal(workspaceUrl({...base,view:'downloads'}),'/downloads');
 assert.equal(workspaceUrl({...artist,lyrics:'qq:003OUlho2HcRHC'}),'/lyrics/qq/003OUlho2HcRHC');
 assert.equal(readWorkspaceLocation(new URL('/lyrics/qq/003OUlho2HcRHC','https://music.example')).lyrics,'qq:003OUlho2HcRHC');
 assert.equal(readWorkspaceLocation(new URL(workspaceUrl(base),'https://music.example')).query,base.query);
});
test('short song routes round trip all source identities, including public platform slugs',()=>{
 const cases=[['netease','1970987777'],['spotify','1'.repeat(22)],['qq','003OUlho2HcRHC'],['kuwo','123'],['kugou','A'.repeat(32)],['migu','600123'],['qianqian','T123'],['ytm','abcdefghijk'],['soundcloud','123'],['bandcamp','artist~song'],['bilibili','BV1234567890']] as const;
 for(const [provider,id] of cases){const resource=sourceResource(provider,'track',id);const url=workspaceUrl({view:'track',provider,resource,query:'old search'});assert.equal(url,`/song/${provider}/${id}`);assert.equal(readWorkspaceLocation(new URL(url,'https://music.example')).resource,resource);}
});
