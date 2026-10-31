export function parsePairing(text){const m=String(text||'').trim().match(/^cfe-pair:(\d{4,5}):([A-Za-z0-9_-]{32})$/);if(!m||Number(m[1])<1024||Number(m[1])>65535)throw Error('请粘贴 VS Code 刚生成的完整配对码。');return {port:Number(m[1]),code:m[2]};}
export const validProblem=p=>Number.isSafeInteger(p?.contestId)&&p.contestId>0&&/^[A-Z]\d*$/.test(p.index);
export const normalizedSource=s=>s.replace(/\r\n?/g,'\n');
export async function hashSource(source){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(normalizedSource(source))))].map(b=>b.toString(16).padStart(2,'0')).join('');}
export function submissionMatches(task,s){return s?.problem?.contestId===task.problem.contestId&&s.problem.index===task.problem.index&&s.id>task.baseline&&s.creationTimeSeconds>=Math.floor(task.submittedAt/1000)-2&&s.author?.members?.some(m=>m.handle.toLowerCase()===task.handle.toLowerCase());}
export function extractSource(html){
 const raw=html.match(/<pre\b(?=[^>]*\bid=["']program-source-text["'])[^>]*>([\s\S]*?)<\/pre>/i)?.[1];if(raw===undefined)return null;
 return raw.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,(whole,entity)=>{if(entity[0]==='#'){const n=entity[1].toLowerCase()==='x'?parseInt(entity.slice(2),16):Number(entity.slice(1));return n>0&&n<=0x10ffff?String.fromCodePoint(n):whole;}return {amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:'\u00a0'}[entity.toLowerCase()]||whole;});
}
export function languageOption(options,language){
 const patterns={cpp23:/GNU G\+\+23/i,cpp20:/GNU G\+\+20/i,cpp17:/GNU G\+\+17/i,python3:/^Python 3/i,pypy3:/^PyPy 3/i,java21:/^Java 21/i,rust:/^Rust /i};
 return patterns[language]?Array.from(options).find(o=>patterns[language].test(o.textContent.trim()))?.value:null;
}
