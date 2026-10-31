const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');const {execute}=require('./samples.cjs');
function compareOutput(actual,expected,mode='tokens'){const normalize=s=>s.replace(/\r\n?/g,'\n');if(mode==='exact')return normalize(actual).trimEnd()===normalize(expected).trimEnd();return JSON.stringify(normalize(actual).trim().split(/\s+/).filter(Boolean))===JSON.stringify(normalize(expected).trim().split(/\s+/).filter(Boolean));}
async function runCases(snapshot,cases,{compiler='g++',cCompiler='gcc',python='python',timeout=3000,comparison='tokens',signal,onResult=()=>{}}={}){
 if(typeof snapshot.source!=='string'||!snapshot.source.trim()||Buffer.byteLength(snapshot.source)>1024*1024)throw Error('代码不能为空且最多 1 MiB');
 if(!['cpp','c','python'].includes(snapshot.languageId))throw Error('本地测试支持 C++、C 和 Python；其他语言仍可使用网页提交。');
 if(!Array.isArray(cases)||!cases.length)throw Error('请先添加用例或同步网页样例');
 if(!Number.isInteger(timeout)||timeout<100||timeout>30000)throw Error('测试时限应为 100–30000 毫秒');
 const root=await fs.realpath(os.tmpdir()),dir=await fs.mkdtemp(path.join(root,'cf-enhance-judge-'));const ext={cpp:'cpp',c:'c',python:'py'}[snapshot.languageId];const source=path.join(dir,'main.'+ext),binary=path.join(dir,process.platform==='win32'?'program.exe':'program');
 const cwd=snapshot.fileName&&path.isAbsolute(snapshot.fileName)?path.dirname(snapshot.fileName):dir;const result=[];
 try{await fs.writeFile(source,snapshot.source);if(signal?.aborted)return {cancelled:true,results:[]};
  if(ext!=='py'){const command=ext==='cpp'?compiler:cCompiler;const args=[ext==='cpp'?'-std=c++23':'-std=c17','-O2',source,'-o',binary,...(cwd!==dir?['-I',cwd]:[])];const compiled=await execute(command,args,{timeout:30000,signal,cwd});if(signal?.aborted)return {cancelled:true,results:[]};if(compiled.code!==0||compiled.reason)return {compileError:compiled.reason||compiled.stderr||compiled.stdout||'编译失败',results:[]};}
  for(const c of cases){if(signal?.aborted)break;const r=await execute(ext==='py'?python:binary,ext==='py'?[source]:[],{input:c.input,timeout,signal,cwd});const status=signal?.aborted?'cancelled':r.reason==='运行超时'?'timeout':r.reason?'outputLimit':r.code!==0?'runtimeError':!c.compare?'output':compareOutput(r.stdout,c.expected,comparison)?'passed':'wrongAnswer';const row={id:c.id,revision:c.revision,status,...r,expected:c.expected};result.push(row);onResult(row);if(signal?.aborted)break;}
  return {cancelled:!!signal?.aborted,results:result};
 }finally{if(path.dirname(path.resolve(dir))===root&&path.basename(dir).startsWith('cf-enhance-judge-'))await fs.rm(dir,{recursive:true,force:true}).catch(()=>{});}
}
module.exports={runCases,compareOutput};
