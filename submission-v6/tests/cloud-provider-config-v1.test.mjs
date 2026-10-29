import test from 'node:test';
import assert from 'node:assert/strict';
import { selectProviderEnvironment,credentialFreeChildEnvironment,PROVIDER_FIELDS } from '../packages/repositories/cloud-provider-config-v1.mjs';
const fake={NEBIUS_API_KEY:'reviewed-fixture-api-'+ 'x'.repeat(24),NEBIUS_PROJECT_ID:'reviewed-fixture-project'};
test('closed provider selection excludes unrelated credentials and adds no overall quota',()=>{
  const selected=selectProviderEnvironment({...fake,AWS_SECRET_ACCESS_KEY:'fixture-not-forwarded',REPOLAB_RUN_BUDGET_USD:'999'},true);
  assert.deepEqual(Object.keys(selected).sort(),[...PROVIDER_FIELDS].sort());
  assert.equal(selected.NEBIUS_SANDBOX_TOKEN,fake.NEBIUS_API_KEY);assert.equal(selected.REPOLAB_RUN_BUDGET_USD,undefined);
});
test('current owner coverage required',()=>{assert.throws(()=>selectProviderEnvironment(fake,false));});
test('recipient and field injection rejected',()=>{
  for(const change of [{NEBIUS_API_KEY:'fixture\nINJECT=bad'},{NEBIUS_BASE_URL:'https://attacker.invalid/'},{NEBIUS_PROJECT_ID:'bad\r\nHeader: bad'},{NEBIUS_MODEL:'unqualified'},{NEBIUS_INPUT_USD_PER_MILLION:'1'}])
    assert.throws(()=>selectProviderEnvironment({...fake,...change},true));
});
test('transport subprocess never inherits provider secrets',()=>{
  const child=credentialFreeChildEnvironment({...fake,PATH:'/reviewed/bin',CLOUDSDK_CONFIG:'/reviewed/gcloud',AWS_SECRET_ACCESS_KEY:'fixture-never-forward'});
  assert.equal(child.NEBIUS_API_KEY,undefined);assert.equal(child.AWS_SECRET_ACCESS_KEY,undefined);assert.equal(child.PATH,'/reviewed/bin');
});
