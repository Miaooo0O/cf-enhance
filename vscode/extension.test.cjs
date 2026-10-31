const test=require('node:test');const assert=require('node:assert/strict');const Module=require('node:module');
test('VS Code commands pair, snapshot an arbitrary editor, select a separate target and receive feedback',async()=>{
 const commands=new Map(),persisted={},secrets=new Map();let clipboard='',source='int main(){return 0;}',provider;
 const context={subscriptions:[],globalState:{get:(k,d)=>persisted[k]??d,update:async(k,v)=>persisted[k]=v},secrets:{get:async k=>secrets.get(k),store:async(k,v)=>secrets.set(k,v),delete:async k=>secrets.delete(k)}};
 class Emitter{event=()=>{};fire(){}dispose(){}}
 const mock={EventEmitter:Emitter,StatusBarAlignment:{Right:1},ProgressLocation:{Notification:1},TreeItem:class{constructor(label){this.label=label;}},ThemeIcon:class{},Uri:{parse:s=>s},
  workspace:{isTrusted:true,getConfiguration:()=>({get:(k,d)=>k==='port'?0:d})},
  env:{clipboard:{writeText:async value=>clipboard=value},openExternal:async()=>true},
  commands:{registerCommand:(id,fn)=>{commands.set(id,fn);return {dispose(){}};},executeCommand:async(id,...args)=>commands.get(id)(...args)},
  window:{activeTextEditor:{document:{isUntitled:false,fileName:'D:/code/anything.cpp',getText:()=>source},selection:{isEmpty:true}},
   createOutputChannel:()=>({appendLine(){},show(){},dispose(){}}),createStatusBarItem:()=>({show(){},dispose(){}}),registerTreeDataProvider:(id,p)=>{provider=p;return {dispose(){}};},
   showInformationMessage:async(message,...args)=>args.includes('准备提交')?'准备提交':undefined,showWarningMessage:()=>{},showErrorMessage:message=>{throw Error(message);},
   showQuickPick:async(items,options)=>{if(options.placeHolder==='选择提交语言'){source='changed after snapshot';return items.find(i=>i.id==='cpp23');}return items[0];},showInputBox:async()=> '10A'
  }
 };
 const original=Module._load;Module._load=function(name,...args){return name==='vscode'?mock:original.call(this,name,...args);};let extension;
 try{extension=require('./extension.cjs');await extension.activate(context);await commands.get('cfEnhance.pair')();
  const [,port,code]=clipboard.split(':'),client='a'.repeat(32);const call=async(path,data,token)=>{const r=await fetch(`http://127.0.0.1:${port}${path}`,{method:'POST',headers:{'Content-Type':'application/json','X-CFE-Client':client,...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(data)});return r.json();};
  const {token}=await call('/pair',{extensionId:client,code});await commands.get('cfEnhance.submit')();
  const [task]=provider.getChildren();assert.equal(task.sourceName,'anything.cpp');assert.deepEqual(task.problem,{contestId:10,index:'A'});assert.equal(task.source,'int main(){return 0;}');
  for(const state of ['opened','prepared','submitted'])await call('/event',{id:task.id,type:'state',state},token);
  await call('/event',{id:task.id,type:'bound',submissionId:99,handle:'sample'},token);await call('/event',{id:task.id,type:'verdict',submissionId:99,verdict:'OK'},token);
  assert.equal(provider.getChildren()[0].verdict,'OK');assert(provider.getTreeItem(provider.getChildren()[0]).label.includes('AC'));await new Promise(setImmediate);assert.equal(persisted['cfEnhance.tasks'][0].source,undefined);
 }finally{Module._load=original;for(const d of context.subscriptions)d.dispose?.();await extension?.deactivate();}
});
