const fs=require('node:fs');const path=require('node:path');const {createHash,randomUUID}=require('node:crypto');
const normalize=s=>s.replace(/\r\n?/g,'\n').replace(/\n+$/,'');
function importSamples({filePath,problem,samples,saveLocation=''}){
 if(!path.isAbsolute(filePath)||!fs.existsSync(filePath)||!fs.statSync(filePath).isFile())throw Error('请先将代码保存到本机文件，再导入 CPH。');
 if(!Number.isSafeInteger(problem?.contestId)||problem.contestId<=0||!/^[A-Z]\d*$/.test(problem.index)||!Array.isArray(samples)||!samples.length||samples.length>20||samples.some(s=>typeof s.input!=='string'||typeof s.output!=='string'||s.input.length>65536||s.output.length>65536))throw Error('没有有效的网页样例，请先在 Chrome 打开题目。');
 const directory=saveLocation&&path.isAbsolute(saveLocation)&&fs.existsSync(saveLocation)&&fs.statSync(saveLocation).isDirectory()?saveLocation:path.join(path.dirname(filePath),'.cph');
 // CPH identifies a source by its exact document.fileName, including drive casing.
 const destination=path.join(directory,`.${path.basename(filePath)}_${createHash('md5').update(filePath).digest('hex')}.prob`);
 let previous=null;if(fs.existsSync(destination)){if(fs.statSync(destination).size>16*1024*1024)throw Error('CPH 数据文件过大，未修改。');try{previous=JSON.parse(fs.readFileSync(destination,'utf8'));}catch{throw Error('原 CPH 数据无法读取，已保留原文件。');}if(!previous||typeof previous!=='object'||!Array.isArray(previous.tests)||previous.tests.some(t=>typeof t.input!=='string'||typeof t.output!=='string'))throw Error('原 CPH 用例格式不兼容，已保留原文件。');}
 const tests=previous?.tests?.map(t=>({...t}))||[],keys=new Set(tests.map(t=>JSON.stringify([normalize(t.input),normalize(t.output)])));let added=0,id=tests.reduce((max,t)=>Number.isSafeInteger(t.id)?Math.max(max,t.id+1):max,Date.now());
 for(const sample of samples){const key=JSON.stringify([normalize(sample.input),normalize(sample.output)]);if(keys.has(key))continue;keys.add(key);tests.push({id:id++,input:sample.input,output:sample.output});added++;}
 const data={interactive:false,memoryLimit:256,timeLimit:3000,...previous,name:`${problem.contestId}${problem.index}`,url:`https://codeforces.com/contest/${problem.contestId}/problem/${problem.index}`,srcPath:filePath,group:'Codeforces',local:false,tests};
 fs.mkdirSync(directory,{recursive:true});const temporary=destination+'.'+randomUUID()+'.tmp';try{fs.writeFileSync(temporary,JSON.stringify(data),{encoding:'utf8',flag:'wx'});fs.renameSync(temporary,destination);}finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
 return {destination,problem:data,added,total:tests.length};
}
async function refreshCph(vscode,extension,document,result){
 const api=await extension.activate();
 const provider=api?.getJudgeViewProvider?.();
 if(provider?.extensionToJudgeViewMessage){await vscode.window.showTextDocument(document,{preview:false});await provider.focus?.();provider.extensionToJudgeViewMessage({command:'new-problem',problem:result.problem});return;}
 // CPH reloads .prob on editor changes, but exposes no public refresh command.
 // Briefly preview only our data file, then restore the source. Never run code,
 // close a pre-existing tab, or reload unrelated webviews.
 const uri=vscode.Uri.file(result.destination),before=new Set(vscode.window.tabGroups.all.flatMap(g=>g.tabs));let preview;
 try{await vscode.window.showTextDocument(uri,{preview:true});preview=vscode.window.tabGroups.all.flatMap(g=>g.tabs).find(t=>!before.has(t)&&t.input?.uri?.toString()===uri.toString());}
 finally{await vscode.window.showTextDocument(document,{preview:false});if(preview&&!preview.isDirty)await vscode.window.tabGroups.close(preview);}
 await vscode.commands.executeCommand('cph.judgeView.focus');
}
module.exports={importSamples,refreshCph};
