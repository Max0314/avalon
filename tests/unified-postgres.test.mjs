import {test} from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {randomBytes} from 'node:crypto';
import {PostgresStore} from '../server/postgres-store.mjs';
import {buildApp} from '../server/app.mjs';
const account=async header=>header?.includes('fixture=owner')?{sub:'fixture-owner',name:'朋友'}:header?.includes('fixture=other')?{sub:'fixture-other',name:'其他'}:null;
test('PostgreSQL 账号跨设备恢复、隔离和游客认领事务',{skip:!process.env.TEST_DATABASE_URL},async()=>{
  const url=process.env.TEST_DATABASE_URL,schema='avalon_account_'+randomBytes(8).toString('hex'),admin=new pg.Pool({connectionString:url,max:1});await admin.query(`CREATE SCHEMA "${schema}"`);
  let app;const start=async()=>{const repository=await PostgresStore.open(url,{schema});app=buildApp({repository,resolveAccount:account,rateLimit:false});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));app.publicOrigin=`http://127.0.0.1:${app.server.address().port}`;return app.publicOrigin;};
  try{
    let base=await start();const request=async(path,cookie='',body)=>{const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{cookie,...(body===undefined?{}:{origin:base,'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});return{status:response.status,value:await response.json(),cookie:response.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ')};};
    const guest=await request('/api/session'),created=await request('/api/rooms',guest.cookie,{}),code=created.value.view.code;
    const signed=await request('/api/session','fixture=owner; '+guest.cookie);assert.notEqual(signed.value.person.id,guest.value.person.id);assert.equal(signed.value.room,null);
    const owner='fixture=owner; '+signed.cookie,preview=await request('/api/account/guest-preview',owner,{});assert.equal(preview.status,200);assert.equal(preview.value.consumesOpportunity,false);
    assert.equal((await request('/api/account',owner)).value.guestClaimAvailable,true);
    const bad=await request('/api/account/guest-claim',owner.replace('fixture=owner','fixture=other'),{previewToken:preview.value.previewToken,confirm:true});assert.equal(bad.status,409);
    await admin.query(`ALTER TABLE "${schema}".avalon_guest_claims ADD CONSTRAINT reject_fixture CHECK(account_id<>'fixture-owner')`);
    const failed=await request('/api/account/guest-claim',owner,{previewToken:preview.value.previewToken,confirm:true});assert.equal(failed.status,503);assert.equal((await admin.query(`SELECT count(*)::int n FROM "${schema}".avalon_guest_claims`)).rows[0].n,0);
    await app.close();app=null;await admin.query(`ALTER TABLE "${schema}".avalon_guest_claims DROP CONSTRAINT reject_fixture`);base=await start();
    const preview2=await request('/api/account/guest-preview',owner,{});assert.equal(preview2.status,200);
    const claimed=await request('/api/account/guest-claim',owner,{previewToken:preview2.value.previewToken,confirm:true});assert.equal(claimed.status,200);
    assert.deepEqual((await request('/api/account/guest-claim',owner,{previewToken:preview2.value.previewToken,confirm:true})).value,claimed.value);
    const recovered=await request('/api/session','fixture=owner');assert.equal(recovered.value.person.id,guest.value.person.id);assert.equal(recovered.value.room.code,code);assert(!JSON.stringify(recovered.value).includes('fixture-owner'));assert(!JSON.stringify(recovered.value).includes('secret_hash'));
    const other=await request('/api/session','fixture=other; '+recovered.cookie);assert.notEqual(other.value.person.id,guest.value.person.id);assert.equal((await request('/api/rooms/'+code,'fixture=other; '+other.cookie)).status,403);
    assert.equal((await request('/api/rooms/'+code,guest.cookie)).status,401);
    await assert.rejects(PostgresStore.open(url,{schema}),/Another Avalon authority/);
    await app.close();app=null;base=await start();const restored=await request('/api/session','fixture=owner');assert.equal(restored.value.room.code,code);assert.equal((await request('/api/account','fixture=owner; '+restored.cookie)).value.guestClaimAvailable,false);
  }finally{if(app)await app.close();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}
});
