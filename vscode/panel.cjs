const vscode=require('vscode');const {randomBytes}=require('node:crypto');const fs=require('node:fs');const path=require('node:path');
function panelHtml(webview,extensionUri){
 const nonce=randomBytes(24).toString('base64');
 const root=vscode.Uri.joinPath(extensionUri,'media');
 return fs.readFileSync(path.join(__dirname,'media','panel.html'),'utf8')
  .replaceAll('{{CSP}}',webview.cspSource).replaceAll('{{NONCE}}',nonce)
  .replaceAll('{{STYLE}}',String(webview.asWebviewUri(vscode.Uri.joinPath(root,'panel.css'))))
  .replaceAll('{{SCRIPT}}',String(webview.asWebviewUri(vscode.Uri.joinPath(root,'panel.js'))));
}
class PanelProvider{
 constructor(extensionUri,getState,act){this.extensionUri=extensionUri;this.getState=getState;this.act=act;this.views=new Set();this.busy=false;this.notice='';this.last=new Map();}
 resolveWebviewView(view){
  view.webview.options={enableScripts:true,localResourceRoots:[vscode.Uri.joinPath(this.extensionUri,'media')]};
  view.webview.html=panelHtml(view.webview,this.extensionUri);this.views.add(view);
  const message=view.webview.onDidReceiveMessage(m=>{void this.receive(m);});
  const visibility=view.onDidChangeVisibility(()=>this.publish(true));
  view.onDidDispose(()=>{message.dispose();visibility.dispose();this.views.delete(view);this.last.delete(view);});
  this.publish(true);
 }
 async receive(message){
  const allowed=new Set(['ready','refresh','pair','disconnect','browse','submit','samples','openProblem','viewTask','cancelTask','showOutput']);
  if(!message||typeof message!=='object'||!allowed.has(message.action))return;
  if(message.action==='ready'||message.action==='refresh'){this.publish(true);return;}
  if(this.busy)return;this.busy=true;this.notice='';this.publish(true);
  try{this.notice=await this.act(message)||'';}catch(e){this.notice=e.message||String(e);}finally{this.busy=false;this.publish(true);}
 }
 publish(force=false){const state={...this.getState(),busy:this.busy,notice:this.notice};const json=JSON.stringify(state);
  for(const view of this.views){if(view.visible===false)continue;if(!force&&this.last.get(view)===json)continue;this.last.set(view,json);void view.webview.postMessage({type:'state',state});}
 }
 reveal(){for(const view of this.views)view.show?.(true);}
}
module.exports={PanelProvider,panelHtml};
