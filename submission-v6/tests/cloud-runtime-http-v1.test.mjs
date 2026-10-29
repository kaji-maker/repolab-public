// Reviewed HTTP/controller fixture only, no inference/Sandbox or candidate execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import {join} from 'node:path';
import {createCloudRuntimeRouter} from '../packages/repositories/cloud-runtime-router-v1.mjs';
import {createCloudRunPool} from '../packages/repositories/cloud-run-pool-v1.mjs';
import {createQualifiedServer} from '../apps/api/qualified-server-v2.ts';
import {Store} from '../packages/storage/store.ts';
import {queuedBrowserRecord} from '../packages/evaluation/browser-release-v2.ts';
test('actual API perimeter supports distinct sequential fixture claims without automatic dispatch',async()=>{
  const old=process.cwd(),temp=fs.mkdtempSync(join(os.tmpdir(),'repolab-cloud-http-fixture-'));
  const frontend=join(old,'dist/qualified-v5');process.chdir(temp);
  let router,store,executions=0;
  try{
    store=new Store(join(temp,'fixture.sqlite'));const records=new Map();
    const history={list:async()=>[...records.values()],get:async id=>records.get(id)??null,patch:async()=>{throw Error('Fixture has no patch');}};
    const pool=createCloudRunPool({root:join(temp,'state'),store,history,proof:()=>{},readiness:()=>({available:true,reason:'Synthetic HTTP fixture only'}),
      preflight:async()=>({status:'PASS_READ_ONLY_PROVIDER_ACCESS',inference:'none',execution:'fixture only'}),queueView:queuedBrowserRecord,
      createServer:(s,p,o)=>createQualifiedServer(s,frontend,p,o),execute:async o=>{
        executions++;const r={id:o.id,status:'ABSTAINED',verified:false,simulated:false,active:false,executionUncertain:false,usageComplete:true,
          inferenceCalls:0,executionCount:0,provenance:{inference:'none (fixture)',execution:'reviewed controller fixture only',model:'fixture'}};records.set(o.id,r);return r;}});
    router=createCloudRuntimeRouter(pool,0);const origin='http://127.0.0.1:'+await router.start(),api=origin+'/api/native-preact-repairs-v4';
    const get=async()=>await(await fetch(api)).json();assert.equal((await get()).readiness.available,true);assert.equal(executions,0);
    const ids=[];
    for(let i=0;i<2;i++){
      const response=await fetch(api,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'});assert.equal(response.status,202);ids.push((await response.json()).id);
      let catalog;for(let n=0;n<30;n++){catalog=await get();if(catalog.history.some(r=>r.id===ids.at(-1)&&r.status==='ABSTAINED')&&catalog.readiness.available)break;await new Promise(ok=>setTimeout(ok,10));}
      assert.equal(catalog.history.length,i+1);assert.equal(catalog.readiness.available,true);
    }
    assert.equal(new Set(ids).size,2);assert.equal(executions,2);
    assert.equal((await fetch(api,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{"simulation":{}}'})).status,400);
    assert.equal((await fetch(api,{method:'POST',headers:{Origin:'https://cross-site.invalid','Content-Type':'application/json'},body:'{}'})).status,403);
    assert.equal(executions,2);
  }finally{if(router)await router.close();if(store)store.close();process.chdir(old);fs.rmSync(temp,{recursive:true,force:true});}
});
