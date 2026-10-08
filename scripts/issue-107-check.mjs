// Independent integration check owned/run by the orchestrator. No real email delivery.
// E2E_ENV_FILE=.env.e2e.localdb ISSUE107_BASE_URL=http://127.0.0.1:3107 node scripts/issue-107-check.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import { randomUUID, randomBytes, createHash, createCipheriv, createDecipheriv, createHmac } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'

const readEnv = file => Object.fromEntries(fs.readFileSync(file, 'utf8').split('\n')
  .filter(line => line.includes('=') && !line.trim().startsWith('#'))
  .map(line => { const i = line.indexOf('='); return [line.slice(0,i).trim(), line.slice(i+1).trim().replace(/^(['"])(.*)\1$/, '$2')] }))
const env = readEnv(process.env.E2E_ENV_FILE || '.env.e2e.localdb')
for (const [key,value] of Object.entries(process.env)) if (key.startsWith('E2E_') && value) env[key]=value
const recoveryEnv = readEnv('.env.issue107.local')
assert.equal(env.E2E_WRITES,'1','Explicit dedicated write permission required')
assert.equal(env.E2E_TEST_PROJECT,'1','Dedicated test project required')
const baseUrl = process.env.ISSUE107_BASE_URL || 'http://127.0.0.1:3107'
const publicHeadersBaseUrl = process.env.ISSUE107_PUBLIC_HEADERS_BASE_URL || baseUrl
for (const url of [baseUrl,publicHeadersBaseUrl,env.E2E_SUPABASE_URL]) assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(url).hostname),'Local environment only')
const authOptions = {autoRefreshToken:false,persistSession:false,detectSessionInUrl:false}
const service = createClient(env.E2E_SUPABASE_URL,env.E2E_SUPABASE_SERVICE_ROLE_KEY,{auth:authOptions})
const userClient = token => createClient(env.E2E_SUPABASE_URL,env.E2E_SUPABASE_ANON_KEY,{
  auth:authOptions,...(token?{global:{headers:{Authorization:'Bearer '+token}}}:{})
})
const stamp = randomUUID().slice(0,8), password = 'Original-'+randomUUID()+'!'
const fixtures=[],results=[]
let actor,browser,hookStarted=false,mailMode='success',checkStage='setup',sqlCounter=0
const messages=[],accepted=new Map()
const key = Buffer.from(recoveryEnv.RECOVERY_SECRET,'base64')
assert.equal(key.length,32,'Recovery encryption key required')
const hash = token => createHash('sha256').update(token).digest('hex')
const q = value => "'"+String(value).replaceAll("'","''")+"'"
function sql(query,native=false) {
  sqlCounter++
  try {
    const args=['exec','-i','supabase_db_platforma-fonduri']
    let input="set log_min_error_statement='panic'; set log_parameter_max_length_on_error=0; "+query
    if(native){
      const source=JSON.parse(execFileSync('docker',['inspect','supabase_auth_platforma-fonduri'],{encoding:'utf8',windowsHide:true}))[0]
      const databaseUrl=new URL(source.Config.Env.find(line=>line.startsWith('GOTRUE_DB_DATABASE_URL=')).slice('GOTRUE_DB_DATABASE_URL='.length))
      assert.equal(decodeURIComponent(databaseUrl.username),'supabase_auth_admin','Actual Native DB role')
      const nativePassword=decodeURIComponent(databaseUrl.password)
      assert.ok(nativePassword&&!/[\r\n]/.test(nativePassword),'Native DB password usable over stdin')
      args.push('sh','-c','IFS= read -r task_native_password; export PGPASSWORD="$task_native_password"; exec psql -h 127.0.0.1 -U supabase_auth_admin -d postgres -X -v ON_ERROR_STOP=1 -qAt -v VERBOSITY=sqlstate')
      input=nativePassword+'\n'+query
    }else args.push('psql','-U','postgres','-d','postgres','-X','-v','ON_ERROR_STOP=1','-qAt','-v','VERBOSITY=sqlstate')
    return execFileSync('docker',args,{input,encoding:'utf8',windowsHide:true,stdio:['pipe','pipe','pipe']}).trim()
  } catch(error) { const state=String(error?.stderr||'').match(/ERROR:\s+([A-Z0-9]{5})\b/)?.[1]||'unknown';throw new Error('SQL check failed '+sqlCounter+' '+state) }
}
function concurrentSql(query) {
  const child=spawn('docker',['exec','-i','supabase_db_platforma-fonduri','psql','-U','postgres','-d','postgres','-X','-v','ON_ERROR_STOP=1','-qAt'],{windowsHide:true})
  let output=''
  child.stdout.on('data',chunk=>{output+=chunk})
  child.stderr.on('data',()=>{})
  child.stdin.end("set log_min_error_statement='panic'; set log_parameter_max_length_on_error=0; set statement_timeout='10s'; "+query)
  return new Promise((resolve,reject)=>{child.on('error',()=>reject(new Error('Concurrent check unavailable')));child.on('close',code=>resolve({code,output}))})
}
const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms))
async function waitFor(check,label) { for(let i=0;i<100;i++){if(await check())return;await sleep(50)}throw new Error(label) }
async function lockBarrier(name) {
  await waitFor(()=>sql("select exists(select 1 from pg_stat_activity a join pg_locks l on l.pid=a.pid where a.application_name="+q(name)+" and l.locktype='advisory' and l.classid=105 and l.objid=1 and l.granted)")==='t','Lock barrier missing')
}
function ok(result,label) { assert.ok(!result.error,label);return result.data }
const rpc = async (name,args) => { const result=await service.rpc(name,args);return ok(result,'RPC '+name+' '+(result.error?.code||'')) }
function encrypt(payload) {
  const iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm',key,iv)
  const value=Buffer.concat([cipher.update(JSON.stringify(payload),'utf8'),cipher.final()])
  return ['v1',iv.toString('base64url'),cipher.getAuthTag().toString('base64url'),value.toString('base64url')].join('.')
}
async function fixture(role='client',email) {
  const address=email||'issue107.impl.'+stamp+'.'+fixtures.length+'@example.invalid'
  const {user}=ok(await service.auth.admin.createUser({email:address,password,email_confirm:true}),'Temporary fixture creation')
  assert.ok(user?.id,'Fixture UUID required')
  const person={id:user.id,email:address};fixtures.push(person)
  ok(await service.from('profiles').update({role,full_name:'Recovery check '+stamp,is_active:true}).eq('id',person.id),'Fixture profile')
  return person
}
async function login(person,selected=password) {
  const client=userClient(), data=ok(await client.auth.signInWithPassword({email:person.email,password:selected}),'Password login')
  assert.ok(data.session,'Verified normal session required');return data.session
}
const lifecycle = (person,active) => rpc('set_user_account_active',{p_target_id:person.id,p_actor_id:actor.id,p_active:active,p_user_agent:'issue107-implementation-check'})
const clearCooldown = person => sql('update public.profiles set password_reset_requested_at=null where id='+q(person.id))
const flow = person => { const row=sql("select row_to_json(f) from account_recovery.flows f where user_id="+q(person.id));return row?JSON.parse(row):null }
function snapshot(person) {
  return JSON.parse(sql("select jsonb_build_object('password',u.encrypted_password,'marker',p.must_change_password,'flow',(select to_jsonb(f) from account_recovery.flows f where f.user_id=u.id),'sessions',(select count(*) from auth.sessions where user_id=u.id),'tokens',(select count(*) from auth.one_time_tokens where user_id=u.id),'nativeFlows',(select count(*) from auth.flow_state where user_id=u.id or linking_target_id=u.id),'audit',(select count(*) from public.audit_logs where user_id=u.id and action_type='password_reset_completed'),'receipts',(select count(*) from account_recovery.receipts where user_id=u.id)) from auth.users u join public.profiles p on p.id=u.id where u.id="+q(person.id)))
}
function seedPkce(person,method='recovery',linkingTarget=null) {
  const code=randomUUID(),verifier=randomBytes(32).toString('base64url')
  sql("insert into auth.flow_state(id,user_id,auth_code,code_challenge_method,code_challenge,provider_type,provider_access_token,provider_refresh_token,authentication_method,created_at,updated_at,auth_code_issued_at,linking_target_id) values(gen_random_uuid(),"+q(person.id)+","+q(code)+",'plain',"+q(verifier)+",'email','','',"+q(method)+",clock_timestamp(),clock_timestamp(),clock_timestamp(),"+(linkingTarget?q(linkingTarget):'null')+")")
  return {code,verifier}
}
async function exchangePkce(proof) {
  const response=await fetch(env.E2E_SUPABASE_URL+'/auth/v1/token?grant_type=pkce',{method:'POST',headers:{apikey:env.E2E_SUPABASE_ANON_KEY,'Content-Type':'application/json'},body:JSON.stringify({auth_code:proof.code,code_verifier:proof.verifier}),signal:AbortSignal.timeout(10000)})
  return {status:response.status,data:await response.json()}
}
async function enqueue(person) {
  const id=randomUUID(),token=id+'.'+randomBytes(32).toString('base64url')
  assert.equal(await rpc('recovery_enqueue',{p_job_id:id,p_payload_cipher:encrypt({email:person.email,token}),p_ip_hash:hash(id),p_user_agent:'issue107-implementation-check'}),true,'Queue accepted')
  return {id,token,tokenHash:hash(token)}
}
function ownPayload(envelope) {
  try { const [,iv,tag,body]=envelope.split('.'),cipher=createDecipheriv('aes-256-gcm',key,Buffer.from(iv,'base64url'));cipher.setAuthTag(Buffer.from(tag,'base64url'));return JSON.parse(Buffer.concat([cipher.update(Buffer.from(body,'base64url')),cipher.final()]).toString()) }catch{return null}
}
async function takeFor(job) {
  for(let i=0;i<200;i++) {
    const lease=randomUUID(),taken=await rpc('recovery_take_delivery',{p_lease_id:lease})
    assert.ok(taken,'Queued delivery available')
    if(taken.id===job.id)return {...taken,lease}
    assert.ok((taken.recipient?.startsWith('issue107.impl.')||ownPayload(taken.payload_cipher)?.email?.startsWith('issue107.impl.')),'Only this check owns skipped confirmation')
    await rpc('recovery_finish_delivery',{p_job_id:taken.id,p_lease_id:lease,p_outcome:'skipped'})
  }
  throw new Error('Own queue job not obtained')
}
async function issue(person) {
  const job=await enqueue(person),taken=await takeFor(job)
  const prepared=await rpc('recovery_prepare_delivery',{p_job_id:job.id,p_lease_id:taken.lease,p_email:person.email,p_token_hash:job.tokenHash})
  assert.equal(prepared.status,'send','Recovery flow prepared')
  await rpc('recovery_finish_delivery',{p_job_id:job.id,p_lease_id:taken.lease,p_outcome:'sent',p_provider_id:'fixture-only'})
  return {...job,expires:prepared.expires_at}
}
const inspect = (proof,attempt) => rpc('recovery_inspect',{p_flow_id:proof.id,p_token_hash:proof.tokenHash,...(attempt?{p_attempt_id:attempt}:{})})
const complete = (proof,selected,attempt=randomUUID()) => rpc('recovery_complete',{
  p_flow_id:proof.id,p_token_hash:proof.tokenHash,p_attempt_id:attempt,p_password:selected,p_user_agent:'issue107-implementation-check',
})
async function api(path,{body,cookie,method,headers={}}={}) {
  const response=await fetch(baseUrl+path,{method:method||(body?'POST':'GET'),headers:{
    ...(body?{'Content-Type':'application/json',Origin:baseUrl}:{}),...(cookie?{Cookie:cookie}:{}),...headers,
  },...(body?{body:JSON.stringify(body)}:{})})
  let data;try{data=await response.json()}catch{data=null}
  return {status:response.status,data,headers:response.headers,cookie:response.headers.get('set-cookie')?.split(';')[0]}
}
const exchange = proof => api('/api/auth/recovery/exchange',{body:{token:proof.token}})
const submit = (proof,cookie,selected,attempt=randomUUID()) => api('/api/auth/recovery/complete',{
  body:{flowId:proof.id,attemptId:attempt,password:selected,confirmation:selected},cookie,
})
const dispatch = () => api('/api/auth/recovery/dispatch',{headers:{Authorization:'Bearer '+recoveryEnv.CRON_SECRET}})
async function request(person) { return api('/api/auth/recovery/request',{body:{email:person.email}}) }
async function waitMessage(person,from=messages.length) {
  await waitFor(()=>messages.slice(from).some(message=>(message.body.text||'').includes('#token='+flow(person)?.flow_id+'.')),'Recovery email not handed off')
  const message=messages.slice(from).find(message=>(message.body.text||'').includes('#token='+flow(person)?.flow_id+'.'))
  const token=message.body.text.match(/#token=([a-f0-9-]+\.[A-Za-z0-9_-]{43})/)?.[1]
  assert.ok(token,'Application proof in email');return {id:token.split('.')[0],token,tokenHash:hash(token),message}
}
async function probe(name,ids,run) {
  if(process.env.ISSUE107_CHECK_ONLY&&!name.includes(process.env.ISSUE107_CHECK_ONLY))return
  checkStage=name
  try { await run();results.push({name,ids,baseUrl:name==='public_page_headers'?publicHeadersBaseUrl:baseUrl,passed:true}) }
  catch(error) { results.push({name,ids,baseUrl,passed:false,stage:checkStage,reason:error instanceof assert.AssertionError||(/^SQL check failed [0-9]+ [A-Z0-9a-z]+$/.test(error?.message))?error.message.split('\n')[0]:'Check failed; private diagnostics withheld'}) }
  console.log(JSON.stringify(results.at(-1)))
}
const mock=http.createServer((request,response)=>{
  if(request.method!=='POST'||request.url!=='/emails'){response.writeHead(404);response.end();return}
  let raw='';request.on('data',chunk=>{raw+=chunk});request.on('end',async()=>{
    const body=JSON.parse(raw),idempotency=request.headers['idempotency-key']
    assert.equal(request.headers.authorization,'Bearer re_test_local_issue107','Local provider token')
    const prior=accepted.get(idempotency)
    if(prior){if(raw!==prior.raw){response.writeHead(409,{'Content-Type':'application/json'});response.end(JSON.stringify({name:'invalid_idempotent_request',message:'Payload mismatch'}));return}response.setHeader('Content-Type','application/json');response.end(JSON.stringify({id:prior.id}));return}
    const event={body,raw,key:idempotency,mode:mailMode};messages.push(event)
    if(mailMode==='reject'){response.writeHead(422,{'Content-Type':'application/json'});response.end(JSON.stringify({name:'validation_error',message:'Test refusal'}));return}
    const id=randomUUID();accepted.set(idempotency,{id,raw})
    if(mailMode==='unknown'){mailMode='success';request.socket.destroy();return}
    if(mailMode==='delay')await sleep(1800)
    response.setHeader('Content-Type','application/json');response.end(JSON.stringify({id}))
  })
})
await new Promise((resolve,reject)=>{mock.once('error',reject);mock.listen(4017,'127.0.0.1',resolve)})
try {
  assert.equal((await api('/api/me')).status,401,'Isolated server ready')
  assert.equal(sql("select enabled from account_recovery.settings limit 1"),'t','Verified feature activation required')
  assert.equal(sql("select to_regnamespace('issue107_check') is null"),'t','Probe namespace must be unused')
  sql('create schema issue107_check; revoke all on schema issue107_check from public,anon,authenticated;')
  actor=await fixture('admin')
  await probe('fresh_migration_disabled_activation_and_rollback',['R26','R30','R33'],async()=>{
    const before=snapshot(actor),migration=fs.readFileSync('supabase/migrations/20261007123438_issue_107_account_recovery.sql','utf8')+'\n'+fs.readFileSync('supabase/migrations/20261008095956_preserve_recovery_proofs_after_retry_exhaustion.sql','utf8')
    const wrappers=['recovery_preflight','recovery_enqueue','recovery_take_delivery','recovery_freeze_delivery','recovery_prepare_delivery','recovery_delivery_ready','recovery_finish_delivery','recovery_inspect','recovery_complete','invalidate_account_recovery','activate_account_recovery']
    const assertion=`do $check$ begin
      if (select count(*) from account_recovery.settings)<>1 or (select enabled from account_recovery.settings) then raise exception 'Installation must initialize disabled';end if;
      if public.recovery_preflight()<>jsonb_build_object('compatible',true,'enabled',false) then raise exception 'Fresh preflight must be read-only and compatible';end if;
      if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='account_recovery' and c.relkind='r' and (not c.relrowsecurity or not c.relforcerowsecurity)) then raise exception 'RLS and FORCE required';end if;
      if has_schema_privilege('anon','account_recovery','USAGE') or has_schema_privilege('authenticated','account_recovery','USAGE') or has_schema_privilege('service_role','account_recovery','USAGE') then raise exception 'Private schema not accessible';end if;
      if not has_function_privilege('service_role','public.recovery_complete(uuid,text,uuid,text,text,text)','EXECUTE') or has_function_privilege('anon','public.recovery_complete(uuid,text,uuid,text,text,text)','EXECUTE') or has_function_privilege('authenticated','public.recovery_complete(uuid,text,uuid,text,text,text)','EXECUTE') then raise exception 'Service-only boundary required';end if;
      if not has_function_privilege('supabase_auth_admin','account_recovery.send_email_hook(jsonb)','EXECUTE') or has_function_privilege('service_role','account_recovery.send_email_hook(jsonb)','EXECUTE') then raise exception 'Native hook role boundary required';end if;
      if has_table_privilege('supabase_auth_admin','account_recovery.flows','SELECT') then raise exception 'Native hook cannot read proofs';end if;
    end $check$;`
    const activate=`insert into auth.flow_state(id,user_id,auth_code,code_challenge_method,code_challenge,provider_type,provider_access_token,provider_refresh_token,authentication_method,created_at,updated_at) values(gen_random_uuid(),${q(actor.id)},gen_random_uuid()::text,'plain',gen_random_uuid()::text,'email','','','recovery',clock_timestamp(),clock_timestamp());
      update auth.users set recovery_token='fixture',confirmation_token='fixture',email_change_token_new='fixture',email_change_token_current='fixture',phone_change_token='fixture',reauthentication_token='fixture' where id=${q(actor.id)};
      select public.activate_account_recovery('v2.197.0');
      do $check$ begin
        if not (select enabled from account_recovery.settings) then raise exception 'Activation must enable';end if;
        if exists(select 1 from auth.sessions) or exists(select 1 from auth.one_time_tokens) or exists(select 1 from auth.flow_state) then raise exception 'Activation must revoke all old credentials';end if;
        if exists(select 1 from auth.users where coalesce(recovery_token,'')<>'' or coalesce(confirmation_token,'')<>'' or coalesce(email_change_token_new,'')<>'' or coalesce(email_change_token_current,'')<>'' or coalesce(phone_change_token,'')<>'' or coalesce(reauthentication_token,'')<>'') then raise exception 'Every legacy native proof cleared';end if;
        if exists(select 1 from auth.users u join issue107_password_baseline b using(id) where u.encrypted_password is distinct from b.encrypted_password) then raise exception 'Activation cannot change passwords';end if;
      end $check$;`
    const outcome=sql("begin;set local lock_timeout='5s';select pg_advisory_xact_lock(105,1);create temp table issue107_password_baseline as select id,encrypted_password from auth.users;drop schema account_recovery cascade;do $drop$ declare r record;begin for r in select p.proname,pg_get_function_identity_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array["+wrappers.map(q).join(',')+"]) loop execute format('drop function public.%I(%s)',r.proname,r.args);end loop;end $drop$;"+migration+assertion+activate+"rollback;select 'migration_rollback_safe';")
    assert.ok(outcome.endsWith('migration_rollback_safe'),'Fresh migration and activation assertions passed')
    assert.deepEqual(snapshot(actor),before,'Migration check preserves original database data and activation')
  })
  await probe('public_page_headers',['R09','R33','R34'],async()=>{
    for(const pathname of ['/forgot-password','/reset-password']) {
      const response=await fetch(publicHeadersBaseUrl+pathname)
      assert.equal(response.status,200,'Public page available without normal Auth')
      assert.match(response.headers.get('cache-control'),/no-store/,'Public recovery page never cached')
      assert.equal(response.headers.get('referrer-policy'),'no-referrer','Public recovery page never sends referrer')
    }
  })
  await probe('private_state_and_http_boundaries',['R03','R07','R12','R25','R30','R34'],async()=>{
    assert.ok((await userClient().rpc('recovery_inspect',{p_flow_id:randomUUID(),p_token_hash:hash('invalid')})).error,'Anon cannot invoke service proof RPC')
    assert.ok((await userClient().schema('account_recovery').from('flows').select('*')).error,'Private schema not exposed')
    const person=await fixture(),proof=await issue(person)
    const absent=await submit(proof,undefined,'Selected-'+randomUUID())
    assert.equal(absent.status,400,'Missing cookie not authorized')
    const cross=await api('/api/auth/recovery/exchange',{body:{token:proof.token},headers:{Origin:'https://attacker.example'}})
    assert.equal(cross.status,403,'Cross-origin exchange denied')
    const oversized=await api('/api/auth/recovery/request',{body:{email:'x'.repeat(5000)+'@example.invalid'}})
    assert.ok([400,413].includes(oversized.status),'Oversized body rejected')
    const malformed=await fetch(baseUrl+'/api/auth/recovery/request',{method:'POST',headers:{Origin:baseUrl,'Content-Type':'application/json'},body:'{invalid'})
    assert.equal(malformed.status,400,'Malformed JSON rejected')
    const valid=await exchange(proof)
    assert.equal(valid.data.status,'valid','Application exchange')
    assert.match(valid.headers.get('cache-control'),/no-store/,'Proof response never cached')
    assert.equal(valid.headers.get('referrer-policy'),'no-referrer','Proof privacy')
    assert.ok(valid.headers.get('set-cookie').includes('HttpOnly')&&valid.headers.get('set-cookie').includes('SameSite=Strict'),'Private strict cookie')
    const injection=await api('/api/auth/recovery/complete',{body:{flowId:proof.id,attemptId:randomUUID(),password:'Injection-'+randomUUID(),confirmation:'ignored',userId:actor.id},cookie:valid.cookie})
    assert.equal(injection.status,400,'Extra target UUID rejected')
    assert.equal(snapshot(person).sessions,0,'No normal session before save')
    assert.equal((await api('/api/me')).status,401,'No implicit app access')
  })
  await probe('native_recovery_and_magiclink_have_no_credentials',['R09','R30','R33'],async()=>{
    const person=await fixture()
    for(const type of ['recovery','magiclink','email_change_current','email_change_new']) {
      const generated=ok(await service.auth.admin.generateLink({type,email:person.email,...(type.startsWith('email_change')?{newEmail:'issue107.impl.'+stamp+'.changed@example.invalid'}:{})}),'Native generate shaped credential')
      assert.ok((await userClient().auth.verifyOtp({type:type.startsWith('email_change')?'email_change':type,token_hash:generated.properties.hashed_token})).error,'Native hash proof rejected')
      assert.ok((await userClient().auth.verifyOtp({type:'email',email:person.email,token:generated.properties.email_otp})).error,'Native email OTP rejected')
    }
    assert.equal(snapshot(person).sessions,0,'No native sessions')
    assert.equal(sql('select count(*) from auth.one_time_tokens where user_id='+q(person.id)),'0','No persisted native credentials')
    const normal=await login(person),native=userClient()
    ok(await native.auth.setSession({access_token:normal.access_token,refresh_token:normal.refresh_token}),'Native session fixture')
    assert.ok((await native.auth.updateUser({password:'Bypass-'+randomUUID()})).error,'Native password write cannot bypass atomic recovery')
    const costSix=await fixture()
    sql('begin;select pg_advisory_xact_lock(105,1);update auth.users set encrypted_password=extensions.crypt('+q(password)+',extensions.gen_salt('+q('bf')+',6)) where id='+q(costSix.id)+';commit;')
    const sixBefore=snapshot(costSix).password;await login(costSix)
    assert.equal(snapshot(costSix).password,sixBefore,'Existing bcrypt cost6 login unchanged')
    const sixProof=await issue(costSix),sixSnapshot=snapshot(costSix)
    assert.equal((await complete(sixProof,password)).status,'same_password','Existing cost6 same-password detected')
    assert.deepEqual(snapshot(costSix),sixSnapshot,'Cost6 rejected save preserves proof and sessions')
    const source=JSON.parse(execFileSync('docker',['inspect','supabase_auth_platforma-fonduri'],{encoding:'utf8',windowsHide:true}))[0]
    const containerName='issue107_implementation_auth'
    const names=execFileSync('docker',['ps','-a','--format','{{.Names}}'],{encoding:'utf8',windowsHide:true}).trim().split('\n')
    assert.ok(!names.includes(containerName),'Unused Auth proof container')
    const file='supabase/.temp/issue107-implementation-auth.env'
    fs.mkdirSync('supabase/.temp',{recursive:true})
    fs.writeFileSync(file,source.Config.Env.filter(line=>!line.startsWith('GOTRUE_HOOK_SEND_EMAIL_')&&!line.startsWith('GOTRUE_DISABLE_SIGNUP=')).join('\n')+'\n')
    try {
      execFileSync('docker',['run','-d','--name',containerName,'--network','supabase_network_platforma-fonduri','-p','127.0.0.1:3108:9999','--env-file',file,
        '-e','GOTRUE_DISABLE_SIGNUP=true','-e','GOTRUE_HOOK_SEND_EMAIL_ENABLED=true','-e','GOTRUE_HOOK_SEND_EMAIL_URI=pg-functions://postgres/account_recovery/send_email_hook',source.Config.Image],
        {windowsHide:true,stdio:'pipe'});hookStarted=true
    }finally{fs.rmSync(file,{force:true})}
    await waitFor(async()=>{try{return(await fetch('http://127.0.0.1:3108/health')).ok}catch{return false}},'Configured Auth clone health')
    const before=(await(await fetch('http://127.0.0.1:54324/api/v1/messages')).json()).total
    const headers={'Content-Type':'application/json',apikey:env.E2E_SUPABASE_ANON_KEY}
    const pkceChallenge=hash(randomUUID())
    for(const [path,body] of [['/recover',{email:person.email}],['/otp',{email:person.email,create_user:false}],['/recover',{email:'issue107.impl.'+stamp+'.missing@example.invalid'}],['/recover',{email:person.email,code_challenge:pkceChallenge,code_challenge_method:'s256'}],['/otp',{email:person.email,create_user:false,code_challenge:pkceChallenge,code_challenge_method:'s256'}]]) {
      assert.equal((await fetch('http://127.0.0.1:3108'+path,{method:'POST',headers,body:JSON.stringify(body)})).status,200,'Native request remains generic')
    }
    assert.equal((await(await fetch('http://127.0.0.1:54324/api/v1/messages')).json()).total,before,'Hook suppresses SMTP delivery')
    assert.equal(snapshot(person).nativeFlows,0,'Native PKCE requests cannot persist flow_state')
    assert.equal((await fetch('http://127.0.0.1:3108/token?grant_type=password',{method:'POST',headers,body:JSON.stringify({email:person.email,password})})).status,200,'Configured Auth password login intact')
    let preflightDisableEmail=false
    const proxy=http.createServer(async(req,res)=>{
      try {
        let body='';for await(const chunk of req)body+=chunk
        const target=req.url.startsWith('/auth/v1/')?'http://127.0.0.1:3108'+req.url.slice('/auth/v1'.length):env.E2E_SUPABASE_URL+req.url
        const forwarded=await fetch(target,{method:req.method,headers:{apikey:req.headers.apikey||'',Authorization:req.headers.authorization||'','Content-Type':req.headers['content-type']||'application/json'},...(req.method==='GET'?{}:{body}),signal:AbortSignal.timeout(5000)})
        res.writeHead(forwarded.status,{'Content-Type':'application/json'})
        if(preflightDisableEmail&&req.url==='/auth/v1/settings'){
          const body=await forwarded.json();body.external.email=false;res.end(JSON.stringify(body))
        }else res.end(await forwarded.text())
      }catch{res.writeHead(503);res.end('{}')}
    })
    await new Promise(resolve=>proxy.listen(3111,'127.0.0.1',resolve))
    const configFile='supabase/.temp/issue107-preflight-config.json',envFile='.env.issue107.preflight.local'
    const databaseRole=decodeURIComponent(new URL(source.Config.Env.find(line=>line.startsWith('GOTRUE_DB_DATABASE_URL=')).slice('GOTRUE_DB_DATABASE_URL='.length)).username)
    const config={databaseRole,minimumPasswordLength:6,passwordRequirements:'',dbEncryptionEnabled:false,otpExpiry:3600,disableSignup:true,sendEmailHookEnabled:true,sendEmailHookUri:'pg-functions://postgres/account_recovery/send_email_hook',alternativeProvidersDisabled:true,resendLinkTrackingDisabled:true}
    const explicitEnv={...recoveryEnv,SUPABASE_URL:'http://127.0.0.1:3111',NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:3111',NEXT_PUBLIC_SUPABASE_ANON_KEY:env.E2E_SUPABASE_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY:env.E2E_SUPABASE_SERVICE_ROLE_KEY,NODE_ENV:'development',RECOVERY_DISPATCH_EVERY_MINUTE_CONFIGURED:'true'}
    const runPreflight=async(configOverride={},envOverride={})=>{
      fs.writeFileSync(configFile,JSON.stringify({...config,...configOverride}))
      fs.writeFileSync(envFile,Object.entries({...explicitEnv,...envOverride}).map(([name,value])=>name+'='+value).join('\n')+'\n')
      const child=spawn(process.execPath,['scripts/issue-107-preflight.mjs','--env-file',envFile,'--auth-config',configFile],{windowsHide:true})
      let output='';child.stdout.on('data',chunk=>{output+=chunk});child.stderr.on('data',()=>{})
      const code=await new Promise((resolve,reject)=>{child.on('error',()=>reject(new Error('Preflight child unavailable')));child.on('close',resolve)})
      return {code,report:JSON.parse(output)}
    }
    try {
      const beforePreflight=snapshot(person),positive=await runPreflight()
      assert.equal(positive.code,0,'Configured real Auth preflight passes')
      assert.equal(positive.report.status,'already_enabled','Preflight sees enabled database read-only')
      assert.equal(positive.report.checks.authDbRole,true,'Actual native database role attested')
      assert.equal(positive.report.checks.settingsEmailProviderEnabled,true,'Email/password provider remains enabled')
      preflightDisableEmail=true
      const noEmailProvider=await runPreflight()
      assert.equal(noEmailProvider.report.status,'blocked','Disabled email provider blocks deployment despite disabled signup')
      assert.equal(noEmailProvider.report.checks.settingsEmailProviderEnabled,false,'Password sign-in availability cannot bypass gate')
      preflightDisableEmail=false
      const noDispatch=await runPreflight({},{RECOVERY_DISPATCH_EVERY_MINUTE_CONFIGURED:''})
      assert.equal(noDispatch.report.status,'blocked','Missing actual minute-scheduler attestation blocks deployment')
      assert.equal(noDispatch.report.checks.dispatchCron,false,'Daily Vercel cron cannot certify recovery dispatch')
      const badRole=await runPreflight({databaseRole:'wrong_role'})
      assert.equal(badRole.report.status,'blocked','Wrong native database role blocks deployment')
      assert.equal(badRole.report.checks.authDbRole,false,'Wrong role cannot bypass gate')
      const badKey=await runPreflight({},{RECOVERY_SECRET:'invalid'})
      assert.equal(badKey.report.status,'blocked','Invalid server encryption key blocks deployment')
      const productionHttp=await runPreflight({},{NODE_ENV:'production'})
      assert.equal(productionHttp.report.status,'blocked','Production HTTP origin blocks deployment')
      assert.deepEqual(snapshot(person),beforePreflight,'All preflights preserve credentials and data')
    }finally{
      fs.rmSync(configFile,{force:true});fs.rmSync(envFile,{force:true})
      await new Promise(resolve=>proxy.close(resolve))
    }
  })
  await probe('native_pkce_legacy_and_inflight_credentials',['R09','R17','R26','R30','R33'],async()=>{
    const person=await fixture(),other=await fixture()
    try {
      // Positive controls: these exact supported legacy PKCE rows issue real credentials while the adapter is disabled.
      sql('update account_recovery.settings set enabled=false')
      for(const method of ['recovery','magiclink']) {
        const result=await exchangePkce(seedPkce(person,method))
        assert.equal(result.status,200,'Disabled adapter legacy PKCE positive control')
        assert.ok(result.data.access_token&&result.data.refresh_token,'Positive control emitted actual native credentials')
      }
    }finally{
      sql('delete from auth.sessions where user_id='+q(person.id)+';delete from auth.flow_state where user_id='+q(person.id)+';update account_recovery.settings set enabled=true')
    }
    for(const method of ['recovery','magiclink']) {
      const legacy=seedPkce(person,method),before=snapshot(person),result=await exchangePkce(legacy)
      assert.ok(result.status>=400&&!result.data.access_token&&!result.data.refresh_token,'Enabled adapter rejects even a valid legacy PKCE code')
      assert.deepEqual(snapshot(person),before,'Rejected native PKCE atomically preserves password and creates no session')
    }
    sql('delete from auth.flow_state where user_id='+q(person.id))
    const normal=await login(person),sessionId=JSON.parse(Buffer.from(normal.access_token.split('.')[1],'base64url').toString()).session_id
    assert.ok(sessionId,'Password session ID')
    const claimCheck=sql("begin;insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method) values(gen_random_uuid(),"+q(sessionId)+",clock_timestamp(),clock_timestamp(),'totp');do $check$ begin begin update auth.mfa_amr_claims set authentication_method='otp' where session_id="+q(sessionId)+" and authentication_method='password';raise exception 'AMR replacement unexpectedly allowed';exception when raise_exception then if SQLERRM<>'NATIVE_NON_PASSWORD_AMR_BLOCKED' then raise;end if;end;end $check$;rollback;select 'native_claim_guard_passed';",true)
    assert.ok(claimCheck.endsWith('native_claim_guard_passed'),'Additional MFA permitted after password; replacing the password claim refused')
    // Hold the Native request after it has read its code but before it creates a session.
    const raced=seedPkce(other),holder=concurrentSql("set application_name='issue107-native-pkce-holder';begin;select pg_advisory_xact_lock(107,3);select pg_sleep(3);commit;")
    await waitFor(()=>sql("select exists(select 1 from pg_stat_activity a join pg_locks l on l.pid=a.pid where a.application_name='issue107-native-pkce-holder' and l.locktype='advisory' and l.classid=107 and l.objid=3 and l.granted)")==='t','Native PKCE barrier holder')
    sql("create function issue107_check.hold_native_session() returns trigger language plpgsql as $$begin if NEW.user_id="+q(other.id)+"::uuid then perform pg_advisory_xact_lock(107,3);end if;return NEW;end$$;create trigger issue107_check_native_session before insert on auth.sessions for each row execute function issue107_check.hold_native_session();update account_recovery.settings set enabled=false")
    let pending
    try {
      pending=exchangePkce(raced)
      await waitFor(()=>sql("select exists(select 1 from pg_stat_activity a join pg_locks l on l.pid=a.pid where a.usename='supabase_auth_admin' and l.locktype='advisory' and l.classid=107 and l.objid=3 and not l.granted)")==='t','Native request read its legacy proof')
      await rpc('activate_account_recovery',{p_verified_auth_version:'v2.197.0'})
      assert.equal(sql('select enabled from account_recovery.settings'),'t','Activation committed during in-flight native request')
      assert.equal(sql('select count(*) from auth.flow_state'),'0','Activation removed all legacy PKCE state')
      assert.equal((await holder).code,0,'Native barrier released')
      const outcome=await pending
      assert.ok(outcome.status>=400&&!outcome.data.access_token&&!outcome.data.refresh_token,'In-flight native proof cannot mint credentials after activation')
      assert.equal(snapshot(other).sessions,0,'Rejected in-flight request rolls its session back')
      assert.equal(snapshot(other).nativeFlows,0,'Activation does not restore stale native flow')
    }finally{
      await holder
      if(pending)await pending.catch(()=>{})
      sql('drop trigger if exists issue107_check_native_session on auth.sessions;drop function if exists issue107_check.hold_native_session();update account_recovery.settings set enabled=true')
    }
    // Completion also removes flow_state bound through either native UUID column.
    const ownProof=await issue(person)
    seedPkce(person);seedPkce(other,'magiclink',person.id)
    assert.equal(snapshot(person).nativeFlows,2,'Both user and linking-target native credentials seeded')
    assert.equal((await complete(ownProof,'Selected-'+randomUUID())).status,'completed','Atomic completion with legacy PKCE rows')
    assert.equal(snapshot(person).nativeFlows,0,'Completion clears both legacy native flow bindings')
    assert.equal(snapshot(person).sessions,0,'Completion revokes password and supplementary MFA sessions')
  })
  await probe('roles_cooldown_latest_and_invalid_passwords',['R01','R05','R06','R14','R16','R22'],async()=>{
    for(const role of ['client','junior','consultant','admin']) {
      const person=await fixture(role==='junior'?'consultant':role);ok(await service.from('profiles').update({must_change_password:true,...(['junior','consultant'].includes(role)?{consultant_level:role==='junior'?'junior':'senior'}:{})}).eq('id',person.id),'Temporary marker')
      const proof=await issue(person)
      assert.equal((await complete(proof,password)).status,'same_password','Same password does not consume')
      for(const invalid of ['short','a'.repeat(73),'ă'.repeat(37),'😀'.repeat(5)])assert.equal((await complete(proof,invalid)).status,'password_invalid','Password byte/character boundary')
      assert.equal((await inspect(proof)).status,'valid','Bad password proof reusable')
      assert.equal(snapshot(person).marker,true,'Marker unchanged on refusal')
      const next=await enqueue(person),leased=await takeFor(next)
      assert.equal((await rpc('recovery_prepare_delivery',{p_job_id:next.id,p_lease_id:leased.lease,p_email:person.email,p_token_hash:next.tokenHash})).status,'skip','Cooldown skips')
      assert.equal((await inspect(proof)).status,'valid','Cooldown keeps old flow')
      sql('update public.profiles set password_reset_requested_at=clock_timestamp()-interval \'15 minutes\' where id='+q(person.id))
      const newest=await issue(person)
      assert.equal((await inspect(proof)).status,'invalid','Newest replaces opened proof')
      const selected=role==='junior'?'ă'.repeat(36):role==='admin'?'șase😀!':'  Șase 😀 caractere  '
      assert.equal((await complete(newest,selected)).status,'completed','Exact Unicode and spaces')
      assert.equal(snapshot(person).marker,false,'Marker cleared only on confirmed save')
      const current=await login(person,selected)
      assert.equal(await rpc('current_account_session_active',{}),false,'Service without JWT has no user session')
      assert.equal(ok(await userClient(current.access_token).rpc('current_account_session_active'),'Current session guard'),true,'Current role login allowed')
    }
  })
  await probe('two_requests_and_two_completions_one_commit',['R05','R15','R27'],async()=>{
    const person=await fixture(),a=await enqueue(person),b=await enqueue(person)
    const la=await takeFor(a),lb=await takeFor(b)
    const prepared=await Promise.all([a,b].map((job,i)=>rpc('recovery_prepare_delivery',{p_job_id:job.id,p_lease_id:[la,lb][i].lease,p_email:person.email,p_token_hash:job.tokenHash})))
    assert.equal(prepared.filter(item=>item.status==='send').length,1,'One concurrent reservation')
    const proof=prepared[0].status==='send'?a:b,attempt=randomUUID()
    const outcomes=await Promise.all([complete(proof,'Chosen-'+randomUUID(),attempt),complete(proof,'Different-'+randomUUID(),randomUUID())])
    assert.equal(outcomes.filter(item=>item.status==='completed').length,1,'One concurrent finalization')
    assert.equal(snapshot(person).audit,1,'Exactly one effective audit')
    const winningAttempt=outcomes[0].status==='completed'?attempt:sql('select attempt_id from account_recovery.receipts where user_id='+q(person.id))
    assert.equal((await complete(proof,'No-second-write',winningAttempt)).status,'receipt','Lost response receipt only')
    clearCooldown(person);const newer=await issue(person)
    assert.equal((await complete(proof,'Still-no-second-write',winningAttempt)).status,'receipt','Receipt retained across generation')
    assert.equal((await inspect(proof,winningAttempt)).status,'completed','Safe reconstruction after rotation')
    assert.equal((await inspect(newer)).status,'valid','Receipt retry does not consume current generation')
  })
  await probe('expiry_after_wait_and_atomic_audit_rollback',['R10','R25','R26'],async()=>{
    const person=await fixture(),proof=await issue(person)
    await login(person)
    sql('insert into auth.one_time_tokens(id,user_id,token_type,token_hash,relates_to,created_at,updated_at) values(gen_random_uuid(),'+q(person.id)+','+q('reauthentication_token')+','+q(hash(randomUUID()))+','+q(person.email)+',clock_timestamp(),clock_timestamp())')
    seedPkce(person)
    const before=snapshot(person)
    sql("create function issue107_check.reject_audit() returns trigger language plpgsql as $$begin if NEW.entity_id="+q(person.id)+"::uuid and NEW.action_type='password_reset_completed' then raise exception 'fixture audit failure'; end if; return NEW; end$$;create trigger issue107_check_audit before insert on public.audit_logs for each row execute function issue107_check.reject_audit();")
    try {
      assert.ok((await service.rpc('recovery_complete',{p_flow_id:proof.id,p_token_hash:proof.tokenHash,p_attempt_id:randomUUID(),p_password:'Selected-'+randomUUID()})).error,'Audit failure reported')
      assert.deepEqual(snapshot(person),before,'Full commit rollback incl password, flow, marker, sessions, receipt')
    }finally{sql('drop trigger issue107_check_audit on public.audit_logs;drop function issue107_check.reject_audit();')}
    assert.equal((await complete(proof,'Changed-'+randomUUID())).status,'completed','Retry after rollback succeeds')
    assert.equal(snapshot(person).nativeFlows,0,'Successful retry removes native PKCE state with all other credentials')
    clearCooldown(person);const expiring=await issue(person)
    sql("update account_recovery.flows set expires_at=clock_timestamp()+interval '900 milliseconds' where user_id="+q(person.id))
    const holder=concurrentSql("set application_name='issue107-expiry';begin;select pg_advisory_xact_lock(105,1);select pg_sleep(1.7);commit;")
    await lockBarrier('issue107-expiry')
    assert.equal((await complete(expiring,'Rejected-'+randomUUID())).status,'invalid','Expiry checked after wait')
    assert.equal((await holder).code,0,'Lock holder completed')
  })
  await probe('lifecycle_email_admin_invalidation_permanent',['R07','R18','R19','R20','R21','R23','R35'],async()=>{
    const person=await fixture(),old=await issue(person),opened=await exchange(old)
    assert.equal(opened.data.status,'valid','Opened form')
    await lifecycle(person,false)
    assert.equal((await inspect(old)).status,'invalid','Inactive invalidation')
    await lifecycle(person,true)
    assert.equal((await inspect(old)).status,'invalid','Reactivation cannot restore')
    const next=await issue(person),original=person.email,replacement='issue107.impl.'+stamp+'.changed@example.invalid'
    ok(await service.auth.admin.updateUserById(person.id,{email:replacement}),'Native email mutation')
    ok(await service.from('profiles').update({email:replacement}).eq('id',person.id),'Canonical profile email')
    ok(await service.auth.admin.updateUserById(person.id,{email:original}),'Native email return')
    ok(await service.from('profiles').update({email:original}).eq('id',person.id),'Profile email return')
    assert.equal((await inspect(next)).status,'invalid','Email A B A permanent')
    const beforeAdmin=await issue(person)
    assert.ok((await service.auth.admin.updateUserById(person.id,{password:'Admin-'+randomUUID()})).error,'Native HTTP password mutation cannot bypass atomic path')
    sql('begin;select pg_advisory_xact_lock(105,1);select id from public.profiles where id='+q(person.id)+' for update;select id from auth.users where id='+q(person.id)+' for update;update auth.users set encrypted_password=extensions.crypt('+q('Admin-'+randomUUID())+',extensions.gen_salt('+q('bf')+',10)) where id='+q(person.id)+';commit;')
    assert.equal((await inspect(beforeAdmin)).status,'invalid','Admin change invalidates')
    const markerFlow=await issue(person)
    ok(await service.from('profiles').update({must_change_password:true}).eq('id',person.id),'Admin temporary marker')
    assert.equal((await inspect(markerFlow)).status,'invalid','Temporary marker invalidates')
    const repeated=await issue(person)
    ok(await service.from('profiles').update({must_change_password:true}).eq('id',person.id),'Repeated admin marker')
    assert.equal((await inspect(repeated)).status,'invalid','Repeated marker true invalidates')
    const pending=await issue(person)
    await complete(pending,'Self-'+randomUUID())
    assert.deepEqual(await rpc('user_account_blockers',{p_target_id:person.id}),[],'Own Auth activity not a business blocker')
    clearCooldown(person);const unused=await issue(person)
    const removed=await rpc('delete_empty_user_account',{p_target_id:person.id,p_actor_id:actor.id,p_user_agent:'issue107-implementation-check'})
    assert.ok(removed,'Account deletion result')
    assert.equal((await inspect(unused)).status,'invalid','Deleted UUID proof refused')
    assert.equal(sql('select count(*) from account_recovery.flows where user_id='+q(person.id)),'0','Operational FK cascade')
    assert.equal(sql("select count(*) from public.audit_logs where entity_id="+q(person.id)+" and action_type='password_reset_completed'"),'1','Historical audit retained')
    const reused=await fixture('client',original)
    assert.equal((await inspect(unused)).status,'invalid','Email reuse different UUID cannot restore')
    await issue(reused)
  })
  await probe('lifecycle_auth_failure_and_concurrent_order',['R17','R26','R28','R35'],async()=>{
    const person=await fixture(),proof=await issue(person)
    sql("create function issue107_check.reject_ban() returns trigger language plpgsql as $$begin if NEW.id="+q(person.id)+"::uuid and NEW.banned_until is not null then raise exception 'fixture ban failure';end if;return NEW;end$$;create trigger issue107_check_ban before update of banned_until on auth.users for each row execute function issue107_check.reject_ban();")
    try {
      await lifecycle(person,false)
      assert.equal(sql('select is_active is false and auth_sync_pending from public.profiles where id='+q(person.id)),'t','Profile blocks after Auth failure')
      assert.equal((await complete(proof,'Rejected-'+randomUUID())).status,'invalid','No recovery with pending ban')
      await lifecycle(person,true)
      assert.equal((await inspect(proof)).status,'invalid','Reactivation cannot restore with failure')
      const fresh=await issue(person)
      const first=concurrentSql("set application_name='issue107-deactivate-first';begin;select pg_advisory_xact_lock(105,1);select pg_sleep(0.6);select public.set_user_account_active("+q(person.id)+','+q(actor.id)+",false,null,'issue107-check');commit;")
      await lockBarrier('issue107-deactivate-first')
      assert.equal((await complete(fresh,'Rejected-'+randomUUID())).status,'invalid','Deactivate wins effective order')
      assert.equal((await first).code,0,'Deactivate transaction ended')
    }finally{sql('drop trigger issue107_check_ban on auth.users;drop function issue107_check.reject_ban();')}
    await lifecycle(person,true)
    const before=await login(person),newFlow=await issue(person),selected='First-'+randomUUID()
    assert.equal((await complete(newFlow,selected)).status,'completed','Reset wins first')
    await lifecycle(person,false)
    assert.equal(ok(await userClient(before.access_token).rpc('current_account_session_active'),'Old session guard'),false,'Old JWT remains revoked')
    assert.equal((await api('/api/me',{headers:{Authorization:'Bearer '+before.access_token}})).status,401,'Copied JWT denied')
    await lifecycle(person,true);await login(person,selected)
  })
  await probe('api_email_delivery_retry_uniformity_and_postcommit_fallback',['R02','R03','R04','R08','R24','R27','R28','R29','R33','R34','R35'],async()=>{
    const person=await fixture(),oldSession=await login(person),start=messages.length
    const requested=await request({email:'  '+person.email.toUpperCase()+'  '})
    assert.equal(requested.status,200,'Generic request accepted')
    const proof=await waitMessage(person,start)
    assert.match(proof.message.body.text,/valabil o oră/,'One-hour email wording')
    assert.match(proof.message.body.text,/o singură dată/,'Single-use email wording')
    assert.equal(proof.message.body.to,'recovery-test@example.invalid','Development override used')
    assert.ok(proof.message.key.startsWith('recovery/'),'Provider idempotency')
    const open=await exchange(proof),attempt=randomUUID(),selected='  Parolă 😀 exactă  ',beforeInvalid=snapshot(person)
    for(const [entered,confirmation] of [['sixsix','different'],['short','short'],['a'.repeat(73),'a'.repeat(73)],['\0sixsix','\0sixsix'],['\ud800sixsix','\ud800sixsix']]) {
      const refusal=await api('/api/auth/recovery/complete',{body:{flowId:proof.id,attemptId:attempt,password:entered,confirmation},cookie:open.cookie})
      assert.equal(refusal.status,400,'Invalid password input is controlled')
      assert.equal(refusal.data.status,'password_invalid','Invalid password input does not consume proof')
      assert.deepEqual(snapshot(person),beforeInvalid,'Password validation preserves every account mutation')
    }
    const saved=await submit(proof,open.cookie,selected,attempt)
    assert.equal(saved.data.status,'completed','Confirmed API password reset')
    assert.ok(saved.data.session?.access_token,'Verified postcommit session returned')
    assert.equal((await api('/api/me',{headers:{Authorization:'Bearer '+saved.data.session.access_token}})).status,200,'New session app access')
    assert.equal((await api('/api/me',{headers:{Authorization:'Bearer '+oldSession.access_token}})).status,401,'Old app session revoked')
    const repeated=await submit(proof,open.cookie,'Never applied',attempt)
    assert.equal(repeated.data.status,'completed','Receipt maps to confirmed outcome')
    assert.ok(!repeated.data.session,'Receipt cannot issue second session')
    clearCooldown(person);await issue(person)
    const status=await api('/api/auth/recovery/status?flowId='+proof.id+'&attemptId='+attempt,{cookie:open.cookie})
    assert.equal(status.data.status,'completed','HTTP receipt retained after rotation')
    await dispatch()
    assert.ok(messages.some(message=>(message.body.text||'').includes('Parola ta a fost schimbată. Dacă nu ai fost tu, contactează-ne.')),'Postcommit confirmation wording')
    const failure=await fixture(),failureStart=messages.length;mailMode='reject'
    await request(failure)
    await waitFor(()=>messages.length>failureStart,'Certain provider failure observed')
    await waitFor(()=>sql('select password_reset_requested_at is null from public.profiles where id='+q(failure.id))==='t','Own failed cooldown released')
    const failed=flow(failure)
    assert.ok(failed.state==='invalidated','Failed proof not restored')
    mailMode='unknown';const unknownStart=messages.length
    await request(failure)
    const unknown=await waitMessage(failure,unknownStart)
    await sleep(300)
    sql("update account_recovery.deliveries set next_attempt_at=clock_timestamp()-interval '1 second' where id="+q(unknown.id))
    await dispatch()
    assert.equal(messages.filter(message=>message.key===unknown.message.key).length,1,'Provider dedup after unknown acceptance')
    assert.equal((await inspect(unknown)).status,'valid','Unknown result preserves proof')
    const fallbackPerson=await fixture(),fallbackProof=await issue(fallbackPerson),fallbackOpen=await exchange(fallbackProof)
    sql("create function issue107_check.reject_login() returns trigger language plpgsql as $$begin if NEW.user_id="+q(fallbackPerson.id)+"::uuid then raise exception 'fixture session failure';end if;return NEW;end$$;create trigger issue107_check_login before insert on auth.sessions for each row execute function issue107_check.reject_login();")
    const fallbackPassword='Fallback-'+randomUUID()
    try {
      const result=await submit(fallbackProof,fallbackOpen.cookie,fallbackPassword)
      assert.equal(result.data.status,'completed','Login failure does not undo commit')
      assert.ok(!result.data.session,'No failed session returned')
      assert.equal(result.data.message,'Parola a fost schimbată. Autentifică-te cu noua parolă.','Postcommit fallback')
    }finally{sql('drop trigger issue107_check_login on auth.sessions;drop function issue107_check.reject_login();')}
    await login(fallbackPerson,fallbackPassword)

    const minting=await fixture(),mintingProof=await issue(minting),mintingOpen=await exchange(mintingProof),mintingPassword='FreshGuard-'+randomUUID()
    sql("create function issue107_check.disable_during_login() returns trigger language plpgsql security definer set search_path=pg_catalog as $$begin if NEW.user_id="+q(minting.id)+"::uuid then update public.profiles set is_active=false,auth_sync_pending=true where id=NEW.user_id;end if;return NEW;end$$;create trigger issue107_check_disable_mint before insert on auth.sessions for each row execute function issue107_check.disable_during_login();")
    try{
      const guarded=await submit(mintingProof,mintingOpen.cookie,mintingPassword)
      assert.equal(guarded.data.status,'completed','Postcommit deactivation keeps password outcome')
      assert.ok(!guarded.data.session,'Fresh app guard withholds even successfully minted Auth JWT')
      assert.equal(snapshot(minting).audit,1,'Commit remains effective after fresh guard refusal')
      assert.equal(snapshot(minting).sessions,1,'Native Auth actually minted private session before app guard')
    }finally{sql('drop trigger issue107_check_disable_mint on auth.sessions;drop function issue107_check.disable_during_login();')}
    await lifecycle(minting,true);await login(minting,mintingPassword)

    const unavailable=await fixture(),unavailableProof=await issue(unavailable),unavailableOpen=await exchange(unavailableProof)
    await lifecycle(unavailable,false)
    const invalid=await submit(unavailableProof,unavailableOpen.cookie,'Wrong-'+randomUUID())
    assert.equal(invalid.data.message,'Linkul de resetare nu mai este valid. Solicită un link nou sau contactează administratorul.','No account-state disclosure')
    const missing=await request({email:'issue107.impl.'+stamp+'.absent@example.invalid'})
    assert.deepEqual(missing.data,requested.data,'Uniform missing body')
    assert.equal(missing.status,requested.status,'Uniform missing status')
    assert.equal(missing.headers.get('cache-control'),requested.headers.get('cache-control'),'Uniform privacy headers')
  })

  await probe('lookup_coherence_and_audit_auth_classification',['R04','R18','R22','R23','R32'],async()=>{
    const person=await fixture(),duplicate=await fixture()
    const prepare=async email=>{
      const job=await enqueue({email}),leased=await takeFor(job)
      const result=await rpc('recovery_prepare_delivery',{p_job_id:job.id,p_lease_id:leased.lease,p_email:email,p_token_hash:job.tokenHash})
      await rpc('recovery_finish_delivery',{p_job_id:job.id,p_lease_id:leased.lease,p_outcome:'skipped'})
      return result.status
    }
    ok(await service.from('profiles').update({email:person.email}).eq('id',duplicate.id),'Duplicated profile fixture')
    assert.equal(await prepare(person.email),'skip','Duplicate canonical profiles fail closed')
    ok(await service.from('profiles').update({email:duplicate.email}).eq('id',duplicate.id),'Restore duplicate')
    const mismatch='issue107.impl.'+stamp+'.mismatch@example.invalid'
    ok(await service.from('profiles').update({email:mismatch}).eq('id',person.id),'Divergent profile fixture')
    assert.equal(await prepare(person.email),'skip','Auth profile mismatch fails closed')
    ok(await service.from('profiles').update({email:person.email}).eq('id',person.id),'Restore coherence')
    for(const address of ['issue107.impl.'+stamp+'.missing@example.invalid','%@example.invalid','_@example.invalid'])
      assert.equal(await prepare(address),'skip','Exact lookup does not expand wildcards')
    assert.equal(sql("select count(*) from public.audit_logs where action_type='password_reset_requested' and entity_id="+q(person.id)),'0','Rejected lookups have no effective request audit')
    ok(await service.from('profiles').update({must_change_password:true}).eq('id',person.id),'Marker fixture')
    const proof=await issue(person)
    ok(await service.from('profiles').update({email:'  '+person.email.toUpperCase()+'  '}).eq('id',person.id),'Cosmetic canonical email')
    assert.equal((await inspect(proof)).status,'valid','Canonical no-op email preserves proof despite true marker')
    ok(await service.from('profiles').update({email:person.email,role:'consultant',consultant_level:'junior'}).eq('id',person.id),'Current role changed during recovery')
    assert.equal((await complete(proof,'Role-'+randomUUID())).status,'completed','Recovery reads current identity and role')
    assert.equal(sql("select user_id is null and new_values->>'source'='self_recovery' from public.audit_logs where action_type='password_reset_requested' and entity_id="+q(person.id)+" order by created_at desc limit 1"),'t','Anonymous request author')
    assert.equal(snapshot(person).audit,1,'One self-auth completion')
    assert.deepEqual(await rpc('user_account_blockers',{p_target_id:person.id}),[],'Exact self-auth exemption')
    sql("begin;insert into public.audit_logs(user_id,action_type,entity_type,entity_id,description) values("+q(person.id)+",'password_reset_completed','user',"+q(person.id)+",'Missing source check');do $$begin if public.user_account_blockers("+q(person.id)+")='[]'::jsonb then raise exception 'Missing audit source must block';end if;end$$;rollback;")
    assert.deepEqual(await rpc('user_account_blockers',{p_target_id:person.id}),[],'Rollback keeps only historical self-auth')
    const banned=await fixture(),bannedProof=await issue(banned)
    for(let cycle=0;cycle<2;cycle++){await lifecycle(banned,false);await lifecycle(banned,true);assert.equal((await inspect(bannedProof)).status,'invalid','Repeated activation cycles never restore the old proof')}
    ok(await service.auth.admin.updateUserById(banned.id,{ban_duration:'1h'}),'Separate Auth ban fixture')
    assert.equal(sql('select is_active from public.profiles where id='+q(banned.id)),'t','Profile active while independent Auth ban remains')
    const bannedBefore=snapshot(banned)
    assert.equal(await prepare(banned.email),'skip','Independent Auth ban denies new recovery')
    assert.equal((await inspect(bannedProof)).status,'invalid','Independent Auth ban never restores an invalidated old flow')
    assert.equal((await complete(bannedProof,'Blocked-'+randomUUID())).status,'invalid','Independent Auth ban denies password save')
    assert.deepEqual(snapshot(banned),bannedBefore,'Auth-ban refusal has no account mutations')
    const cost=await fixture()
    for(const value of [4,11]) {
      sql('begin;update auth.users set encrypted_password=extensions.crypt('+q(password)+',extensions.gen_salt('+q('bf')+','+value+')) where id='+q(cost.id)+';commit;')
      assert.ok((await service.rpc('recovery_preflight')).error,'Incompatible native rehash costs block activation preflight')
    }
    sql('begin;update auth.users set encrypted_password=extensions.crypt('+q(password)+',extensions.gen_salt('+q('bf')+',10)) where id='+q(cost.id)+';commit;')
    for(const prefix of ['2b','2y']) {
      sql('update auth.users set encrypted_password=replace(extensions.crypt('+q(password)+',extensions.gen_salt('+q('bf')+',10)), '+q('$2a$')+','+q('$'+prefix+'$')+') where id='+q(cost.id))
      await login(cost)
      assert.ok((await service.rpc('recovery_preflight')).error,'Unproved bcrypt prefixes block activation')
      assert.equal(await prepare(cost.email),'skip','Unsupported imported hash fails closed during issuance')
    }
    sql('update auth.users set encrypted_password=extensions.crypt('+q(password)+',extensions.gen_salt('+q('bf')+',10)) where id='+q(cost.id))
    assert.equal((await rpc('recovery_preflight')).compatible,true,'Compatible hashes restored')
  })
  await probe('retry_exhaustion_preserves_possibly_delivered_proof',['R10','R24','R35'],async()=>{
    sql(fs.readFileSync('scripts/issue-107-retry-check.sql','utf8'))
  })
  await probe('lease_fencing_frozen_bytes_and_stale_generation',['R05','R06','R24','R35'],async()=>{
    const person=await fixture(),old=await enqueue(person),first=await takeFor(old)
    assert.equal((await rpc('recovery_prepare_delivery',{p_job_id:old.id,p_lease_id:first.lease,p_email:person.email,p_token_hash:old.tokenHash})).status,'send','First lease prepares')
    const frozen=encrypt({fixture:'unchanged'})
    assert.equal((await rpc('recovery_freeze_delivery',{p_job_id:old.id,p_lease_id:first.lease,p_payload_cipher:frozen})).payload_cipher,frozen,'First freeze wins')
    assert.equal((await rpc('recovery_freeze_delivery',{p_job_id:old.id,p_lease_id:first.lease,p_payload_cipher:encrypt({fixture:'later'})})).payload_cipher,frozen,'Provider bytes cannot change')
    sql("update account_recovery.deliveries set lease_expires_at=clock_timestamp()-interval '1 second' where id="+q(old.id))
    const renewed=await takeFor(old)
    assert.equal(renewed.frozen_payload_cipher,frozen,'Frozen bytes survive reclaimed lease')
    await rpc('recovery_finish_delivery',{p_job_id:old.id,p_lease_id:first.lease,p_outcome:'failed'})
    assert.equal((await inspect(old)).status,'valid','Stale worker cannot revoke proof')
    clearCooldown(person);const newest=await issue(person),issued=flow(person).issued_at
    assert.equal((await rpc('recovery_delivery_ready',{p_job_id:old.id,p_lease_id:renewed.lease})).status,'skip','Superseded worker not eligible for handoff')
    await rpc('recovery_finish_delivery',{p_job_id:old.id,p_lease_id:renewed.lease,p_outcome:'failed'})
    assert.equal((await inspect(newest)).status,'valid','Old generation failure cannot invalidate latest')
    assert.equal(sql('select password_reset_requested_at::text=('+q(issued)+'::timestamptz)::text from public.profiles where id='+q(person.id)),'t','Old failure cannot clear latest cooldown')
    assert.equal(sql('select payload_cipher is null and frozen_payload_cipher is null from account_recovery.deliveries where id='+q(old.id)),'t','Terminal secrets wiped')
  })
  await probe('confirmation_state_and_temporary_api_errors',['R25','R28','R29','R35'],async()=>{
    await dispatch()
    const person=await fixture(),proof=await issue(person),selected='Confirm-'+randomUUID(),start=messages.length
    assert.equal((await complete(proof,selected)).status,'completed','Confirmation fixture committed')
    await lifecycle(person,false);await dispatch()
    assert.equal(messages.length,start,'Inactive account confirmation omitted before handoff')
    assert.equal(sql("select state from account_recovery.deliveries where user_id="+q(person.id)+" and kind='confirmation' order by created_at desc limit 1"),'skipped','Skipped confirmation recorded')
    await lifecycle(person,true);await login(person,selected)
    const refused=await fixture(),refusedProof=await issue(refused),changed='ConfirmFail-'+randomUUID()
    await complete(refusedProof,changed);mailMode='reject';await dispatch();mailMode='success'
    assert.equal(sql("select state from account_recovery.deliveries where user_id="+q(refused.id)+" and kind='confirmation' order by created_at desc limit 1"),'failed','Confirmation failure recorded')
    await login(refused,changed)
    const unavailable=await fixture(),privateProof=await issue(unavailable),open=await exchange(privateProof)
    sql("create function issue107_check.reject_inspection() returns jsonb language plpgsql security definer set search_path=pg_catalog as $$begin raise exception 'fixture unavailable';end$$;")
    const original=sql("select pg_get_functiondef('public.recovery_inspect(uuid,text,uuid)'::regprocedure)")
    try {
      sql("create or replace function public.recovery_inspect(p_flow_id uuid,p_token_hash text,p_attempt_id uuid default null) returns jsonb language plpgsql security definer set search_path=pg_catalog as $$begin if p_flow_id="+q(privateProof.id)+"::uuid then return issue107_check.reject_inspection();end if;return account_recovery.recovery_inspect_impl(p_flow_id,p_token_hash,p_attempt_id);end$$;notify pgrst,'reload schema';")
      const status=await api('/api/auth/recovery/status?flowId='+privateProof.id+'&attemptId='+randomUUID(),{cookie:open.cookie})
      assert.equal(status.status,503,'Database outage distinct from invalid proof')
      assert.equal(status.data.status,'unavailable','Temporary outage state')
    }finally{sql(original+";drop function issue107_check.reject_inspection();notify pgrst,'reload schema';")}
    assert.equal((await inspect(privateProof)).status,'valid','Outage leaves proof reusable')
  })
  await probe('uniform_latency_and_atomic_volume_limits',['R03','R31'],async()=>{
    await dispatch()
    const active=await fixture(),inactive=await fixture(),cooldown=await fixture()
    await lifecycle(inactive,false);await issue(cooldown)
    const subkey=createHmac('sha256',key).update('platforma-fonduri/recovery/ip-hash/v1').digest()
    const subject=createHmac('sha256',subkey).update('unknown').digest('hex')
    const resetPublicBucket=()=>sql("delete from account_recovery.rate_limits where scope='ip' and subject="+q(subject))
    const addresses=[active.email,'issue107.impl.'+stamp+'.nonexistent@example.invalid',inactive.email,cooldown.email]
    const timings=addresses.map(()=>[]);let baseline
    mailMode='delay'
    try {
      for(let round=0;round<8;round++)for(let offset=0;offset<4;offset++) {
        const i=(offset+round)%4;resetPublicBucket();const before=performance.now(),response=await request({email:addresses[i]});timings[i].push(performance.now()-before)
        assert.equal(response.status,200,'Uniform request status')
        const identity={body:response.data,cache:response.headers.get('cache-control'),referrer:response.headers.get('referrer-policy'),type:response.headers.get('content-type')}
        baseline??=identity;assert.deepEqual(identity,baseline,'Uniform status/body/privacy headers')
      }
    }finally{mailMode='success';resetPublicBucket()}
    const medians=timings.map(values=>values.toSorted((a,b)=>a-b)[4])
    assert.ok(Math.max(...medians)-Math.min(...medians)<180,'No account/provider latency branch')
    results.push({name:'uniform_latency_measurements',baseUrl,ids:['R31'],passed:true,samplesPerState:8,medianMs:medians.map(value=>Math.round(value))})
    const rateSubject=hash(randomUUID()),bucket=()=>sql("select coalesce(sum(hit_count),0) from account_recovery.rate_limits where scope='ip' and subject="+q(rateSubject))
    const enqueueLimited=()=>rpc('recovery_enqueue',{p_job_id:randomUUID(),p_payload_cipher:encrypt({email:addresses[1],token:'invalid'}),p_ip_hash:rateSubject})
    for(let i=0;i<9;i++)assert.equal(await enqueueLimited(),true,'IP quota initial entries')
    const final=await Promise.all([enqueueLimited(),enqueueLimited()])
    assert.equal(final.filter(Boolean).length,1,'Atomic IP cap under concurrency');assert.equal(bucket(),'10','IP cannot overshoot')
    const rows=sql("select count(*) from account_recovery.deliveries where kind='request' and user_id is null and state='queued'")
    assert.ok(Number(rows)>=10,'Anonymous jobs queued before lookup')
    const globalBefore=sql("select coalesce(sum(hit_count),0) from account_recovery.rate_limits where scope='global'")
    sql("begin;insert into account_recovery.rate_limits(scope,subject,window_start,hit_count) values('global','all',date_trunc('hour',clock_timestamp()),1000) on conflict(scope,subject,window_start) do update set hit_count=1000;do $$begin if public.recovery_enqueue(gen_random_uuid(),'cipher','"+rateSubject+"other',null,null) then raise exception 'Global limit violated';end if;end$$;rollback;")
    assert.equal(sql("select coalesce(sum(hit_count),0) from account_recovery.rate_limits where scope='global'"),globalBefore,'Global refusal rollback does not consume IP/queue')
    await dispatch()
  })


  await probe('delivery_deadline_after_job_row_wait',['R10','R24','R35'],async()=>{
    const person=await fixture(),proof=await enqueue(person),leased=await takeFor(proof)
    await rpc('recovery_prepare_delivery',{p_job_id:proof.id,p_lease_id:leased.lease,p_email:person.email,p_token_hash:proof.tokenHash})
    sql("update account_recovery.deliveries set lease_expires_at=clock_timestamp()+interval '900 milliseconds' where id="+q(proof.id))
    const holder=concurrentSql("set application_name='issue107-job-wait';begin;select id from account_recovery.deliveries where id="+q(proof.id)+" for update;select pg_sleep(1.7);commit;")
    await waitFor(()=>sql("select exists(select 1 from pg_stat_activity where application_name='issue107-job-wait' and wait_event='PgSleep')")==='t','Job row barrier')
    assert.equal((await rpc('recovery_delivery_ready',{p_job_id:proof.id,p_lease_id:leased.lease})).status,'skip','Lease deadline checked after job-row wait')
    assert.equal((await holder).code,0,'Job lock transaction complete')
    assert.equal(await rpc('recovery_freeze_delivery',{p_job_id:proof.id,p_lease_id:leased.lease,p_payload_cipher:encrypt({fixture:'expired'})}),null,'Expired lease cannot freeze')
    const reclaimed=await takeFor(proof)
    await rpc('recovery_finish_delivery',{p_job_id:proof.id,p_lease_id:reclaimed.lease,p_outcome:'skipped'})
  })
  await probe('anonymous_request_ttl_after_account_lock_wait',['R10','R24','R35'],async()=>{
    const person=await fixture(),proof=await enqueue(person),leased=await takeFor(proof),before=snapshot(person)
    sql("update account_recovery.deliveries set expires_at=clock_timestamp()+interval '900 milliseconds' where id="+q(proof.id))
    const holder=concurrentSql("set application_name='issue107-anonymous-expiry';begin;select pg_advisory_xact_lock(105,1);select pg_sleep(1.7);commit;")
    await lockBarrier('issue107-anonymous-expiry')
    assert.equal((await rpc('recovery_prepare_delivery',{p_job_id:proof.id,p_lease_id:leased.lease,p_email:person.email,p_token_hash:proof.tokenHash})).status,'skip','Expired anonymous job cannot issue after lock wait')
    assert.equal((await holder).code,0,'Anonymous TTL lock transaction complete')
    assert.deepEqual(snapshot(person),before,'Expired anonymous request has no account effects')
    await rpc('recovery_finish_delivery',{p_job_id:proof.id,p_lease_id:leased.lease,p_outcome:'skipped'})
  })
  await probe('request_audit_rollback_and_missing_profile',['R02','R04','R26','R32'],async()=>{
    const person=await fixture(),proof=await enqueue(person),leased=await takeFor(proof)
    sql("create function issue107_check.reject_request_audit() returns trigger language plpgsql as $$begin if NEW.entity_id="+q(person.id)+"::uuid and NEW.action_type='password_reset_requested' then raise exception 'fixture request audit failure';end if;return NEW;end$$;create trigger issue107_check_request_audit before insert on public.audit_logs for each row execute function issue107_check.reject_request_audit();")
    try{
      assert.ok((await service.rpc('recovery_prepare_delivery',{p_job_id:proof.id,p_lease_id:leased.lease,p_email:person.email,p_token_hash:proof.tokenHash})).error,'Request audit failure rejects issuance')
      assert.equal(flow(person),null,'No flow after audit rollback')
      assert.equal(sql('select password_reset_requested_at is null and must_change_password is false from public.profiles where id='+q(person.id)),'t','No request-side password/marker/cooldown change')
    }finally{sql('drop trigger issue107_check_request_audit on public.audit_logs;drop function issue107_check.reject_request_audit();')}
    await rpc('recovery_finish_delivery',{p_job_id:proof.id,p_lease_id:leased.lease,p_outcome:'failed'})
    const absent=await fixture(),profile=ok(await service.from('profiles').select('*').eq('id',absent.id).single(),'Missing profile snapshot')
    ok(await service.from('profiles').delete().eq('id',absent.id),'Missing profile fixture')
    const missing=await enqueue(absent),ml=await takeFor(missing)
    assert.equal((await rpc('recovery_prepare_delivery',{p_job_id:missing.id,p_lease_id:ml.lease,p_email:absent.email,p_token_hash:missing.tokenHash})).status,'skip','Missing profile fails closed')
    await rpc('recovery_finish_delivery',{p_job_id:missing.id,p_lease_id:ml.lease,p_outcome:'skipped'})
    ok(await service.from('profiles').insert(profile),'Restore missing profile')
  })

  await probe('browser_public_refresh_identity_mobile',['R08','R09','R11','R12','R13','R28','R34'],async()=>{
    browser=await chromium.launch()
    const b=await fixture(),a=await fixture(),proof=await issue(a),sessionB=await login(b)
    const context=await browser.newContext(),page=await context.newPage()
    checkStage='browser.login';await page.goto(baseUrl+'/login')
    await page.evaluate(({session,url})=>localStorage.setItem('sb-'+new URL(url).hostname.split('.')[0]+'-auth-token',JSON.stringify(session)),{session:sessionB,url:env.E2E_SUPABASE_URL})
    checkStage='browser.B.init';await page.reload();await page.waitForURL(baseUrl+'/')
    const urls=[];page.on('request',request=>urls.push(request.url()))
    const before=snapshot(a).sessions
    checkStage='browser.A.open';await page.goto(baseUrl+'/reset-password#token='+proof.token)
    await page.locator('input[autocomplete="new-password"]').first().waitFor()
    assert.equal(new URL(page.url()).hash,'','Fragment removed immediately')
    assert.equal(snapshot(a).sessions,before,'Page GET/exchange not a login')
    assert.equal(await page.evaluate(()=>Object.values(sessionStorage).some(value=>/\.[A-Za-z0-9_-]{43}/.test(value))),false,'No raw proof in sessionStorage')
    assert.equal(urls.some(url=>url.includes(proof.token)),false,'Secret absent from HTTP URLs')
    checkStage='browser.A.reload';await page.reload();await page.locator('input[autocomplete="new-password"]').first().waitFor()
    assert.equal(ok(await userClient(sessionB.access_token).rpc('current_account_session_active'),'B preserved'),true,'B intact before A save')
    const selected='Browser-'+randomUUID()
    await page.locator('input[autocomplete="new-password"]').nth(0).fill(selected)
    await page.locator('input[autocomplete="new-password"]').nth(1).fill(selected)
    checkStage='browser.A.save';await page.getByRole('button',{name:/Salvează|Schimbă parola/}).click()
    await page.waitForURL(baseUrl+'/')
    const identity=await page.evaluate(()=>{const raw=Object.keys(localStorage).find(key=>key.startsWith('sb-')&&key.endsWith('-auth-token'));return raw?JSON.parse(localStorage.getItem(raw)).user.id:null})
    assert.equal(identity,a.id,'Explicit browser identity switched to A')
    assert.equal(ok(await userClient(sessionB.access_token).rpc('current_account_session_active'),'B server unchanged'),true,'Recovery only mutates A')
    checkStage='browser.invalid';await page.goto(baseUrl+'/reset-password#token='+randomUUID()+'.'+randomBytes(32).toString('base64url'))
    await page.getByText('Linkul de resetare nu mai este valid. Solicită un link nou sau contactează administratorul.').waitFor()
    const afterInvalid=await page.evaluate(()=>{const raw=Object.keys(localStorage).find(key=>key.startsWith('sb-')&&key.endsWith('-auth-token'));return raw?JSON.parse(localStorage.getItem(raw)).user.id:null})
    assert.equal(afterInvalid,a.id,'Invalid link leaves existing session')
    await context.close()
    const mobile=await browser.newContext({viewport:{width:390,height:844}}),mobilePage=await mobile.newPage(),mobileProof=await issue(await fixture())
    checkStage='browser.mobile';await mobilePage.goto(baseUrl+'/forgot-password')
    await mobilePage.getByRole('textbox',{name:'Email'}).waitFor()
    await mobilePage.keyboard.press('Tab')
    assert.ok(await mobilePage.evaluate(()=>document.activeElement!==document.body),'Keyboard focus available')
    await mobilePage.goto(baseUrl+'/reset-password#token='+mobileProof.token)
    await mobilePage.locator('input[autocomplete="new-password"]').first().waitFor()
    assert.equal(await mobilePage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Mobile fits viewport')
    await mobile.close()
  })
  await probe('browser_lost_response_fallback_and_installation_race',['R11','R13','R27','R28','R34'],async()=>{
    browser??=await chromium.launch()
    const b=await fixture(),a=await fixture(),sessionB=await login(b),proof=await issue(a)
    const storageKey='sb-'+new URL(env.E2E_SUPABASE_URL).hostname.split('.')[0]+'-auth-token'
    const context=await browser.newContext()
    await context.addInitScript(({key,session})=>{if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(session))},{key:storageKey,session:sessionB})
    const page=await context.newPage()
    let releaseB,releaseA,heldB=false,heldA=false
    const bGate=new Promise(resolve=>releaseB=resolve),aGate=new Promise(resolve=>releaseA=resolve)
    await page.route('**/api/me',async route=>{
      if(!heldB&&route.request().headers().authorization==='Bearer '+sessionB.access_token){
        heldB=true;await bGate;await route.fulfill({status:401,contentType:'application/json',body:'{"error":"Expired previous session"}'});return
      }await route.continue()
    })
    await page.route('**/auth/v1/user',async route=>{
      if(!heldA&&route.request().headers().authorization!=='Bearer '+sessionB.access_token){heldA=true;await aGate}
      await route.continue()
    })
    try{
      checkStage='browser.race.open'
      await page.goto(baseUrl+'/reset-password#token='+proof.token)
      await page.locator('input[autocomplete="new-password"]').first().waitFor()
      await waitFor(()=>heldB,'Previous identity request is held')
      const selected='Race-'+randomUUID()
      await page.locator('input[autocomplete="new-password"]').nth(0).fill(selected)
      await page.locator('input[autocomplete="new-password"]').nth(1).fill(selected)
      await page.locator('button[type="submit"]').click()
      await waitFor(()=>heldA,'SDK installation request is held')
      checkStage='browser.race.old401'
      releaseB();await sleep(250)
      assert.equal(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).user.id,storageKey),b.id,'B persists until installation completes')
      releaseA();await page.waitForURL(baseUrl+'/');await sleep(250)
      assert.equal(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).user.id,storageKey),a.id,'Delayed B error cannot queue logout of A')
    }finally{releaseB();releaseA();await context.close()}
    const lost=await fixture(),lostProof=await issue(lost),lostContext=await browser.newContext()
    await lostContext.addInitScript(({key,session})=>localStorage.setItem(key,JSON.stringify(session)),{key:storageKey,session:sessionB})
    const lostPage=await lostContext.newPage(),selected='Lost-'+randomUUID()
    await lostPage.route('**/api/auth/recovery/complete',async route=>{
      const response=await route.fetch()
      assert.equal(response.status(),200,'Server committed before loss')
      await route.abort('failed')
    })
    try{
      checkStage='browser.lost.response'
      await lostPage.goto(baseUrl+'/reset-password#token='+lostProof.token)
      await lostPage.locator('input[autocomplete="new-password"]').first().waitFor()
      await lostPage.locator('input[autocomplete="new-password"]').nth(0).fill(selected)
      await lostPage.locator('input[autocomplete="new-password"]').nth(1).fill(selected)
      await lostPage.locator('button[type="submit"]').click()
      const fallback='Parola a fost schimbată. Autentifică-te cu noua parolă.'
      await lostPage.getByText(fallback,{exact:true}).waitFor()
      assert.equal(snapshot(lost).audit,1,'Lost response exactly one commit/audit')
      assert.equal(await lostPage.evaluate(key=>JSON.parse(localStorage.getItem(key)).user.id,storageKey),b.id,'Receipt alone does not switch B to A')
      await lostPage.reload();await lostPage.getByText(fallback,{exact:true}).waitFor()
      await lostPage.getByRole('link',{name:/autentificare/i}).click()
      await lostPage.waitForURL(baseUrl+'/login?recovery=complete');await sleep(200)
      assert.equal(new URL(lostPage.url()).pathname,'/login','B does not prevent fallback login for A')
      await lostPage.locator('input[autocomplete="username"]').fill(lost.email)
      await lostPage.locator('input[autocomplete="current-password"]').fill(selected)
      await lostPage.locator('button[type="submit"]').click();await lostPage.waitForURL(baseUrl+'/')
      assert.equal(await lostPage.evaluate(key=>JSON.parse(localStorage.getItem(key)).user.id,storageKey),lost.id,'Manual login reaches changed account')
    }finally{await lostContext.close()}
    const failed=await fixture(),failedProof=await issue(failed),failedContext=await browser.newContext()
    await failedContext.addInitScript(({key,session})=>localStorage.setItem(key,JSON.stringify(session)),{key:storageKey,session:sessionB})
    const failedPage=await failedContext.newPage(),failedPassword='InstallFail-'+randomUUID()
    await failedPage.route('**/auth/v1/user',async route=>{
      if(route.request().headers().authorization!=='Bearer '+sessionB.access_token){await route.fulfill({status:403,contentType:'application/json',body:'{"message":"Fixture install refusal","code":"bad_jwt"}'});return}
      await route.continue()
    })
    try{
      checkStage='browser.install.failure'
      await failedPage.goto(baseUrl+'/reset-password#token='+failedProof.token)
      await failedPage.locator('input[autocomplete="new-password"]').first().waitFor()
      await failedPage.locator('input[autocomplete="new-password"]').nth(0).fill(failedPassword)
      await failedPage.locator('input[autocomplete="new-password"]').nth(1).fill(failedPassword)
      await failedPage.locator('button[type="submit"]').click()
      await failedPage.getByText('Parola a fost schimbată. Autentifică-te cu noua parolă.',{exact:true}).waitFor()
      assert.equal(await failedPage.evaluate(key=>JSON.parse(localStorage.getItem(key)).user.id,storageKey),b.id,'Failed install keeps B')
      await login(failed,failedPassword)
    }finally{await failedContext.close()}
  })

} finally {
  mailMode='success'
  if(browser)await browser.close()
  if(hookStarted)execFileSync('docker',['rm','-f','issue107_implementation_auth'],{windowsHide:true,stdio:'pipe'})
  sql('drop schema if exists issue107_check cascade;')
  for(const person of fixtures.toReversed()){
    assert.ok(person.email.startsWith('issue107.impl.'+stamp+'.')&&person.email.endsWith('@example.invalid'),'Fixture cleanup scope')
    sql('delete from auth.flow_state where user_id='+q(person.id)+' or linking_target_id='+q(person.id))
    const deleted=await service.auth.admin.deleteUser(person.id)
    if(deleted.error&&deleted.error.status!==404){
      ok(await service.from('profiles').update({is_active:false}).eq('id',person.id),'Safe fixture cleanup')
    }
  }
  await new Promise(resolve=>mock.close(resolve))
}
let reported=results
if(process.env.ISSUE107_CHECK_ONLY&&fs.existsSync('docs/issue-107-implementation-results.json')){const prior=JSON.parse(fs.readFileSync('docs/issue-107-implementation-results.json','utf8'));const replaced=new Set(results.map(item=>item.name));reported=[...prior.cases.filter(item=>!replaced.has(item.name)),...results]}
fs.writeFileSync('docs/issue-107-implementation-results.json',JSON.stringify({date:new Date().toISOString(),environment:{baseUrl,auth:'v2.197.0',postgres:'17.6',sdk:'2.90.0'},cases:reported,passed:reported.filter(item=>item.passed).length,total:reported.length},null,2)+'\n')
assert.ok(results.length>0&&results.every(item=>item.passed),'Independent checks must all pass')
