const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const Module=require('node:module');const {parseHTML}=require('linkedom');
const original=Module._load;Module._load=function(name,...args){return name==='vscode'?{Uri:{joinPath:(...parts)=>parts.join('/')}}:original.call(this,name,...args);};
const {PanelProvider,panelHtml}=require('./panel.cjs');Module._load=original;
test('webview uses a restrictive CSP and local assets; action handler rejects unknown actions and serializes clicks',async()=>{
 const html=panelHtml({cspSource:'vscode-webview:',asWebviewUri:s=>s},'extension');assert.match(html,/default-src 'none'/);assert.match(html,/script-src 'nonce-/);assert(!html.includes('{{'));assert(!html.includes('onclick='));
 let release,calls=0;const panel=new PanelProvider('extension',()=>({tasks:[]}),async()=>{calls++;await new Promise(r=>release=r);return '完成';});const messages=[];panel.views.add({webview:{postMessage:m=>messages.push(m)}});
 await panel.receive({action:'executeCode'});assert.equal(calls,0);const pending=panel.receive({action:'submit'});await panel.receive({action:'submit'});assert.equal(calls,1);assert(messages[0].state.busy);release();await pending;assert.equal(panel.notice,'完成');assert.equal(panel.busy,false);
});
test('panel follows the current problem, remembers choices, switches browsed files, and renders untrusted text safely',()=>{
 const {document}=parseHTML(fs.readFileSync(__dirname+'/media/panel.html','utf8'));let listener;const window={addEventListener:(name,fn)=>{if(name==='message')listener=fn;}};
 for(const select of document.querySelectorAll('select'))Object.defineProperty(select,'value',{get(){return this._value||this.querySelector('option')?.getAttribute('value')||'';},set(value){this._value=value;},configurable:true});
 const messages=[];let saved;vm.runInNewContext(fs.readFileSync(__dirname+'/media/panel.js','utf8'),{window,document,acquireVsCodeApi:()=>({getState:()=>null,setState:s=>saved=s,postMessage:m=>messages.push(m)})});
 const state={trusted:true,connected:true,port:54321,editor:{uri:'a',name:'a.cpp',languageId:'cpp',characters:10},currentProblem:{contestId:10,index:'A'},targets:[{key:'manual',label:'手动'},{key:'current:10/A',label:'当前题'}],tasks:[{id:'1',problem:{contestId:10,index:'A'},sourceName:'<img src=x onerror=alert(1)>',detail:'安全显示',result:'AC',verdict:'OK',terminal:true}]};
 listener({data:{type:'state',state}});assert.equal(document.getElementById('target').value,'current:10/A');assert.equal(document.getElementById('language').value,'cpp23');assert.equal(document.querySelectorAll('img').length,0);assert(document.getElementById('tasks').textContent.includes('<img'));
 document.getElementById('browse').onclick();listener({data:{type:'state',state:{...state,busy:true}}});listener({data:{type:'state',state:{...state,file:{uri:'b',name:'solve.py',languageId:'python',characters:20}}}});
 assert.equal(document.getElementById('source').value,'file');assert.equal(document.getElementById('language').value,'python3');document.getElementById('submit').onclick();assert.equal(messages.at(-1).sourceMode,'file');assert.equal(messages.at(-1).targetKey,'current:10/A');assert(!JSON.stringify(saved).includes('token'));
});
