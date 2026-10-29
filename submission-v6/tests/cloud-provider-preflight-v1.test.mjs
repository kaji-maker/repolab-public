import test from 'node:test';
import assert from 'node:assert/strict';
import { selectProviderEnvironment } from '../packages/repositories/cloud-provider-config-v1.mjs';
import { checkProviderAccess,PreflightStopped } from '../packages/repositories/cloud-provider-preflight-v1.mjs';
const config=selectProviderEnvironment({NEBIUS_API_KEY:'reviewed-fixture-key-'+ 'x'.repeat(24),NEBIUS_PROJECT_ID:'fixture-project'},true);
const catalog={data:[{id:config.NEBIUS_MODEL,pricing:{prompt:'0.0000003',completion:'0.0000009'}}]};
const token={token_expiration:null,permissions:{spawn:true,spawn_disposable:true,cancel:true}};
function stub(bodies){const calls=[];return {calls,fetch:async(url,init)=>{calls.push({url,init});const body=bodies[calls.length-1];return new Response(JSON.stringify(body?.body??body),{status:body?.status??200});}};}
test('only three fixed GETs; strips unrelated response fields',async()=>{
  const s=stub([catalog,{...token,unexpectedSecret:config.NEBIUS_API_KEY},{uuid:'d4c8d3fb-7f4c-48dc-9c81-0522eb247051'}]);
  const r=await checkProviderAccess(config,s.fetch);assert.equal(r.status,'PASS_READ_ONLY_PROVIDER_ACCESS');
  assert.equal(s.calls.length,3);assert.ok(s.calls.every(x=>x.init.method==='GET'&&x.init.redirect==='error'));
  assert.equal(s.calls[1].init.headers.Project,'fixture-project');assert.equal(JSON.stringify(r).includes(config.NEBIUS_API_KEY),false);
});
test('changed price stops before Sandbox access',async()=>{const s=stub([{data:[{id:config.NEBIUS_MODEL,pricing:{prompt:'1',completion:'1'}}]}]);await assert.rejects(checkProviderAccess(config,s.fetch),e=>e.stage==='qualified-pricing-mismatch');assert.equal(s.calls.length,1);});
test('token expiry and missing permissions stop before image inspection',async()=>{
  for(const value of [{...token,token_expiration:1},{...token,permissions:{spawn:true}}]){
    const s=stub([catalog,value]);await assert.rejects(checkProviderAccess(config,s.fetch),PreflightStopped);assert.equal(s.calls.length,2);
  }
});
test('missing image is retained as failure without POST or retry',async()=>{const s=stub([catalog,token,{status:404,body:{error:'fixture missing'}}]);await assert.rejects(checkProviderAccess(config,s.fetch),e=>e.stage==='protected-image'&&e.httpStatus===404);assert.equal(s.calls.length,3);});
