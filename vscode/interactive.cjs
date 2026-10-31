const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process'),{execute}=require('./samples.cjs');
class InteractiveSession{
 constructor(onChange=()=>{}){this.onChange=onChange;this.state={status:'idle',logs:[],stdinClosed:false};this.bytes=0;this.closed=false;}
 notify(){this.onChange(this.state);}
 log(kind,text){if(!text)return;const bytes=Buffer.byteLength(text),remaining=1024*1024-this.bytes;this.bytes+=bytes;if(remaining<=0)return;if(this.state.logs.length>=2000){this.bytes=1024*1024+1;return;}const safe=bytes<=remaining?text:Buffer.from(text).subarray(0,remaining).toString('utf8');const last=this.state.logs.at(-1);if(last?.kind===kind)last.text+=safe;else this.state.logs.push({kind,text:safe,id:this.state.logs.length});this.notify();}
 async start(snapshot,{compiler='g++',cCompiler='gcc',python='python',timeout=120000}={}){
  if(this.closed)throw Error('窗口已关闭');if(['compiling','running'].includes(this.state.status))throw Error('请先停止当前程序');
  if(!['cpp','c','python'].includes(snapshot.languageId)||typeof snapshot.source!=='string'||!snapshot.source.trim()||Buffer.byteLength(snapshot.source)>1024*1024)throw Error('交互测试支持最多 1 MiB 的 C/C++/Python 代码');
  if(!Number.isInteger(timeout)||timeout<1000||timeout>600000)throw Error('交互会话时限应为 1000–600000ms');
  await this.cleanup();this.killing=false;this.bytes=0;this.state={status:'compiling',logs:[],stdinClosed:false,sourceName:snapshot.sourceName};this.controller=new AbortController();this.notify();
  this.preparing=this.prepare(snapshot,{compiler,cCompiler,python,timeout});return this.preparing;
 }
 async prepare(snapshot,{compiler,cCompiler,python,timeout}){
  try{
   this.root=await fs.realpath(os.tmpdir());this.dir=await fs.mkdtemp(path.join(this.root,'cf-enhance-interactive-'));const ext={cpp:'cpp',c:'c',python:'py'}[snapshot.languageId],source=path.join(this.dir,'main.'+ext),binary=path.join(this.dir,process.platform==='win32'?'program.exe':'program'),cwd=snapshot.fileName?path.dirname(snapshot.fileName):this.dir;
   await fs.writeFile(source,snapshot.source);
   if(this.controller.signal.aborted){this.state.status='stopped';return;}
   if(ext!=='py'){const built=await execute(ext==='cpp'?compiler:cCompiler,[ext==='cpp'?'-std=c++23':'-std=c17','-O2',source,'-o',binary,...(cwd!==this.dir?['-I',cwd]:[])],{cwd,timeout:30000,signal:this.controller.signal});
    if(this.controller.signal.aborted){this.state.status='stopped';return;}if(built.code!==0||built.reason)throw Error(built.reason||built.stderr||built.stdout||'编译失败');}
   if(this.controller.signal.aborted){this.state.status='stopped';return;}
   const child=spawn(ext==='py'?python:binary,ext==='py'?['-u',source]:[],{cwd,windowsHide:true,shell:false});this.child=child;this.state.status='running';this.notify();
   let done=false;this.exited=new Promise(resolve=>{
    const finish=(code,signal,error)=>{if(done)return;done=true;clearTimeout(this.timer);this.child=null;this.state.stdinClosed=true;this.state.status=this.reason?'stopped':error?'error':'finished';this.state.exitCode=code;this.state.signal=signal;if(error)this.log('error',error.message);this.notify();resolve();};
    for(const [stream,kind]of [[child.stdout,'out'],[child.stderr,'error']]){stream.setEncoding('utf8');stream.on('data',text=>{this.log(kind,text);if(this.bytes>1024*1024)this.stop('输出超过 1 MiB');});}
    child.stdin.on('error',()=>{this.state.stdinClosed=true;this.notify();});child.once('error',error=>finish(null,null,error));child.once('close',(code,signal)=>finish(code,signal));
   });
   this.reason=null;this.timer=setTimeout(()=>this.stop('达到交互会话时限'),timeout);
   void this.exited.then(()=>this.cleanup());
  }catch(e){this.state.status='error';this.log('error',e.message);await this.cleanup();}
  finally{if(this.state.status!=='running')await this.cleanup();this.notify();}
 }
 send(text,newline=true){if(this.state.status!=='running'||this.state.stdinClosed||!this.child)throw Error('程序未运行或输入已关闭');if(typeof text!=='string'||Buffer.byteLength(text)>65536)throw Error('一次输入最多 64 KiB');if(this.child.stdin.writableLength>65536)throw Error('程序尚未读取之前的输入，请稍后再发');const data=text+(newline?'\n':'');if(!this.child.stdin.write(data))this.state.backpressure=true;this.log('in',data);if(this.bytes>1024*1024)this.stop('通信记录超过 1 MiB');}
 eof(){if(!this.child||this.state.stdinClosed)return;this.child.stdin.end();this.state.stdinClosed=true;this.log('system','EOF\n');this.notify();}
 stop(reason='手动停止'){
  this.reason=reason;this.controller?.abort();const child=this.child;if(!child){if(this.state.status==='compiling')this.state.status='stopped';this.notify();return;}
  if(this.killing||child.exitCode!==null||child.signalCode)return;this.killing=true;this.log('system',reason+'\n');
  if(process.platform==='win32'&&Number.isSafeInteger(child.pid)&&child.pid>0){const kill=spawn('taskkill',['/pid',String(child.pid),'/T','/F'],{windowsHide:true,shell:false});kill.on('error',()=>child.kill());kill.on('close',()=>{this.killing=false;});}else child.kill('SIGKILL');
 }
 async cleanup(){const dir=this.dir;if(!dir)return;if(path.dirname(path.resolve(dir))===this.root&&path.basename(dir).startsWith('cf-enhance-interactive-')){await fs.rm(dir,{recursive:true,force:true}).catch(()=>{});if(this.dir===dir)this.dir=null;}}
 async dispose(){this.closed=true;this.stop('窗口已关闭');await this.preparing?.catch(()=>{});await this.exited;clearTimeout(this.timer);await this.cleanup();}
}
module.exports={InteractiveSession};
