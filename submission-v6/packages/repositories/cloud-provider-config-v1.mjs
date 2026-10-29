// Pure configuration selection. Actual credentials are handled only by backend provisioning.
export const PROVIDER_FIELDS = [
  'NEBIUS_API_KEY','NEBIUS_SANDBOX_TOKEN','NEBIUS_PROJECT_ID','NEBIUS_SANDBOX_IMAGE',
  'NEBIUS_BASE_URL','NEBIUS_SANDBOX_URL','NEBIUS_MODEL',
  'NEBIUS_INPUT_USD_PER_MILLION','NEBIUS_OUTPUT_USD_PER_MILLION','NEBIUS_SANDBOX_COVERAGE_CONFIRMED',
];
export function selectProviderEnvironment(source, ownerCoverage) {
  if(ownerCoverage!==true)throw Error('Current owner coverage confirmation required');
  const environment={
    NEBIUS_API_KEY:source.NEBIUS_API_KEY??'',
    NEBIUS_SANDBOX_TOKEN:source.NEBIUS_SANDBOX_TOKEN||source.NEBIUS_API_KEY||'',
    NEBIUS_PROJECT_ID:source.NEBIUS_PROJECT_ID??'',
    NEBIUS_SANDBOX_IMAGE:source.NEBIUS_SANDBOX_IMAGE??'',
    NEBIUS_BASE_URL:source.NEBIUS_BASE_URL??'https://api.tokenfactory.nebius.com/v1/',
    NEBIUS_SANDBOX_URL:source.NEBIUS_SANDBOX_URL??'https://api.tokenfactory.nebius.com/sandboxes/',
    NEBIUS_MODEL:source.NEBIUS_MODEL??'nvidia/nemotron-3-super-120b-a12b',
    NEBIUS_INPUT_USD_PER_MILLION:String(Number(source.NEBIUS_INPUT_USD_PER_MILLION??0.3)),
    NEBIUS_OUTPUT_USD_PER_MILLION:String(Number(source.NEBIUS_OUTPUT_USD_PER_MILLION??0.9)),
    NEBIUS_SANDBOX_COVERAGE_CONFIRMED:'true',
  };
  for(const name of ['NEBIUS_API_KEY','NEBIUS_SANDBOX_TOKEN'])
    if(!/^[A-Za-z0-9_.~+:/=-]{16,16000}$/.test(environment[name]))throw Error('Backend credential unavailable or malformed');
  if(!/^[A-Za-z0-9_-]{3,128}$/.test(environment.NEBIUS_PROJECT_ID))throw Error('Backend project unavailable or malformed');
  if(environment.NEBIUS_SANDBOX_IMAGE&&!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(environment.NEBIUS_SANDBOX_IMAGE))throw Error('Image identity malformed');
  if(environment.NEBIUS_BASE_URL!=='https://api.tokenfactory.nebius.com/v1/'||
     environment.NEBIUS_SANDBOX_URL!=='https://api.tokenfactory.nebius.com/sandboxes/'||
     environment.NEBIUS_MODEL!=='nvidia/nemotron-3-super-120b-a12b'||
     environment.NEBIUS_INPUT_USD_PER_MILLION!=='0.3'||environment.NEBIUS_OUTPUT_USD_PER_MILLION!=='0.9')
    throw Error('Configuration differs from the qualified provider identity');
  return environment;
}
export function credentialFreeChildEnvironment(source) {
  const out={PATH:source.PATH??'/usr/local/bin:/usr/bin:/bin',CLOUDSDK_CORE_DISABLE_PROMPTS:'1'};
  for(const key of ['CLOUDSDK_CONFIG','CLOUDSDK_ACTIVE_CONFIG_NAME','LANG'])if(source[key])out[key]=source[key];
  return out;
}
