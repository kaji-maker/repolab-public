import {createServer} from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash,timingSafeEqual} from 'node:crypto';

const API='/api/native-preact-repairs-v4';
export const EXPECTED_ORIGIN='https://repolab.34-71-102-74.sslip.io';
const UUID='[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}';
const READ=new RegExp(`^${API}(?:/${UUID}(?:/patch)?)?$`);
const WRITE=new RegExp(`^${API}(?:/${UUID}/(?:cancel|recover))?$`);
const security={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cross-Origin-Resource-Policy':'same-origin',
  'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'"};
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
function reply(res,status,bytes,type='application/json; charset=utf-8',extra={}){
  res.writeHead(status,{...security,'Content-Type':type,'Content-Length':Buffer.byteLength(bytes),...extra});res.end(bytes);
}
function fail(res,status,message){reply(res,status,JSON.stringify({error:message}));}
export function upstreamRequest(origin,authorization,method,route,body){
  return new Promise((ok,reject)=>{
    const headers={Authorization:authorization,Origin:origin,'Sec-Fetch-Site':'same-origin',Accept:'application/json'};
    if(body){headers['Content-Type']='application/json';headers['Content-Length']=body.length;}
    const request=https.request(new URL(route,origin),{method,headers,timeout:120000,signal:AbortSignal.timeout(120000),rejectUnauthorized:true,minVersion:'TLSv1.2'},response=>{
      const chunks=[];let size=0;
      response.on('data',chunk=>{size+=chunk.length;if(size>8_000_000){response.destroy();reject(Error('Bound'));}else chunks.push(chunk);});
      response.on('error',reject);
      response.on('end',()=>ok({status:response.statusCode??502,type:response.headers['content-type'],bytes:Buffer.concat(chunks)}));
    });
    request.on('timeout',()=>request.destroy(Error('Timeout')));request.on('error',reject);request.end(body);
  });
}

/** A source-built browser client connected to the owner's existing qualified API. */
export function createJudgeClient({access,webRoot,port=4189,request=upstreamRequest,expectedOrigin=EXPECTED_ORIGIN}){
  const upstream=new URL(access.url);
  if(upstream.protocol!=='https:'||upstream.origin!==expectedOrigin||upstream.origin!==access.url||upstream.username||upstream.password||
    typeof access.username!=='string'||!/^[A-Za-z0-9._-]{1,64}$/.test(access.username)||typeof access.password!=='string'||
    access.password.length<32||access.password.length>256||/[\r\n]/.test(access.password))throw Error('Invalid judge access configuration');
  if(!Number.isInteger(port)||port<0||port>65535)throw Error('Invalid local port');
  const root=fs.realpathSync(webRoot),authorization='Basic '+Buffer.from(access.username+':'+access.password).toString('base64');
  const digest=value=>createHash('sha256').update(value).digest(),authDigest=digest(authorization);
  let localOrigin,mutationPending=false,mutationUncertain=false,activeRequests=0;
  const server=createServer(async(req,res)=>{
    const route=req.url??'',method=req.method??'GET';
    if(req.headers.host!==new URL(localOrigin).host){fail(res,403,'Local host required');return;}
    if(!timingSafeEqual(digest(req.headers.authorization??''),authDigest)){
      reply(res,401,JSON.stringify({error:'Judge login required'}),'application/json',{'WWW-Authenticate':'Basic realm="ReproLab local judge"'});return;
    }
    if(req.headers.origin&&req.headers.origin!==localOrigin||req.headers['sec-fetch-site']&&!['same-origin','none'].includes(req.headers['sec-fetch-site'])){
      fail(res,403,'Same-origin request required');return;
    }
    if(route.length>2048||route.includes('%')||route.includes('?')||route.includes('#')){fail(res,404,'Route unavailable');return;}
    if(route.startsWith('/api/')){
      if(!(method==='GET'&&READ.test(route)||method==='POST'&&WRITE.test(route))){fail(res,404,'Route unavailable');return;}
      let body;
      if(method==='POST'){
        if(req.headers.origin!==localOrigin){fail(res,403,'Same-origin request required');return;}
        if(req.headers['content-type']?.split(';')[0]!=='application/json'){fail(res,415,'JSON required');return;}
        const chunks=[];let size=0;
        try{for await(const chunk of req){size+=chunk.length;if(size>16000){fail(res,413,'Request too large');return;}chunks.push(chunk);}}
        catch{fail(res,400,'Request unavailable');return;}
        body=Buffer.concat(chunks);
        try{const value=JSON.parse(body);if(!value||Array.isArray(value)||typeof value!=='object'||Object.keys(value).length)throw Error();}
        catch{fail(res,400,'Run overrides are unavailable');return;}
        body=Buffer.from('{}');
      }
      if(activeRequests>=8){fail(res,429,'Local request limit reached');return;}
      if(method==='POST'&&(mutationPending||mutationUncertain&&route===API)){fail(res,409,'A mutation is pending or uncertain; inspect saved history before another action');return;}
      activeRequests++;if(method==='POST')mutationPending=true;
      try{
        // One request only. In particular, uncertain mutations are never retried.
        const response=await request(upstream.origin,authorization,method,route,body);
        if(!Number.isInteger(response.status)||response.status<200||response.status>599||response.status>=300&&response.status<400||
          !Buffer.isBuffer(response.bytes)||response.bytes.length>8_000_000||
          [access.password,authorization,authorization.slice(6),encodeURIComponent(access.password),Buffer.from(access.password).toString('base64'),JSON.stringify(access.password).slice(1,-1)].some(value=>response.bytes.includes(Buffer.from(value))))throw Error('Response refused');
        if(method==='POST'&&![200,201,202,204,400,401,403,404,409,413,415,422,429].includes(response.status)){
          mutationUncertain=true;fail(res,502,'Mutation outcome unknown; inspect saved history before another action. Request was not retried');return;
        }
        const type=route.endsWith('/patch')?'text/plain; charset=utf-8':'application/json; charset=utf-8';
        const extra=route.endsWith('/patch')&&response.status===200?{'Content-Disposition':`attachment; filename="preact-${route.split('/').at(-2)}.patch"`}:{};
        reply(res,response.status,response.bytes,type,extra);
      }catch{if(method==='POST')mutationUncertain=true;if(!res.headersSent&&!res.destroyed)fail(res,502,method==='POST'?'Mutation outcome unknown; inspect saved history before another action. Request was not retried':'Hosted API unavailable; request was not retried');}
      finally{activeRequests--;if(method==='POST')mutationPending=false;}
      return;
    }
    if(method!=='GET'){fail(res,405,'GET required');return;}
    const name=route==='/'?'native-repair-v9.html':route.slice(1);
    if(!/^(?:native-repair-v9\.html|mark\.svg|assets\/[A-Za-z0-9_-]+\.(?:js|css))$/.test(name)){fail(res,404,'Route unavailable');return;}
    try{
      const target=path.join(root,name),real=fs.realpathSync(target);
      if(!real.startsWith(root+path.sep)||real!==target||!fs.statSync(real).isFile()||fs.statSync(real).size>8_000_000)throw Error();
      reply(res,200,fs.readFileSync(real),mime[path.extname(real)]);
    }catch{fail(res,404,'Asset unavailable; run npm run build:judge');}
  });
  server.requestTimeout=15000;server.headersTimeout=10000;server.maxHeadersCount=50;
  return {server,start:()=>new Promise((ok,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{
    server.removeListener('error',reject);
    localOrigin='http://127.0.0.1:'+server.address().port;ok(localOrigin);
  });}),close:()=>new Promise(ok=>{server.closeAllConnections();server.close(ok);})};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  let stage='environment';
  try{
    if(Object.keys(process.env).some(key=>/^(?:NEBIUS_|OPENAI_API_KEY|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN|NODE_OPTIONS$|NODE_PATH$|NODE_TLS_REJECT_UNAUTHORIZED$|NODE_EXTRA_CA_CERTS$|SSL_CERT_FILE$|SSL_CERT_DIR$|OPENSSL_CONF$|NODE_USE_SYSTEM_CA$|NODE_USE_ENV_PROXY$)/.test(key))||process.execArgv.some(arg=>/^--(?:import|require|loader|experimental-loader|use-openssl-ca|use-system-ca)(?:=|$)/.test(arg)))throw Error('Provider or unsafe TLS/loader environment refused');
    stage='access-file';
    const filename=process.env.REPOLAB_JUDGE_ACCESS_FILE;if(!filename)throw Error('Judge access file required');
    const fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);let access;
    try{const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.size>4096||(stat.mode&0o077)||typeof process.getuid==='function'&&stat.uid!==process.getuid())throw Error('Private owned mode-0600 access file required');access=JSON.parse(fs.readFileSync(fd,'utf8'));}finally{fs.closeSync(fd);}
    stage='web-build';
    const webRoot=process.env.REPOLAB_JUDGE_WEB_ROOT??fileURLToPath(new URL('../../dist/web-judge/',import.meta.url));
    if(!fs.statSync(path.join(webRoot,'native-repair-v9.html')).isFile())throw Error('Build required');
    stage='configuration';
    const client=createJudgeClient({access,webRoot,port:Number(process.env.REPOLAB_JUDGE_PORT??4189)});
    stage='listen';
    console.log('Judge client: '+await client.start());
    console.log('Inference: none on startup. Execution: source-built UI and authenticated transport to the existing hosted repair API.');
    for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>void client.close());
  }catch{console.error(`Judge client refused setup at ${stage}. See JUDGE_SOURCE_SETUP.md for instructions.`);process.exitCode=1;}
}
