import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {dependencyTree,verifyDependencyFreeze} from '../packages/repositories/cloud-dependency-proof-v2.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const assets=['apps/api/cloud-live-server-v2.mjs','packages/repositories/cloud-dependency-proof-v2.mjs',
  'deployment/cloud-dependency-v2/package.json','deployment/cloud-dependency-v2/package-lock.json'];
function fixture(fn){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'repolab-dependency-fixture-'));
  try{
    for(const name of [...assets,'node_modules/example/index.js']){
      const p=path.join(root,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,'reviewed fixture');
    }
    fs.mkdirSync(path.join(root,'node_modules/.bin'));fs.symlinkSync('../example/index.js',path.join(root,'node_modules/.bin/example'));
    const manifest={format:'repolab-cloud-dependency-freeze/v2',baseRuntimeSha256:'75a853e5be44334449705554f734478d045972670419ab487d8289c0722cac10',
      assets:Object.fromEntries(assets.map(name=>[name,sha(fs.readFileSync(path.join(root,name)))])),modules:dependencyTree(path.join(root,'node_modules'))};
    const raw=Buffer.from(JSON.stringify(manifest));fs.writeFileSync(path.join(root,'deployment/cloud-dependency-v2/freeze.json'),raw);
    fn(root,sha(raw));
  }finally{fs.rmSync(root,{recursive:true,force:true});}
}
test('reviewed dependency tree and internal symlinks pass',()=>fixture((root,hash)=>{
  assert.equal(verifyDependencyFreeze(hash,root).entries,4);
}));
test('modified or missing dependency and added file reject',()=>fixture((root,hash)=>{
  const p=path.join(root,'node_modules/example/index.js'),original=fs.readFileSync(p);
  fs.writeFileSync(p,'changed');assert.throws(()=>verifyDependencyFreeze(hash,root));
  fs.writeFileSync(p,original);fs.writeFileSync(path.join(root,'node_modules/extra'),'extra');assert.throws(()=>verifyDependencyFreeze(hash,root));
  fs.unlinkSync(path.join(root,'node_modules/extra'));fs.unlinkSync(p);assert.throws(()=>verifyDependencyFreeze(hash,root));
}));
test('changed authority, control file and external symlink reject',()=>fixture((root,hash)=>{
  assert.throws(()=>verifyDependencyFreeze('0'.repeat(64),root));
  const p=path.join(root,assets[0]),original=fs.readFileSync(p);fs.writeFileSync(p,'changed');assert.throws(()=>verifyDependencyFreeze(hash,root));
  fs.writeFileSync(p,original);fs.symlinkSync('/etc/passwd',path.join(root,'node_modules/escape'));assert.throws(()=>verifyDependencyFreeze(hash,root));
}));
