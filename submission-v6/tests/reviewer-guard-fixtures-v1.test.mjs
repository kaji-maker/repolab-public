// Synthetic, temporary guard files only. No production leases or provider calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

for(const [moduleName,fnName,preparation] of [
  ['prospective-preact-3567-v1.ts','currentCleanupBlocker','prospective-preact-3567-v1-preparation'],
  ['prospective-vue-11870-v1.ts','currentExecutionBlocker','prospective-vue-11870-v1-preparation'],
  ['prospective-vue-11915-v1.ts','currentTextareaBlocker','prospective-vue-11915-v1-preparation'],
]) test('synthetic unchanged, missing and changed records deny '+fnName,()=>{
  const root=mkdtempSync(join(tmpdir(),'repolab-review-guard-'));
  try{
    const moduleUrl=pathToFileURL(resolve('packages/evaluation',moduleName)).href;
    const program=`
      import fs from 'node:fs'; import assert from 'node:assert/strict';
      import {createHash} from 'node:crypto';
      const mod=await import(${JSON.stringify(moduleUrl)}), blocker=mod[${JSON.stringify(fnName)}];
      const paths=['.repolab/clsx-repair.lock','.repolab/repositories/clsx-repair.lock','.repolab/test-record.json'];
      const bytes=Buffer.from('reviewed synthetic guard fixture');
      const hash=createHash('sha256').update(bytes).digest('hex');
      for(const path of paths){fs.mkdirSync(path.slice(0,path.lastIndexOf('/')),{recursive:true});fs.writeFileSync(path,bytes);}
      const prep='.repolab/'+${JSON.stringify(preparation)};
      fs.mkdirSync(prep,{recursive:true});
      fs.writeFileSync(prep+'/execution-blocker.json',JSON.stringify({files:paths.map(path=>({path,sha256:hash}))}));
      let result=blocker();assert.equal(result.status,'UNCHANGED_UNKNOWN_SUBMISSION');
      assert.equal(result.executionAdmission,false);assert.equal(result.bothSharedLeasesPresent,true);
      fs.unlinkSync(paths[0]);result=blocker();assert.equal(result.status,'STATE_CHANGED_REVIEW_REQUIRED');
      assert.equal(result.executionAdmission,false);assert.equal(result.bothSharedLeasesPresent,false);
      fs.writeFileSync(paths[0],bytes);fs.writeFileSync(paths[2],'altered fixture');
      result=blocker();assert.equal(result.status,'STATE_CHANGED_REVIEW_REQUIRED');
      assert.equal(result.executionAdmission,false);assert.equal(result.bothSharedLeasesPresent,true);
    `;
    const result=spawnSync(process.execPath,['--input-type=module','-e',program],{
      cwd:root,env:{PATH:process.env.PATH??'/usr/bin:/bin'},encoding:'utf8',timeout:30000,
    });
    assert.equal(result.status,0,result.stderr);
  }finally{rmSync(root,{recursive:true,force:true});}
});
