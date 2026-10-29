import {createServer} from 'node:http';
export function createCloudRuntimeRouter(pool,port){
  let bound=port;
  const server=createServer(async(req,res)=>{
    try{
      if(![`127.0.0.1:${bound}`,`localhost:${bound}`].includes(req.headers.host??'')){res.writeHead(403);res.end();return;}
      const path=req.url??'',method=req.method??'GET';
      if(!path.startsWith('/')||path.startsWith('//')||path.length>2048){res.writeHead(400);res.end();return;}
      const own='http://'+req.headers.host;
      if(req.headers.origin&&req.headers.origin!==own||req.headers['sec-fetch-site']==='cross-site'){res.writeHead(403);res.end();return;}
      let size=0;const chunks=[];
      for await(const chunk of req){size+=chunk.length;if(size>16000){res.writeHead(413);res.end();return;}chunks.push(chunk);}
      const rotate=method==='GET'&&['/api/native-preact-repairs-v4','/api/native-preact-repairs-v4/'].includes(path);
      const origin=await pool.origin(rotate),headers={Origin:origin,'Sec-Fetch-Site':'same-origin'};
      if(req.headers['content-type'])headers['Content-Type']=req.headers['content-type'];
      const response=await fetch(origin+path,{method,headers,redirect:'error',signal:AbortSignal.timeout(120000),
        ...(!['GET','HEAD'].includes(method)?{body:Buffer.concat(chunks)}:{})});
      const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>8_000_000)throw Error();
      const output={};for(const key of ['content-type','content-disposition','content-security-policy','cache-control','x-content-type-options','referrer-policy']){
        const value=response.headers.get(key);if(value)output[key]=value;
      }
      if(![204,304].includes(response.status))output['Content-Length']=bytes.length;
      res.writeHead(response.status,output);res.end(method==='HEAD'?undefined:bytes);
    }catch{if(!res.headersSent){res.writeHead(502,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end('{"error":"Backend unavailable; request was not retried"}');}}
  });
  server.requestTimeout=15000;server.headersTimeout=10000;
  return {start:async()=>{await new Promise((ok,fail)=>{server.once('error',fail);server.listen(port,'127.0.0.1',ok);});bound=server.address().port;return bound;},
    close:async()=>{await pool.close();await new Promise(ok=>server.close(ok));}};
}
