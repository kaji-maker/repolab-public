import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateCloudRuntimePins} from '../packages/repositories/cloud-runtime-proof-v1.mjs';
import {cloudRuntimePolicy} from '../packages/repositories/cloud-runtime-policy-v1.mjs';
const bytes=Buffer.from('Reviewed controller metadata fixture; never executed');
const hash=createHash('sha256').update(bytes).digest('hex');
function frozen(){return {format:'repolab-cloud-runtime-source-freeze/v1',policy:structuredClone(cloudRuntimePolicy),
  engineFreeze:'2096c16f472d93957f5e4efc78b55e880d7261ae537d072dcef28748b20bff7a',
  workbenchFreeze:'520dfb352f7e42db88d0f25e6e343cb8655dcf0c690af4926a22712ab7640a7e',
  snapshotManifestSha256:'e8305a7c91ec9c04438e13a0e9ec3fe264457dbc3b97cd7dfc5ed72d8c01e4b6',files:{'packages/fixture.mjs':hash}};}
const snapshot={files:{'packages/fixture.mjs':hash}};
test('complete original deployment pins and unlimited-manual policy pass',()=>{assert.equal(validateCloudRuntimePins(frozen(),snapshot,()=>bytes).policy.overallRunQuota,null);});
test('omitted original asset and altered bytes reject',()=>{
  const f=frozen();delete f.files['packages/fixture.mjs'];assert.throws(()=>validateCloudRuntimePins(f,snapshot,()=>bytes));
  assert.throws(()=>validateCloudRuntimePins(frozen(),snapshot,()=>Buffer.from('changed reviewed fixture')));
});
test('automatic dispatch, global quota and changed engine identity reject',()=>{
  for(const mutate of [f=>f.policy.automaticRepairStart=true,f=>f.policy.overallRunQuota=1,f=>f.engineFreeze='0'.repeat(64)]){
    const f=frozen();mutate(f);assert.throws(()=>validateCloudRuntimePins(f,snapshot,()=>bytes));
  }
});
test('credential and traversal paths reject before reading',()=>{
  for(const name of ['.env','../private','/etc/repolab/nebius-provider-v1.env']){
    const f=frozen();f.files[name]=hash;let reads=0;assert.throws(()=>validateCloudRuntimePins(f,snapshot,n=>{if(n===name)reads++;return bytes;}));assert.equal(reads,0);
  }
});
