const http=require('node:http');
const {randomBytes,randomUUID,timingSafeEqual,createHash}=require('node:crypto');
const MAX_SOURCE=1024*1024;
const terminal=new Set(['finished','cancelled','expired','interrupted']);
const normalized=s=>s.replace(/\r\n?/g,'\n');
const sourceHash=s=>createHash('sha256').update(normalized(s)).digest('hex');
function parseProblem(input){
 const text=String(input||'').trim();let m;
 if(/^https?:/i.test(text)){
  const url=new URL(text);if(url.protocol!=='https:'||url.hostname!=='codeforces.com')throw Error('只接受 Codeforces HTTPS 题目链接。');
  m=url.pathname.match(/^\/(?:problemset\/problem\/(\d+)|contest\/(\d+)\/problem)\/([A-Za-z]\d*)\/?$/);
  if(m)return {contestId:Number(m[1]||m[2]),index:m[3].toUpperCase()};
 }else {m=text.match(/^(\d+)\s*[/ -]?\s*([A-Za-z]\d*)$/);if(m)return {contestId:Number(m[1]),index:m[2].toUpperCase()};}
 throw Error('请输入题号（例如 2246A）或 CF 题目链接。');
}
const validProblem=p=>Number.isSafeInteger(p?.contestId)&&p.contestId>0&&/^[A-Z]\d*$/.test(p.index);
function publicTask(task){const {source,...metadata}=task;return structuredClone(metadata);}
class Bridge {
 constructor({tasks=[],credentials=null,onChange=()=>{},saveCredentials=async()=>{},now=Date.now}={}){
  this.tasks=tasks.map(t=>{const resume=['submitted','judging'].includes(t.state)||t.state==='interrupted'&&t.submissionId;return {...publicTask(t),state:resume?t.submissionId?'judging':'submitted':terminal.has(t.state)?t.state:'interrupted',detail:resume?'VS Code 已恢复，继续接收网页反馈；不会重新提交代码。':terminal.has(t.state)?t.detail:'VS Code 已重启，请重新准备代码或在 CF 查看原提交。'};});
  this.credentials=credentials;this.onChange=onChange;this.saveCredentials=saveCredentials;this.now=now;this.context={};this.lastSeen=0;this.commands=[];
 }
 notify(){this.onChange(this.tasks.map(publicTask));}
 issuePairing(){this.pairCode=randomBytes(24).toString('base64url');this.pairExpires=this.now()+300000;return `cfe-pair:${this.port}:${this.pairCode}`;}
 async revoke(){this.credentials=null;this.pairCode=null;this.lastSeen=0;await this.saveCredentials(null);this.notify();}
 createTask({source,sourceName,problem,language,sessionId=null,autoSubmit=false,mode='contest'}){
  if(typeof source!=='string'||!source.trim()||Buffer.byteLength(source)>MAX_SOURCE)throw Error('代码不能为空，且最多 1 MiB。');
  if(!validProblem(problem))throw Error('目标题目无效。');
  if(!['cpp23','cpp20','cpp17','python3','pypy3','java21','rust','manual'].includes(language))throw Error('语言无效。');
  if(this.tasks.filter(t=>!terminal.has(t.state)).length>=20)throw Error('未完成任务最多 20 个，请先取消或完成旧任务。');
  if(autoSubmit&&this.tasks.some(t=>['queued','opened','prepared','submitted','judging'].includes(t.state)&&t.autoSubmit&&t.problem.contestId===problem.contestId&&t.problem.index===problem.index&&t.language===language&&t.hash===sourceHash(source)))throw Error('相同代码和题目的提交正在处理中，请等待结果。');
  const task={id:randomUUID(),created:this.now(),source,sourceName:String(sourceName).slice(0,200),problem,language,sessionId,mode:mode==='random'?'random':'contest',autoSubmit:!!autoSubmit,hash:sourceHash(source),state:'queued',detail:'等待浏览器领取代码快照'};
  this.tasks.unshift(task);this.notify();return publicTask(task);
 }
 cancel(id){const t=this.tasks.find(t=>t.id===id);if(t&&!terminal.has(t.state)){t.state='cancelled';t.detail='已取消跟踪；已经发送给 CF 的提交不会撤回';delete t.source;this.notify();}}
 authenticate(req){const c=this.credentials;if(!c)return false;const token=String(req.headers.authorization||'').replace(/^Bearer /,'');const origin=req.headers.origin;
  return req.headers['x-cfe-client']===c.extensionId&&(!origin||origin===`chrome-extension://${c.extensionId}`)&&/^[A-Za-z0-9_-]{43}$/.test(token)&&token.length===c.token.length&&timingSafeEqual(Buffer.from(token),Buffer.from(c.token));
 }
 async start(port=0){
  this.server=http.createServer((req,res)=>this.handle(req,res).catch(()=>{if(!res.headersSent)this.reply(res,500,{error:'本机服务处理失败'});else res.end();}));
  await new Promise((resolve,reject)=>{this.server.once('error',reject);this.server.listen(port,'127.0.0.1',resolve);});this.port=this.server.address().port;return this.port;
 }
 async close(){if(this.server)await new Promise(resolve=>this.server.close(resolve));}
 reply(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));}
 async handle(req,res){
  if(req.headers.host!==`127.0.0.1:${this.port}`)return this.reply(res,403,{error:'Invalid host'});
  if(req.method!=='POST'||req.headers['content-type']!=='application/json')return this.reply(res,405,{error:'JSON POST required'});
  if(req.headers.origin&&!/^chrome-extension:\/\/[a-p]{32}$/.test(req.headers.origin))return this.reply(res,403,{error:'Extension origin required'});
  if(req.url!=='/pair'&&!this.authenticate(req))return this.reply(res,401,{error:'配对已失效，请重新配对'});
  let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>2*1024*1024)return this.reply(res,413,{error:'Body too large'});chunks.push(chunk);}
  let body;try{body=JSON.parse(Buffer.concat(chunks).toString());}catch{return this.reply(res,400,{error:'Invalid JSON'});}
  if(!body||typeof body!=='object'||Array.isArray(body))return this.reply(res,400,{error:'JSON object required'});
  if(req.url==='/pair'){
   if(!this.pairCode||this.now()>this.pairExpires||! /^[A-Za-z0-9_-]{32}$/.test(body.code||'')||body.code.length!==this.pairCode.length||!timingSafeEqual(Buffer.from(body.code),Buffer.from(this.pairCode))||! /^[a-p]{32}$/.test(body.extensionId)||req.headers['x-cfe-client']!==body.extensionId)return this.reply(res,403,{error:'配对码无效或已过期，请在 VS Code 重新生成'});
   if(req.headers.origin&&req.headers.origin!==`chrome-extension://${body.extensionId}`)return this.reply(res,403,{error:'Origin mismatch'});
   this.credentials={extensionId:body.extensionId,token:randomBytes(32).toString('base64url')};this.pairCode=null;await this.saveCredentials(this.credentials);this.lastSeen=this.now();this.notify();return this.reply(res,200,{token:this.credentials.token,version:1});
  }
  this.lastSeen=this.now();
  if(req.url==='/poll'){
   if(body.context)this.context={problem:validProblem(body.context.problem)?body.context.problem:this.context.problem,handle:String(body.context.handle||'').slice(0,24),sessions:Array.isArray(body.context.sessions)?body.context.sessions.slice(0,20):[],samples:Array.isArray(body.context.samples)?body.context.samples.slice(0,20):[],autoSubmit:body.context.autoSubmit===true,protocolVersion:Number(body.context.protocolVersion)||1,sessionId:body.context.sessionId||null,mode:body.context.mode==='random'?'random':'contest',updated:this.now()};
   for(const t of this.tasks)if(!terminal.has(t.state)&&this.now()-t.created>86400000){t.state='expired';delete t.source;}
   const task=this.tasks.find(t=>['queued','opened'].includes(t.state)&&t.source);return this.reply(res,200,{capabilities:{webFeedback:true},task:task?structuredClone(task):null,commands:this.commands.splice(0),cancelled:this.tasks.filter(t=>terminal.has(t.state)).map(t=>t.id)});
  }
  if(req.url==='/event'){
   if(body.type==='observed'){
    if(!validProblem(body.problem)||!Number.isSafeInteger(body.submissionId)||body.submissionId<=0||!/^[A-Za-z0-9_.-]{3,24}$/.test(body.handle||'')||!/^[A-Z_]{2,50}$/.test(body.verdict||''))return this.reply(res,400,{error:'Invalid web submission'});
    let found=this.tasks.find(t=>t.submissionId===body.submissionId);if(!found){found={id:'web:'+body.submissionId,origin:'browser',created:this.now(),problem:body.problem,sourceName:'网页提交',language:'网页选择',submissionId:body.submissionId,handle:body.handle};this.tasks.push(found);}
    if(found.state==='finished'&&body.verdict==='TESTING')return this.reply(res,200,{ignored:true});
    Object.assign(found,{verdict:body.verdict,state:body.verdict==='TESTING'?'judging':'finished',timeMs:Number(body.timeMs)||0,memoryBytes:Number(body.memoryBytes)||0,passedTests:Number(body.passedTests)||0,detail:'网页提交 · '+body.verdict,updated:this.now()});this.tasks.sort((a,b)=>{const ap=!a.submissionId&&!terminal.has(a.state),bp=!b.submissionId&&!terminal.has(b.state);return ap!==bp?ap?-1:1:a.submissionId&&b.submissionId?b.submissionId-a.submissionId:(b.created||0)-(a.created||0);});this.tasks=this.tasks.slice(0,200);this.notify();return this.reply(res,200,{ok:true});
   }
   const task=this.tasks.find(t=>t.id===body.id);if(!task)return this.reply(res,404,{error:'Task not found'});
   if(terminal.has(task.state)&&!(task.state==='interrupted'&&body.type==='bound'))return this.reply(res,200,{ignored:true});
   if(body.type==='bound'){
    if(!['submitted','judging','interrupted'].includes(task.state))return this.reply(res,409,{error:'Task has not been submitted'});
    if(!Number.isSafeInteger(body.submissionId)||body.submissionId<=0||! /^[A-Za-z0-9_.-]{3,24}$/.test(body.handle||''))return this.reply(res,400,{error:'Invalid submission'});
    if(task.submissionId&&task.submissionId!==body.submissionId)return this.reply(res,409,{error:'任务已经关联其他提交'});
    this.tasks=this.tasks.filter(other=>other===task||other.origin!=='browser'||other.submissionId!==body.submissionId);task.submissionId=body.submissionId;task.handle=body.handle;task.state='judging';task.attention=false;delete task.source;
   }else if(body.type==='verdict'){
    if(!task.submissionId||task.submissionId!==body.submissionId)return this.reply(res,409,{error:'Submission mismatch'});
    if(!/^[A-Z_]{2,50}$/.test(body.verdict||''))return this.reply(res,400,{error:'Invalid verdict'});
    Object.assign(task,{verdict:body.verdict,passedTests:Number(body.passedTests)||0,timeMs:Number(body.timeMs)||0,memoryBytes:Number(body.memoryBytes)||0,state:body.verdict==='TESTING'?'judging':'finished'});delete task.source;
   }else if(body.type==='state'){
    const transitions={queued:['opened','error'],opened:['prepared','error'],prepared:['submitted','error'],submitted:['error'],error:['opened','prepared']};
    if(!transitions[task.state]?.includes(body.state)&&task.state!==body.state)return this.reply(res,409,{error:'Invalid state transition'});task.state=body.state;task.attention=body.attention===true;
   }else return this.reply(res,400,{error:'Unknown event'});
   task.detail=String(body.detail||task.state).slice(0,300);task.updated=this.now();this.notify();return this.reply(res,200,{ok:true});
  }
  return this.reply(res,404,{error:'Not found'});
 }
}
module.exports={Bridge,parseProblem,sourceHash,publicTask,validProblem,terminal};
