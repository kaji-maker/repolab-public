// Actual credential-bearing backend. No credentials enter gateway, tests or guest inputs.
import fs from 'node:fs';
import { Store } from '../../packages/storage/store.ts';
import { createQualifiedServer } from './qualified-server-v2.ts';
import { FreshPreactHistory } from '../../packages/repositories/preact-repair-history-v4.ts';
import { freshPreactReadiness } from '../../packages/repositories/preact-repair-history-v3.ts';
import { runFreshPreact } from '../../packages/repositories/preact-repair-v4.ts';
import { queuedBrowserRecord } from '../../packages/evaluation/browser-release-v2.ts';
import { selectProviderEnvironment } from '../../packages/repositories/cloud-provider-config-v1.mjs';
import { checkProviderAccess } from '../../packages/repositories/cloud-provider-preflight-v1.mjs';
import { createCloudRunPool,exclusiveCloudRecord } from '../../packages/repositories/cloud-run-pool-v1.mjs';
import { verifyDependencyFreeze } from "../../packages/repositories/cloud-dependency-proof-v2.mjs";
import { verifyCloudRuntime } from '../../packages/repositories/cloud-runtime-proof-v1.mjs';
import { createCloudRuntimeRouter } from '../../packages/repositories/cloud-runtime-router-v1.mjs';
let service,store;
try{
  const [mode,expected]=process.argv.slice(2);
  if(process.argv.slice(2).length!==2||!['serve','check'].includes(mode)||!/^[a-f0-9]{64}$/.test(expected??''))throw Error('Exact runtime authority required');
  const proof=()=>{verifyCloudRuntime("75a853e5be44334449705554f734478d045972670419ab487d8289c0722cac10");verifyDependencyFreeze(expected);};proof();
  const environment=selectProviderEnvironment(process.env,process.env.NEBIUS_SANDBOX_COVERAGE_CONFIRMED==='true');
  if(mode==='check'){
    const report=await checkProviderAccess(environment);
    fs.mkdirSync('.repolab/cloud-qualification-v1',{recursive:true,mode:0o700});
    exclusiveCloudRecord(`.repolab/cloud-qualification-v1/provider-preflight-${Date.now()}.json`,report);
    console.log(JSON.stringify(report));
  }else{
  store=new Store('.repolab/state.sqlite');const history=new FreshPreactHistory();
  const pool=createCloudRunPool({root:'.repolab/cloud-runtime-v1',store,history,
    createServer:(ledger,port,options)=>createQualifiedServer(ledger,'dist/qualified-v5',port,options),
    readiness:freshPreactReadiness,execute:options=>{
      if(fs.existsSync('.repolab/native-preact-repairs-v4/repair-'+options.id))throw Error('New repair identity required');
      return runFreshPreact(options);
    },proof,preflight:()=>checkProviderAccess(environment),queueView:queuedBrowserRecord,sourceIdentity:expected});
  const port=4191;service=createCloudRuntimeRouter(pool,port);await service.start();
  // Allocate only; no claim, model request or Sandbox operation occurs on startup.
  await pool.origin(false);
  exclusiveCloudRecord(`.repolab/cloud-runtime-v1/server-ready-${Date.now()}-${process.pid}.json`,{
    status:'READY_MANUAL_CLOUD_RUNTIME',port,id:pool.inspect().id,sourceFreezeSha256:expected,baseRuntimeSha256:'75a853e5be44334449705554f734478d045972670419ab487d8289c0722cac10',
    overallRunQuota:null,overallSpendingCap:null,manualStartsOnly:true,
    inference:'none on startup',execution:'Loopback runtime only; every actual repair needs a new explicit authenticated POST'});
  console.log('Cloud runtime ready on loopback 4191; repairs start only through authenticated user actions.');
  let closing=false;const stop=()=>{if(closing)return;closing=true;void service.close().finally(()=>{store.close();process.exit(0);});};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  }
}catch{
  console.error('Cloud runtime stopped; inspect private source/evidence/accounting before restart. No automatic retry.');
  if(service)await service.close();if(store)store.close();process.exitCode=1;
}
