import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {request as httpRequest} from 'node:http';
import {createServer as httpsServer} from 'node:https';
import {execFileSync,spawn} from 'node:child_process';
import {createJudgeClient,upstreamRequest} from '../apps/api/judge-client-v1.mjs';

const API='/api/native-preact-repairs-v4';
const access={url:'https://qualified.example',username:'fixture-judge',password:'synthetic-fixture-only-password-0000000000'};
const authorization='Basic '+Buffer.from(access.username+':'+access.password).toString('base64');
const fetch=(url,init={})=>globalThis.fetch(url,{...init,headers:{Authorization:authorization,...init.headers}});
const raw=(origin,route,headers={})=>new Promise((ok,reject)=>{const url=new URL(origin);const request=httpRequest({hostname:url.hostname,port:url.port,path:route,headers:{Authorization:authorization,...headers}},response=>{response.resume();ok(response.statusCode);});request.on('error',reject);request.end();});
async function fixture(fn,respond=()=>({status:200,bytes:Buffer.from('{"history":[]}')})){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'judge-client-fixture-'));
  fs.writeFileSync(path.join(root,'native-repair-v9.html'),'<!doctype html><p>Fixture UI</p>');
  const calls=[];const client=createJudgeClient({access,webRoot:root,port:0,expectedOrigin:access.url,request:async(...args)=>{calls.push(args);return respond(...args);}});
  const origin=await client.start();
  try{await fn({origin,calls,root});}finally{await client.close();fs.rmSync(root,{recursive:true});}
}
test('fixture: authenticated HTML/API use fixed upstream credentials and filter client headers',async()=>fixture(async({origin,calls})=>{
  const html=await fetch(origin);assert.equal(html.status,200);assert.match(await html.text(),/Fixture UI/);
  assert.equal((await globalThis.fetch(origin+API)).status,401);
  const result=await fetch(origin+API,{headers:{'X-Attacker':'synthetic-attacker',Cookie:'synthetic-cookie'}});assert.equal(result.status,200);
  assert.equal(calls.length,1);assert.equal(calls[0][0],access.url);assert.equal(calls[0][1],'Basic '+Buffer.from(access.username+':'+access.password).toString('base64'));
  assert.equal(calls[0].length,5);assert.equal(result.headers.get('set-cookie'),null);assert.match(result.headers.get('content-security-policy'),/connect-src 'self'/);
}));
test('fixture: foreign origins, hosts, hidden routes and traversal are refused without upstream calls',async()=>fixture(async({origin,calls})=>{
  for(const [route,headers,status] of [[API,{Origin:'https://attacker.example'},403],['/api/private',{},404],['/%2e%2e/secret',{},404],['/assets/../secret',{},404]]){
    assert.equal((await fetch(origin+route,{headers})).status,status);
  }
  assert.equal(await raw(origin,API,{Host:'attacker.example'}),403);
  assert.equal(await raw(origin,'/%2e%2e/secret'),404);
  assert.equal(await raw(origin,'/assets/../secret'),404);
  assert.equal(await raw(origin,API,{'Sec-Fetch-Site':'same-site'}),403);
  assert.equal(calls.length,0);
}));
test('fixture: POST requires same-origin empty JSON and never retries a mutation',async()=>fixture(async({origin,calls})=>{
  assert.equal((await fetch(origin+API,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
  assert.equal((await fetch(origin+API,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{"override":true}'})).status,400);
  assert.equal(calls.length,0);
  const response=await fetch(origin+API,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'});
  assert.equal(response.status,502);assert.equal(calls.length,1);assert.equal(calls[0][4].toString(),'{}');
  assert.match(await response.text(),/outcome unknown/);
  assert.equal((await fetch(origin+API,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'})).status,409);
  assert.equal(calls.length,1);
},()=>{throw Error('Synthetic uncertain response');}));
test('fixture: reflected credentials and redirects are refused',async()=>{
  for(const response of [{status:200,bytes:Buffer.from(access.password)},{status:302,bytes:Buffer.from('{}')}]){
    await fixture(async({origin,calls})=>{assert.equal((await fetch(origin+API)).status,502);assert.equal(calls.length,1);},()=>response);
  }
});
test('fixture: symlinked static content is refused',async()=>fixture(async({origin,root})=>{
  fs.mkdirSync(path.join(root,'assets'));fs.symlinkSync(path.join(root,'native-repair-v9.html'),path.join(root,'assets','linked.js'));
  assert.equal((await fetch(origin+'/assets/linked.js')).status,404);
}));
test('fixture: invalid access configuration is refused',()=>{
  assert.throws(()=>createJudgeClient({access:{...access,url:'http://qualified.example'},webRoot:os.tmpdir()}));
  assert.throws(()=>createJudgeClient({access:{...access,password:'short'},webRoot:os.tmpdir()}));
  assert.throws(()=>createJudgeClient({access:{...access,username:undefined},webRoot:os.tmpdir()}));
});
test('fixture: concurrent mutation is refused while the first is pending',async()=>{
  let release,entered;const barrier=new Promise(ok=>release=ok),started=new Promise(ok=>entered=ok);
  await fixture(async({origin,calls})=>{
    const options={method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{ }'};
    const first=fetch(origin+API,options);await started;
    assert.equal((await fetch(origin+API,options)).status,409);assert.equal(calls.length,1);
    release();assert.equal((await first).status,200);assert.equal(calls[0][4].toString(),'{}');
  },async()=>{entered();await barrier;return{status:200,bytes:Buffer.from('{}')};});
});
test('fixture: admitted cancel/recover and patch identity stay within fixed routes',async()=>fixture(async({origin,calls})=>{
  const id='00000000-0000-4000-8000-000000000000';
  for(const action of ['cancel','recover'])assert.equal((await fetch(origin+API+'/'+id+'/'+action,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'})).status,200);
  const patch=await fetch(origin+API+'/'+id+'/patch');assert.equal(patch.headers.get('content-disposition'),`attachment; filename="preact-${id}.patch"`);
  assert.equal(calls.length,3);
}));
test('fixture: actual HTTPS transport rejects an untrusted self-signed certificate',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'judge-tls-fixture-'));
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(dir,'key.pem'),'-out',path.join(dir,'cert.pem'),'-days','1','-subj','/CN=localhost'],{stdio:'ignore'});
  const server=httpsServer({key:fs.readFileSync(path.join(dir,'key.pem')),cert:fs.readFileSync(path.join(dir,'cert.pem'))},(_,res)=>res.end('{}'));
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
  try{await assert.rejects(upstreamRequest('https://127.0.0.1:'+server.address().port,authorization,'GET',API),error=>/SELF_SIGNED_CERT|UNABLE_TO_VERIFY/.test(error.code??''));}
  finally{server.closeAllConnections();await new Promise(ok=>server.close(ok));fs.rmSync(dir,{recursive:true});}
});
test('fixture: upstream 5xx makes a mutation uncertain and blocks a second start',async()=>fixture(async({origin,calls})=>{
  const options={method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'};
  const first=await fetch(origin+API,options);assert.equal(first.status,502);assert.match(await first.text(),/outcome unknown/);
  assert.equal((await fetch(origin+API,options)).status,409);assert.equal(calls.length,1);
},()=>({status:503,bytes:Buffer.from('{"error":"synthetic gateway unavailable"}')})));
test('fixture: launcher serves built HTML with private judge access and browser auth',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'judge-cli-fixture-')),file=path.join(dir,'access.json');
  fs.writeFileSync(file,JSON.stringify({...access,url:'https://repolab.34-71-102-74.sslip.io'}),{mode:0o600});
  fs.writeFileSync(path.join(dir,'native-repair-v9.html'),'<!doctype html><p>Fixture built UI</p>');
  const child=spawn(process.execPath,[new URL('../apps/api/judge-client-v1.mjs',import.meta.url).pathname],{env:{PATH:process.env.PATH,REPOLAB_JUDGE_ACCESS_FILE:file,REPOLAB_JUDGE_WEB_ROOT:dir,REPOLAB_JUDGE_PORT:'0'},stdio:['ignore','pipe','pipe']});
  const exited=new Promise(ok=>child.once('exit',ok));
  try{
    const origin=await new Promise((ok,reject)=>{const timeout=setTimeout(()=>reject(Error('Fixture launcher timeout')),10000);child.stdout.on('data',bytes=>{const match=/Judge client: (http:\/\/127\.0\.0\.1:\d+)/.exec(bytes.toString());if(match){clearTimeout(timeout);ok(match[1]);}});child.once('error',reject);});
    assert.equal((await globalThis.fetch(origin)).status,401);const response=await fetch(origin);assert.equal(response.status,200);assert.match(await response.text(),/Fixture built UI/);
  }finally{child.kill('SIGTERM');await exited;fs.rmSync(dir,{recursive:true});}
});
test('fixture: unsafe launcher environment, symlink and readable access files refuse',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'judge-launch-fixture-')),file=path.join(dir,'access.json');
  fs.writeFileSync(file,JSON.stringify(access),{mode:0o644});fs.symlinkSync(file,path.join(dir,'link.json'));
  const script=new URL('../apps/api/judge-client-v1.mjs',import.meta.url);
  try{
    for(const env of [{REPOLAB_JUDGE_ACCESS_FILE:file},{REPOLAB_JUDGE_ACCESS_FILE:path.join(dir,'link.json')},{REPOLAB_JUDGE_ACCESS_FILE:file,NODE_TLS_REJECT_UNAUTHORIZED:'0'}]){
      let result;try{execFileSync(process.execPath,[script.pathname],{env:{PATH:process.env.PATH,...env},stdio:'pipe'});}catch(error){result=error;}
      assert.equal(result?.status,1);assert.match(result.stderr.toString(),/refused setup/);
    }
  }finally{fs.rmSync(dir,{recursive:true});}
});
