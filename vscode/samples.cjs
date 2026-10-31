const {spawn}=require('node:child_process');
const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');
function execute(command,args,{input='',timeout=3000,maxOutput=1024*1024,signal,cwd}={}){
 return new Promise((resolve,reject)=>{
  if(signal?.aborted){resolve({code:null,stdout:'',stderr:'',reason:'已停止',timeMs:0});return;}
  const started=Date.now(),child=spawn(command,args,{windowsHide:true,shell:false,cwd}),out=[],err=[];let size=0,reason=null,killed=false;
  function kill(){if(killed||child.exitCode!==null||child.signalCode!==null||!Number.isSafeInteger(child.pid))return;killed=true;if(process.platform==='win32'){const killer=spawn('taskkill',['/pid',String(child.pid),'/T','/F'],{windowsHide:true,shell:false,stdio:'ignore'});killer.on('error',()=>child.kill());}else child.kill('SIGKILL');}
  const abort=()=>{reason='已停止';kill();};signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>{reason='运行超时';kill();},timeout);
  const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
  const collect=list=>chunk=>{const remaining=Math.max(0,maxOutput-size);if(remaining)list.push(chunk.subarray(0,remaining));size+=chunk.length;if(size>maxOutput){reason='输出超过 1 MiB';kill();}};
  child.stdout.on('data',collect(out));child.stderr.on('data',collect(err));child.once('error',e=>{cleanup();reject(Error('无法启动 '+command+'：'+e.message));});child.once('close',code=>{cleanup();resolve({code,stdout:Buffer.concat(out).toString(),stderr:Buffer.concat(err).toString(),reason,timeMs:Date.now()-started});});child.stdin.on('error',()=>{});child.stdin.end(input);
 });
}
const sameOutput=(a,b)=>a.replace(/\r/g,'').trimEnd()===b.replace(/\r/g,'').trimEnd();
async function runSamples(source,samples,{compiler='g++',timeout=3000,onResult=()=>{}}={}){
 if(!Array.isArray(samples)||!samples.length)throw Error('网页没有提供样例，请先在 Chrome 打开题目页。');
 const temporaryRoot=await fs.realpath(os.tmpdir());
 const dir=await fs.mkdtemp(path.join(temporaryRoot,'cf-enhance-')),sourcePath=path.join(dir,'main.cpp'),binary=path.join(dir,process.platform==='win32'?'program.exe':'program');
 try{await fs.writeFile(sourcePath,source);const compile=await execute(compiler,['-std=c++23','-O2',sourcePath,'-o',binary],{timeout:30000});if(compile.code!==0||compile.reason)throw Error('编译失败：'+(compile.reason||compile.stderr));
  const results=[];for(let i=0;i<samples.length;i++){const r=await execute(binary,[],{input:samples[i].input,timeout});const result={sample:i+1,...r,expected:samples[i].output,passed:r.code===0&&!r.reason&&sameOutput(r.stdout,samples[i].output)};results.push(result);onResult(result);}return results;
 }finally{if(path.dirname(path.resolve(dir))===temporaryRoot&&path.basename(dir).startsWith('cf-enhance-'))await fs.rm(dir,{recursive:true,force:true}).catch(()=>{});}
}
module.exports={execute,sameOutput,runSamples};
