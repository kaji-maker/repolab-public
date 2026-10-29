import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import {join} from 'node:path';
import {createCloudRunPool} from '../packages/repositories/cloud-run-pool-v1.mjs';
function fixture(root,overrides={}){
  const servers=[],records=new Map();let executions=0,probes=0;
  const deps={root,store:{},history:{list:async()=>[...records.values()],get:async id=>records.get(id)??null,patch:async()=>{throw Error('No fixture patch');}},
    readiness:()=>({available:true,reason:'Reviewed fixture only'}),proof:()=>{},preflight:async()=>{probes++;return {status:'PASS_READ_ONLY_PROVIDER_ACCESS',inference:'none',execution:'fixture'};},
    execute:async o=>{executions++;const r={id:o.id,status:'ACCEPTED_INDEPENDENTLY_CORRECT',verified:true,simulated:false,active:false,executionUncertain:false,usageComplete:true,inferenceCalls:0,executionCount:0};records.set(o.id,r);return r;},
    queueView:(id,at,error)=>({id,at,error,status:error?'ERROR':'PREPARING',verified:false,simulated:true}),
    createServer:(_store,_port,options)=>{const server={options,closed:false,start:async()=>4300+servers.length,close:async()=>{server.closed=true;}};servers.push(server);return server;},...overrides};
  return {pool:createCloudRunPool(deps),servers,records,counts:()=>({executions,probes})};
}
async function withFixture(fn){const root=fs.mkdtempSync(join(os.tmpdir(),'repolab-cloud-pool-fixture-'));try{await fn(root);}finally{fs.rmSync(root,{recursive:true,force:true});}}
test('catalog/readiness never dispatch; concurrent initial reads share one capability',()=>withFixture(async root=>{
  const f=fixture(root);const origins=await Promise.all([f.pool.origin(true),f.pool.origin(true)]);assert.equal(origins[0],origins[1]);assert.equal(f.servers.length,1);assert.deepEqual(f.counts(),{executions:0,probes:0});await f.pool.close();
}));
test('multiple settled user-started runs have distinct claims and no overall run quota',()=>withFixture(async root=>{
  const f=fixture(root);await f.pool.origin(true);
  for(let i=0;i<3;i++){
    const options=f.servers.at(-1).options;assert.equal(options.admission.readiness().available,true);
    await options.admission.consume();await options.execute({id:options.admission.id,entrypoint:'api'});
    const before=f.servers.length;await f.pool.origin(false);assert.equal(f.servers.length,before);
    await f.pool.origin(true);
  }
  assert.equal(f.counts().executions,3);assert.equal(fs.readdirSync(join(root,'runs')).length,3);
  assert.equal(new Set(f.servers.map(s=>s.options.admission.id)).size,4);await f.pool.close();
}));
test('capability consumed exactly once and pending work blocks readiness',()=>withFixture(async root=>{
  const f=fixture(root);await f.pool.origin();const options=f.servers[0].options;await options.admission.consume();
  assert.equal(options.admission.readiness().available,false);await assert.rejects(options.admission.consume());assert.equal(f.counts().probes,1);
  await f.pool.close();const restarted=fixture(root);await restarted.pool.origin();assert.equal(restarted.servers[0].options.admission.readiness().available,false);assert.equal(restarted.counts().executions,0);await restarted.pool.close();
}));
test('preflight failure retains claim, reports unverified queue and never executes',()=>withFixture(async root=>{
  const f=fixture(root,{preflight:async()=>{throw Error('reviewed fixture rejected');}});await f.pool.origin();const o=f.servers[0].options;
  await assert.rejects(o.admission.consume());assert.equal(f.pool.inspect().held,true);assert.equal((await o.history.get(o.admission.id)).verified,false);assert.equal(f.counts().executions,0);await f.pool.origin(true);assert.equal(f.servers.length,1);await f.pool.close();
}));
test('execution overrides rejected before engine invocation; hold survives restart',()=>withFixture(async root=>{
  const f=fixture(root);await f.pool.origin();const o=f.servers[0].options;await o.admission.consume();
  await assert.rejects(o.execute({id:o.admission.id,entrypoint:'api',simulation:{}}));assert.equal(f.counts().executions,0);await f.pool.close();
  const restarted=fixture(root);await restarted.pool.origin();assert.equal(restarted.pool.inspect().held,true);await restarted.pool.close();
}));
test('unsettled terminal evidence cannot close a claim or enable another run',()=>withFixture(async root=>{
  const f=fixture(root,{execute:async o=>{f.records.set(o.id,{id:o.id,status:'ERROR',active:false,executionUncertain:true,usageComplete:false});return {};}});
  await f.pool.origin();const o=f.servers[0].options;await o.admission.consume();await assert.rejects(o.execute({id:o.admission.id,entrypoint:'api'}));assert.equal(f.pool.inspect().held,true);assert.equal(fs.existsSync(join(root,'runs',o.admission.id,'COMPLETED.json')),false);await f.pool.close();
}));
test('restart rechecks completed claim against raw history',()=>withFixture(async root=>{
  const f=fixture(root);await f.pool.origin();const o=f.servers[0].options;await o.admission.consume();await o.execute({id:o.admission.id,entrypoint:'api'});await f.pool.close();
  const restarted=fixture(root);await restarted.pool.origin();assert.equal(restarted.pool.inspect().held,true);await restarted.pool.close();
}));
test('simulated result cannot close a production capability',()=>withFixture(async root=>{
  const f=fixture(root,{execute:async o=>{f.records.set(o.id,{id:o.id,status:'ABSTAINED',active:false,executionUncertain:false,usageComplete:true,simulated:true});return {};}});
  await f.pool.origin();const o=f.servers[0].options;await o.admission.consume();await assert.rejects(o.execute({id:o.admission.id,entrypoint:'api'}));assert.equal(f.pool.inspect().held,true);await f.pool.close();
}));
