// Backend-only read-only provider discovery. Never submits models, uploads or instances.
export const PROTECTED_IMAGE='d4c8d3fb-7f4c-48dc-9c81-0522eb247051';
export class PreflightStopped extends Error {
  constructor(stage,status=null){super('Provider preflight stopped');this.stage=stage;this.httpStatus=status;}
}
export async function checkProviderAccess(environment, fetcher=fetch) {
  async function get(stage,url,headers){
    let response;
    try{response=await fetcher(url,{method:'GET',headers,redirect:'error',signal:AbortSignal.timeout(20000)});}
    catch{throw new PreflightStopped(stage);}
    if(!response.ok)throw new PreflightStopped(stage,response.status);
    let text='';
    try{
      const reader=response.body.getReader();const decoder=new TextDecoder();let size=0;
      for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2_000_000){await reader.cancel();throw Error();}text+=decoder.decode(value,{stream:true});}
      text+=decoder.decode();return JSON.parse(text);
    }catch{throw new PreflightStopped(stage);}
  }
  const models=await get('model-catalog','https://api.tokenfactory.nebius.com/v1/models?verbose=true',{Authorization:'Bearer '+environment.NEBIUS_API_KEY});
  const model=models?.data?.find(m=>m.id===environment.NEBIUS_MODEL);
  if(!model)throw new PreflightStopped('required-model-absent');
  const input=Number(model.pricing?.prompt)*1_000_000,output=Number(model.pricing?.completion)*1_000_000;
  if(!Number.isFinite(input)||!Number.isFinite(output)||Math.abs(input-0.3)>1e-9||Math.abs(output-0.9)>1e-9)
    throw new PreflightStopped('qualified-pricing-mismatch');
  const headers={Authorization:'Bearer '+environment.NEBIUS_SANDBOX_TOKEN,Project:environment.NEBIUS_PROJECT_ID};
  const auth=await get('sandbox-token','https://api.tokenfactory.nebius.com/sandboxes/v1/whoami',headers);
  if(!auth.permissions||['spawn','spawn_disposable','cancel'].some(p=>auth.permissions[p]!==true))throw new PreflightStopped('sandbox-permissions');
  if(auth.token_expiration!==null&&(!Number.isFinite(auth.token_expiration)||auth.token_expiration*1000<=Date.now()+120000))
    throw new PreflightStopped('sandbox-token-expired-or-expiring');
  const image=await get('protected-image','https://api.tokenfactory.nebius.com/sandboxes/v1/inspect/'+PROTECTED_IMAGE+'/',headers);
  if(!image||typeof image!=='object'||Array.isArray(image))throw new PreflightStopped('image-metadata-invalid');
  const report={status:'PASS_READ_ONLY_PROVIDER_ACCESS',checkedAt:new Date().toISOString(),
    model:environment.NEBIUS_MODEL,ratesUsdPerMillion:{input:0.3,output:0.9},
    sandboxTokenExpiresAt:auth.token_expiration,sandboxCanSpawn:true,sandboxCanCancel:true,
    protectedImage:PROTECTED_IMAGE,protectedImageAccessible:true,imageMetadataFields:Object.keys(image).slice(0,40),
    ownerCoverageConfirmed:environment.NEBIUS_SANDBOX_COVERAGE_CONFIRMED==='true',balanceAndExpiryIndependentlyVerified:false,
    modelRequests:0,sandboxOperations:0,readOnlyRequests:3,inference:'none',
    execution:'Authenticated GET catalog/token/image metadata only; no model completion, upload, image mutation or instance execution'};
  if([environment.NEBIUS_API_KEY,environment.NEBIUS_SANDBOX_TOKEN].some(s=>JSON.stringify(report).includes(s)))throw new PreflightStopped('credential-reflection');
  return report;
}
