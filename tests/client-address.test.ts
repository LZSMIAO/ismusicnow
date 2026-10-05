import {test} from 'node:test';
import assert from 'node:assert/strict';
import {clientAddress} from '../src/lib/server/client-address.js';
test('client IP comes from the socket unless a trusted proxy header is explicitly configured', () => {
  const event={request:new Request('https://music.ism.tw',{headers:{'cf-connecting-ip':'198.51.100.1','x-forwarded-for':'198.51.100.2','x-muism-client-ip':'2001:0db8:0:0:0:0:0:1'}}),getClientAddress:()=> '::ffff:127.0.0.1'};
  assert.equal(clientAddress(event,''),'127.0.0.1');
  assert.equal(clientAddress(event,'x-muism-client-ip'),'2001:db8::1');
  assert.throws(()=>clientAddress(event,'missing'),{code:'CLIENT_IP'});
  assert.throws(()=>clientAddress({...event,getClientAddress:()=> 'not-an-ip'},''),{code:'CLIENT_IP'});
});
