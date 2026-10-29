// Unlimited sequential user-started repairs; each uses a fresh durable capability.
// The original qualified API/engine and its per-repair safety bounds are unchanged.
import fs from 'node:fs';
import { join,resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
const terminal=new Set(['ACCEPTED_INDEPENDENTLY_CORRECT','ACCEPTED_INDEPENDENTLY_INCORRECT','ABSTAINED']);
export function exclusiveCloudRecord(path,value){
  const fd=fs.openSync(path,'wx',0o600);
  try{fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  const dir=fs.openSync(resolve(path,'..'),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
}
export function createCloudRunPool({root,store,history,createServer,readiness,execute,proof,preflight,queueView,sourceIdentity='reviewed-controller-fixture'}){
  root=resolve(root);fs.mkdirSync(root,{recursive:true,mode:0o700});
  if(fs.realpathSync(root)!==root)throw Error('Real private runtime directory required');
  const runs=join(root,'runs');fs.mkdirSync(runs,{recursive:true,mode:0o700});
  let current=null,opening=null,closing=false,hold=false,checkedPrevious=false;const completedClaims=[];
  for(const entry of fs.readdirSync(runs,{withFileTypes:true})){
    if(!entry.isDirectory()||entry.isSymbolicLink()||! /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(entry.name)){hold=true;continue;}
    const dir=join(runs,entry.name);
    try{
      for(const name of ['STARTED.json','COMPLETED.json']){const stat=fs.lstatSync(join(dir,name));if(!stat.isFile()||stat.isSymbolicLink()||stat.size>2_000_000)throw Error();}
      const started=JSON.parse(fs.readFileSync(join(dir,'STARTED.json'))),completed=JSON.parse(fs.readFileSync(join(dir,'COMPLETED.json')));
      if(started.id!==entry.name||completed.id!==entry.name||!terminal.has(completed.status)||completed.executionUncertain!==false)hold=true;
      else completedClaims.push(completed);
    }catch{hold=true;}
  }
  function available(slot){
    if(closing||hold||slot.failed)return {available:false,reason:'A saved workflow or provider preflight needs operator review. No automatic retry.'};
    if(slot.started||slot.busy)return {available:false,reason:'This workflow is active or consumed. Saved results remain available.'};
    return readiness();
  }
  function stop(slot){
    slot.failed=true;slot.busy=false;hold=true;
    const path=join(slot.directory,'STOPPED.json');
    try{if(fs.existsSync(slot.directory)&&!fs.existsSync(path))exclusiveCloudRecord(path,{id:slot.id,status:'STOPPED',at:new Date().toISOString(),
      message:'Workflow stopped; inspect private evidence and accounting before any further dispatch.',
      inference:'Inspect actual engine journal and ledger; zero is not assumed',execution:'Claim retained; no automatic retry or resume'});}catch{}
  }
  async function make(){
    const slot={id:randomUUID(),started:false,busy:false,finished:false,failed:false,startedAt:null,service:null,origin:null};
    slot.directory=join(runs,slot.id);
    const slotHistory={
      list:async()=>{const records=await history.list();if(slot.started&&!records.some(r=>r.id===slot.id))return [queueView(slot.id,slot.startedAt,slot.failed?'Admission stopped; no automatic retry.':null),...records];return records;},
      get:async id=>await history.get(id)??(id===slot.id&&slot.started?queueView(slot.id,slot.startedAt,slot.failed?'Admission stopped; no automatic retry.':null):null),
      patch:id=>history.patch(id),
    };
    const admission={id:slot.id,readiness:()=>available(slot),consume:async()=>{
      if(slot.started||hold||closing)throw Error('Consumed or held capability');
      fs.mkdirSync(slot.directory,{mode:0o700});slot.started=true;slot.busy=true;slot.startedAt=new Date().toISOString();
      try{
        exclusiveCloudRecord(join(slot.directory,'STARTED.json'),{format:'repolab-cloud-workflow-claim/v1',id:slot.id,at:slot.startedAt,controllerPid:process.pid,sourceFreezeSha256:sourceIdentity,
          inference:'none yet',execution:'Fresh durable capability claimed before preflight or engine dispatch'});
        proof();const ready=readiness();if(!ready.available)throw Error('Readiness changed');
        const report=await preflight();
        if(report.status!=='PASS_READ_ONLY_PROVIDER_ACCESS')throw Error('Current provider access required');
        exclusiveCloudRecord(join(slot.directory,'provider-preflight.json'),report);
        proof();if(!readiness().available)throw Error('Readiness changed');
      }catch(error){stop(slot);throw error;}
    }};
    slot.service=createServer(store,0,{admission,history:slotHistory,execute:async(options={})=>{
      try{
        if(!slot.started||slot.failed||options.id!==slot.id||options.entrypoint!=='api'||Object.keys(options).some(k=>!['id','entrypoint','signal'].includes(k)))
          throw Error('Closed production execution options required');
        const result=await execute(options),record=await history.get(slot.id);
        if(!record||record.simulated||record.active||record.executionUncertain||!record.usageComplete||!terminal.has(record.status))throw Error('Terminal audited evidence required');
        if(record.status==='ACCEPTED_INDEPENDENTLY_CORRECT'&&!record.verified)throw Error('Verified result required');
        proof();
        exclusiveCloudRecord(join(slot.directory,'COMPLETED.json'),{id:slot.id,status:record.status,verified:record.verified,sourceFreezeSha256:sourceIdentity,
          executionUncertain:false,at:new Date().toISOString(),inferenceCalls:record.inferenceCalls,executionCount:record.executionCount,
          inference:'Actual inference provenance is retained in the raw journal',execution:'Terminal raw evidence audited; no automatic next dispatch'});
        slot.finished=true;slot.busy=false;return result;
      }catch(error){stop(slot);throw error;}
    }});
    slot.origin='http://127.0.0.1:'+await slot.service.start();return slot;
  }
  async function origin(rotate=false){
    if(closing)throw Error('Runtime closing');
    if(opening)return opening;
    opening=(async()=>{
      if(!checkedPrevious){checkedPrevious=true;for(const completed of completedClaims){try{
        const record=await history.get(completed.id);
        if(!record||record.simulated||record.active||record.executionUncertain||!record.usageComplete||record.status!==completed.status||record.verified!==completed.verified)hold=true;
      }catch{hold=true;}}}
      // Rotation is permitted only by a catalog GET after a completed workflow.
      // Repeated/delayed mutation requests cannot themselves restore a capability.
      if(!current)current=await make();
      else if(rotate&&current.finished&&!current.busy&&!hold){await current.service.close();current=await make();}
      return current.origin;
    })();
    try{return await opening;}finally{opening=null;}
  }
  return {origin,inspect:()=>({id:current?.id??null,busy:!!current?.busy,held:hold,started:!!current?.started,finished:!!current?.finished}),
    close:async()=>{closing=true;if(opening)await opening;if(current)await current.service.close();}};
}
