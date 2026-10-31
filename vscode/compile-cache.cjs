const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{createHash}=require('node:crypto');
const hash=value=>createHash('sha256').update(value).digest('hex');
// One owned build directory per extension host. Never write executables beside user files.
class CompileCache{
 constructor(){this.entry=null;this.dir=null;}
 async directory(){if(!this.dir){const root=await fs.realpath(os.tmpdir());this.root=root;this.dir=await fs.mkdtemp(path.join(root,'cf-enhance-build-'));}return this.dir;}
 async fingerprint(command,cwd,source,language){
  const paths=path.isAbsolute(command)?[command]:[...(process.env.PATH||'').split(path.delimiter)].flatMap(p=>(process.platform==='win32'?['','.exe','.cmd','.bat']:['']).map(ext=>path.join(p,command+ext)));
  let executable;for(const p of paths){try{const s=await fs.stat(p);if(s.isFile()){executable=[p,s.size,s.mtimeMs];break;}}catch{}}
  return hash(JSON.stringify([command,executable,cwd,source,language,process.env.PATH,process.env.CPATH,process.env.CPLUS_INCLUDE_PATH,process.env.C_INCLUDE_PATH,process.env.LIBRARY_PATH]));
 }
 async hit(key){const e=this.entry;if(!e||e.key!==key)return false;try{await fs.access(e.binary);for(const [file,digest]of e.dependencies)if(hash(await fs.readFile(file))!==digest)return false;return true;}catch{return false;}}
 async remember(key,binary,depfile,cwd){
  this.entry=null;
  try{
   const raw=(await fs.readFile(depfile,'utf8')).replace(/\\\r?\n/g,' '),colon=raw.indexOf(': ');if(colon<0)return;
   // GCC makefile escaping: escaped spaces and backslashes are part of a path.
   const tokens=raw.slice(colon+2).match(/(?:\\.|[^\s])+/g)||[];
   const files=tokens.map(t=>path.resolve(cwd,t.replace(/\\([ #\\])/g,'$1').replace(/\$\$/g,'$')));
   if(!files.length)return;
   const dependencies=await Promise.all([...new Set(files)].map(async file=>[file,hash(await fs.readFile(file))]));
   this.entry={key,binary,dependencies};
  }catch{/* If dependency tracking is unavailable, compile again next time. */}
 }
 async dispose(){this.entry=null;const dir=this.dir;this.dir=null;if(dir&&path.dirname(path.resolve(dir))===this.root&&path.basename(dir).startsWith('cf-enhance-build-'))await fs.rm(dir,{recursive:true,force:true}).catch(()=>{});}
}
module.exports={CompileCache};
