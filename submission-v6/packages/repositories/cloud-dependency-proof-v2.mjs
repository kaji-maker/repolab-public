// Bind the complete installed dependency tree and the additive runtime files.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const base='75a853e5be44334449705554f734478d045972670419ab487d8289c0722cac10';
const required=['apps/api/cloud-live-server-v2.mjs','packages/repositories/cloud-dependency-proof-v2.mjs',
  'deployment/cloud-dependency-v2/package.json','deployment/cloud-dependency-v2/package-lock.json'];
function regular(root,name){
  if(!name||path.isAbsolute(name)||name.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('Unsafe dependency asset');
  let cursor=root;for(const part of name.split('/')){cursor=path.join(cursor,part);if(fs.lstatSync(cursor).isSymbolicLink())throw Error('Dependency asset symlink refused');}
  if(!fs.lstatSync(cursor).isFile())throw Error('Dependency asset must be a file');
  return fs.readFileSync(cursor);
}
export function dependencyTree(root){
  root=path.resolve(root);if(fs.realpathSync(root)!==root)throw Error('Real dependency root required');
  const entries={};
  function walk(relative=''){
    for(const entry of fs.readdirSync(path.join(root,relative),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
      const name=relative?relative+'/'+entry.name:entry.name,full=path.join(root,name);
      if(entry.isSymbolicLink()){
        const target=fs.readlinkSync(full),resolved=path.resolve(path.dirname(full),target);
        if(path.isAbsolute(target)||!resolved.startsWith(root+path.sep)||!fs.existsSync(full))throw Error('Unsafe dependency symlink');
        entries[name]={type:'symlink',target};
      }else if(entry.isDirectory()){entries[name]={type:'directory'};walk(name);}
      else if(entry.isFile()){const bytes=fs.readFileSync(full);entries[name]={type:'file',bytes:bytes.length,sha256:sha(bytes)};}
      else throw Error('Unexpected dependency entry');
    }
  }
  walk();return entries;
}
export function verifyDependencyFreeze(expected,root=process.cwd(),manifestPath='deployment/cloud-dependency-v2/freeze.json'){
  root=path.resolve(root);if(fs.realpathSync(root)!==root||!/^[a-f0-9]{64}$/.test(expected??''))throw Error('Dependency authority required');
  const raw=regular(root,manifestPath);if(sha(raw)!==expected)throw Error('Dependency freeze changed');
  const manifest=JSON.parse(raw);
  if(manifest.format!=='repolab-cloud-dependency-freeze/v2'||manifest.baseRuntimeSha256!==base||
    !isDeepStrictEqual(Object.keys(manifest.assets).sort(),[...required].sort()))throw Error('Dependency envelope changed');
  for(const name of required)if(sha(regular(root,name))!==manifest.assets[name])throw Error('Dependency control changed');
  if(!isDeepStrictEqual(dependencyTree(path.join(root,'node_modules')),manifest.modules))throw Error('Dependency tree changed');
  return {baseRuntimeSha256:base,dependencyFreezeSha256:expected,entries:Object.keys(manifest.modules).length};
}
