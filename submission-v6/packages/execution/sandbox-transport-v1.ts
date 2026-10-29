import type {SandboxConfig} from "./nebius.ts";

const base = "https://api.tokenfactory.nebius.com/sandboxes/";
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const networkCodes = new Set(["ENOTFOUND","EAI_AGAIN","ECONNREFUSED","ECONNRESET","ECONNABORTED","ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT","UND_ERR_HEADERS_TIMEOUT","UND_ERR_BODY_TIMEOUT","UND_ERR_SOCKET",
  "CERT_HAS_EXPIRED","DEPTH_ZERO_SELF_SIGNED_CERT","UNABLE_TO_VERIFY_LEAF_SIGNATURE"]);
const providerCodes = new Set(["INVALID_ARGUMENT","UNAUTHENTICATED","PERMISSION_DENIED","NOT_FOUND","ALREADY_EXISTS",
  "RESOURCE_EXHAUSTED","FAILED_PRECONDITION","ABORTED","OUT_OF_RANGE","UNIMPLEMENTED","INTERNAL","UNAVAILABLE",
  "DATA_LOSS","DEADLINE_EXCEEDED","UNAUTHORIZED","FORBIDDEN","TOO_MANY_REQUESTS"]);
const idHeaders = ["x-request-id","x-nebius-request-id","request-id","x-correlation-id"] as const;
export type SandboxTransportCategory = "success"|"local_validation"|"aborted"|"timeout"|"network_error"|"http_error"|"body_read_error"|"invalid_json"|"body_limit";
export interface SandboxTransportDiagnostic {
  format: "repolab-sandbox-transport-diagnostic/v1";
  method: "GET"|"POST"|"DELETE";
  resource: "instances"|"files"|"operation"|"invalid";
  operationId: string|null;
  attempted: boolean;
  acceptance: "NOT_DISPATCHED"|"UNKNOWN"|"NOT_APPLICABLE";
  category: SandboxTransportCategory;
  httpStatus: number|null;
  providerRequestId: string|null;
  providerRequestIdHeader: typeof idHeaders[number]|null;
  providerCode: string|number|null;
  networkCode: string|null;
  bodyState: "not_read"|"empty"|"json"|"invalid_json"|"read_failed"|"too_large";
  knownOperationId: string|null;
}
export interface SandboxJsonOutcome {ok:boolean;body:unknown;location:string|null;diagnostic:SandboxTransportDiagnostic;}
export interface SandboxJsonRequest {
  route:string;
  method:"GET"|"POST"|"DELETE";
  contentType?:"application/json"|"application/octet-stream";
  body?:BodyInit|null;
}
export function sandboxSecretVariants(config: Pick<SandboxConfig,"token"|"project">) {
  return [...new Set([config.token,config.project].filter(Boolean).flatMap(s=>[
    s,JSON.stringify(s).slice(1,-1),encodeURIComponent(s),encodeURIComponent(s).toLowerCase(),
    encodeURIComponent(encodeURIComponent(s)),Buffer.from(s).toString("base64"),Buffer.from(s).toString("base64url"),
  ]))];
}
export function containsSandboxSecret(text:string, config: Pick<SandboxConfig,"token"|"project">) {
  return sandboxSecretVariants(config).some(s=>text.includes(s));
}
function safeIdentifier(value:string|null,config:SandboxConfig) {
  if(!value || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value) || containsSandboxSecret(value,config))return null;
  return value;
}
function safeNetworkCode(error:unknown,config:SandboxConfig):string|null {
  try {
    for(const candidate of [(error as any)?.code,(error as any)?.cause?.code])
      if(typeof candidate==="string" && networkCodes.has(candidate) && !containsSandboxSecret(candidate,config))return candidate;
  }catch { /* Never serialize an exception or invoke its toString. */ }
  return null;
}
function safeProviderCode(body:unknown,config:SandboxConfig):string|number|null {
  if(!body || typeof body!=="object")return null;
  const value=(body as any).error?.code ?? (body as any).code;
  if(typeof value==="number" && Number.isInteger(value) && value>=0 && value<=16)return value;
  return typeof value==="string" && providerCodes.has(value) && !containsSandboxSecret(value,config)?value:null;
}
export function initialSandboxDiagnostic(request:SandboxJsonRequest):SandboxTransportDiagnostic {
  const operation=request.route.startsWith("operations/")?request.route.slice("operations/".length):null;
  return {format:"repolab-sandbox-transport-diagnostic/v1",method:["GET","POST","DELETE"].includes(request.method)?request.method:"GET",
    resource:request.route==="instances"?"instances":request.route==="files"?"files":operation&&uuid.test(operation)?"operation":"invalid",
    operationId:operation&&uuid.test(operation)?operation:null,attempted:false,acceptance:"NOT_DISPATCHED",category:"local_validation",
    httpStatus:null,providerRequestId:null,providerRequestIdHeader:null,providerCode:null,networkCode:null,bodyState:"not_read",knownOperationId:null};
}
class BodyLimit extends Error {}
class NetworkFailure extends Error {
  readonly code:string|null;
  constructor(code:string|null){super("Network request failed");this.code=code;}
}
function abortable<T>(promise:Promise<T>,signal:AbortSignal):Promise<T> {
  return new Promise((resolve,reject)=>{
    const abort=()=>{signal.removeEventListener("abort",abort);reject(new Error("Transport interrupted"));};
    signal.addEventListener("abort",abort,{once:true});
    promise.then(value=>{signal.removeEventListener("abort",abort);resolve(value);},error=>{signal.removeEventListener("abort",abort);reject(error);});
    if(signal.aborted)abort();
  });
}
async function readBody(response:Response,signal:AbortSignal,limit:number) {
  if(!response.body)return "";
  const reader=response.body.getReader(),parts:Uint8Array[]=[];
  let size=0,complete=false;
  try {
    while(true){
      const next=await abortable(reader.read(),signal);
      if(next.done){complete=true;break;}
      size+=next.value.byteLength;
      if(size>limit)throw new BodyLimit();
      parts.push(next.value);
    }
    return new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(parts));
  }finally{
    if(!complete)void reader.cancel().catch(()=>{});
    reader.releaseLock();
  }
}
/** One bounded HTTP attempt. No retry, filesystem, lease changes, raw error messages or response previews. */
export async function requestSandboxJson(config:SandboxConfig,request:SandboxJsonRequest,callerSignal:AbortSignal,
  fetcher:typeof fetch,timeoutMs=30000):Promise<SandboxJsonOutcome> {
  const d=initialSandboxDiagnostic(request);
  if(d.operationId&&containsSandboxSecret(d.operationId,config)){d.operationId=null;d.resource="invalid";}
  const result=(body:unknown=null,location:string|null=null):SandboxJsonOutcome=>({ok:d.category==="success",body,location,diagnostic:d});
  if(callerSignal.aborted){d.category="aborted";return result();}
  const routeValid=d.resource!=="invalid" && (request.method==="POST"?d.resource!=="operation":d.resource==="operation");
  if(!config.token || !config.project || !config.coverageConfirmed || config.baseUrl!==base || !routeValid ||
    !["GET","POST","DELETE"].includes(request.method) || !Number.isSafeInteger(timeoutMs) || timeoutMs<1 || timeoutMs>30000 ||
    (request.method!=="POST"&&(request.body!=null||request.contentType!==undefined)) ||
    (request.method==="POST"&&(!request.body || request.contentType!==(d.resource==="files"?"application/octet-stream":"application/json"))) ||
    (d.operationId!==null&&containsSandboxSecret(d.operationId,config)))return result();
  const timeout=new AbortController(),timer=setTimeout(()=>timeout.abort(),timeoutMs);
  const signal=AbortSignal.any([callerSignal,timeout.signal]);
  const interrupted=()=>callerSignal.aborted?"aborted" as const:timeout.signal.aborted?"timeout" as const:null;
  let response:Response;
  try{
    d.attempted=true;d.acceptance=request.method==="GET"?"NOT_APPLICABLE":"UNKNOWN";
    try{
      // Preserve only allowlisted network codes; the original thrown object never leaves this scope.
      const pending=Promise.resolve().then(()=>fetcher(new URL("v1/"+request.route,base),{
        method:request.method,body:request.body,redirect:"error",headers:{Authorization:"Bearer "+config.token,Project:config.project,
          ...(request.contentType?{"Content-Type":request.contentType}:{})},signal,
      })).catch(error=>{throw new NetworkFailure(safeNetworkCode(error,config));});
      response=await abortable(pending,signal);
    }catch(error){d.networkCode=error instanceof NetworkFailure?error.code:null;d.category=interrupted()??"network_error";return result();}
    d.httpStatus=response.status;
    for(const name of idHeaders){const id=safeIdentifier(response.headers.get(name),config);if(id){d.providerRequestId=id;d.providerRequestIdHeader=name;break;}}
    let text:string;
    try{text=await readBody(response,signal,response.ok?16*1024*1024:64*1024);}
    catch(error){d.bodyState=error instanceof BodyLimit?"too_large":"read_failed";d.networkCode=safeNetworkCode(error,config);
      d.category=interrupted()??(!response.ok?"http_error":error instanceof BodyLimit?"body_limit":"body_read_error");return result();}
    let body:unknown=null;
    if(text.length){try{body=JSON.parse(text);d.bodyState="json";}catch{d.bodyState="invalid_json";}}
    else d.bodyState="empty";
    if(!response.ok){d.category="http_error";d.providerCode=safeProviderCode(body,config);return result();}
    if(d.bodyState==="invalid_json"){d.category="invalid_json";return result();}
    if(request.method==="POST" && d.resource==="instances" && typeof (body as any)?.uuid==="string" && uuid.test((body as any).uuid) &&
       !containsSandboxSecret((body as any).uuid,config))d.knownOperationId=(body as any).uuid;
    d.category="success";
    return result(body,response.headers.get("Location"));
  }finally{clearTimeout(timer);}
}
export class SandboxTransportError extends Error {
  readonly diagnostic:SandboxTransportDiagnostic;
  constructor(diagnostic:SandboxTransportDiagnostic){
    super("Sandbox transport stopped: "+diagnostic.category+"; no automatic retry");
    this.name="SandboxTransportError";this.diagnostic=structuredClone(diagnostic);
  }
}
export class SandboxTransportJournalError extends SandboxTransportError {
  readonly persistenceFailure:"operation_id_write"|"diagnostic_write";
  constructor(diagnostic:SandboxTransportDiagnostic,failure:"operation_id_write"|"diagnostic_write"){
    super(diagnostic);this.name="SandboxTransportJournalError";
    this.message="Sandbox transport evidence persistence failed; no further dispatch";this.persistenceFailure=failure;
  }
}
