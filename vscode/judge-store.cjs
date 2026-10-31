const {randomUUID}=require('node:crypto');
const KEY='cfEnhance.judgeSuites';
const normalize=s=>s.replace(/\r\n?/g,'\n').replace(/\n+$/,'');
const signature=c=>JSON.stringify([normalize(c.input),normalize(c.expected),c.compare]);
class JudgeStore{
 constructor(storage){this.storage=storage;this.suites=structuredClone(storage.get(KEY,{}));this.pending=Promise.resolve();}
 suite(key,name='代码'){if(!key||typeof key!=='string'||key.length>4096)throw Error('请先打开代码文件');if(!this.suites[key])this.suites[key]={key,name,revision:0,cases:[this.blank(true)]};return this.suites[key];}
 blank(placeholder=false){return {id:randomUUID(),input:'',expected:'',compare:false,enabled:true,origin:'manual',revision:0,placeholder};}
 commit(key,change){const old=this.suites[key];if(!old)throw Error('用例组已切换，请重试');const next=structuredClone(old);change(next);if(next.cases.length>50)throw Error('每个代码文件最多 50 个用例');next.revision++;const all={...this.suites,[key]:next};if(Buffer.byteLength(JSON.stringify(all))>12*1024*1024)throw Error('本地用例存储已超过 12 MiB，请删除不再需要的用例');this.suites=all;this.pending=this.pending.catch(()=>{}).then(()=>this.storage.update(KEY,structuredClone(this.suites)));return this.pending;}
 add(key){return this.commit(key,s=>s.cases.push(this.blank()));}
 edit(key,id,patch){return this.commit(key,s=>{const c=s.cases.find(c=>c.id===id);if(!c)throw Error('用例不存在');for(const field of ['input','expected'])if(field in patch){if(typeof patch[field]!=='string'||Buffer.byteLength(patch[field])>65536)throw Error('单项输入或输出最多 64 KiB');c[field]=patch[field];}for(const field of ['compare','enabled'])if(field in patch){if(typeof patch[field]!=='boolean')throw Error('用例选项无效');c[field]=patch[field];}c.origin='manual';c.placeholder=false;c.revision++;});}
 remove(key,id){return this.commit(key,s=>{s.cases=s.cases.filter(c=>c.id!==id);});}
 async import(key,problem,samples){if(!Number.isSafeInteger(problem?.contestId)||problem.contestId<=0||!/^[A-Z]\d*$/.test(problem.index)||!Array.isArray(samples)||!samples.length||samples.length>20||samples.some(s=>typeof s.input!=='string'||typeof s.output!=='string'||s.input.length>65536||s.output.length>65536))throw Error('网页没有有效样例，请先打开 CF 题目');const problemKey=problem.contestId+'/'+problem.index;let added=0;await this.commit(key,s=>{s.problem=problem;s.cases=s.cases.filter(c=>!c.placeholder&&!(c.origin==='web'&&c.problemKey!==problemKey));const keys=new Set(s.cases.map(signature));for(const sample of samples){const candidate={input:sample.input,expected:sample.output,compare:true};const sig=signature(candidate);if(keys.has(sig))continue;keys.add(sig);s.cases.push({...this.blank(),...candidate,origin:'web',problemKey});added++;}});return added;}
 async flush(){await this.pending;}
}
module.exports={JudgeStore};
