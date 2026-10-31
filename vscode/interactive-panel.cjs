const vscode=require('vscode'),fs=require('node:fs'),path=require('node:path'),{randomBytes}=require('node:crypto'),{InteractiveSession}=require('./interactive.cjs');
function interactiveHtml(webview,extensionUri){const nonce=randomBytes(24).toString('base64'),media=vscode.Uri.joinPath(extensionUri,'media');return fs.readFileSync(path.join(__dirname,'media','interactive.html'),'utf8').replaceAll('{{CSP}}',webview.cspSource).replaceAll('{{NONCE}}',nonce).replace('{{STYLE}}',String(webview.asWebviewUri(vscode.Uri.joinPath(media,'panel.css')))).replace('{{SCRIPT}}',String(webview.asWebviewUri(vscode.Uri.joinPath(media,'interactive.js'))));}
class InteractivePanel{
 constructor(context,snapshot,problem,onDispose=()=>{}){this.getCode=snapshot;this.context=context;this.panel=vscode.window.createWebviewPanel('cfEnhance.interactive','交互测试'+(problem?' · '+problem.contestId+problem.index:''),vscode.ViewColumn.Beside,{enableScripts:true,retainContextWhenHidden:true,localResourceRoots:[vscode.Uri.joinPath(context.extensionUri,'media')]});
  this.session=new InteractiveSession(()=>this.schedule());this.panel.webview.html=interactiveHtml(this.panel.webview,context.extensionUri);this.message=this.panel.webview.onDidReceiveMessage(m=>{void this.receive(m);});this.panel.onDidDispose(()=>{this.disposed=true;clearTimeout(this.timer);this.message.dispose();void this.session.dispose().finally(onDispose);});}
 schedule(){if(this.timer||this.disposed)return;this.timer=setTimeout(()=>{this.timer=null;this.publish();},40);}
 publish(){if(!this.disposed)void Promise.resolve(this.panel.webview.postMessage({type:'interactive',state:{...this.session.state,notice:this.notice}})).catch(()=>{});}
 async receive(m){if(this.disposed||!m||!['ready','start','send','eof','stop','copy'].includes(m.action))return;
  try{this.notice='';if(m.action==='ready')return this.publish();if(!vscode.workspace.isTrusted)throw Error('请先信任工作区');
   if(m.action==='start'){if(this.starting)return;this.starting=true;try{const snapshot=await this.getCode(),c=vscode.workspace.getConfiguration('cfEnhance');await this.session.start(snapshot,{compiler:c.get('compiler','g++'),cCompiler:c.get('cCompiler','gcc'),python:c.get('python','python'),timeout:c.get('interactiveTimeout',120000)});}finally{this.starting=false;}}
   if(m.action==='send')this.session.send(m.text,m.newline!==false);if(m.action==='eof')this.session.eof();if(m.action==='stop')this.session.stop();if(m.action==='copy')await vscode.env.clipboard.writeText(this.session.state.logs.map(r=>(r.kind==='in'?'→ ':r.kind==='out'?'← ':r.kind==='error'?'! ':'')+r.text).join(''));
  }catch(e){this.notice=e.message;}this.publish();
 }
 async dispose(){if(!this.disposed)this.panel.dispose();await this.session.dispose();}
}
module.exports={InteractivePanel,interactiveHtml};
