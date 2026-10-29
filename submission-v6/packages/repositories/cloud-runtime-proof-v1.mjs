import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { cloudRuntimePolicy } from './cloud-runtime-policy-v1.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function regular(name){
  if(!name||name.startsWith('/')||name.split('/').some(p=>!p||p==='..'||p==='.'||p.startsWith('.env')))throw Error('Unsafe runtime asset');
  let cursor='.';for(const part of name.split('/')){cursor+='/'+part;if(fs.lstatSync(cursor).isSymbolicLink())throw Error('Runtime symlink refused');}
  const stat=fs.lstatSync(name);if(!stat.isFile()||stat.size>16_000_000)throw Error('Invalid runtime asset');
  return fs.readFileSync(name);
}
export function validateCloudRuntimePins(freeze,snapshot,reader=regular){
  if(freeze.format!=='repolab-cloud-runtime-source-freeze/v1'||!isDeepStrictEqual(freeze.policy,cloudRuntimePolicy)||
    freeze.engineFreeze!=='2096c16f472d93957f5e4efc78b55e880d7261ae537d072dcef28748b20bff7a'||
    freeze.workbenchFreeze!=='520dfb352f7e42db88d0f25e6e343cb8655dcf0c690af4926a22712ab7640a7e'||
    freeze.snapshotManifestSha256!=='e8305a7c91ec9c04438e13a0e9ec3fe264457dbc3b97cd7dfc5ed72d8c01e4b6')throw Error('Qualified runtime identity changed');
  for(const [name,hash] of Object.entries(snapshot.files))if(freeze.files[name]!==hash)throw Error('Original deployment asset omitted or changed');
  for(const [name,hash] of Object.entries(freeze.files)){
    if(!name||name.startsWith('/')||name.split('/').some(p=>!p||p==='..'||p==='.'||p.startsWith('.env')))throw Error('Unsafe runtime asset');
    if(sha(reader(name))!==hash)throw Error('Runtime asset changed');
  }
  return freeze;
}
export function verifyCloudRuntime(expected,path='.repolab/cloud-runtime-v1/source-freeze.json'){
  const bytes=regular(path);if(sha(bytes)!==expected)throw Error('Runtime authority changed');
  const snapshot=fs.readFileSync('/srv/repolab/backend-v1.snapshot.json');
  if(sha(snapshot)!=='e8305a7c91ec9c04438e13a0e9ec3fe264457dbc3b97cd7dfc5ed72d8c01e4b6')throw Error('Original deployment manifest changed');
  return validateCloudRuntimePins(JSON.parse(bytes),JSON.parse(snapshot));
}
