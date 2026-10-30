export const refreshMessage='扩展已更新或重新加载，请刷新当前 CF 页面后继续使用。';
export function contextActive(){try{return !!globalThis.chrome?.runtime?.id;}catch{return false;}}
export const isContextError=error=>error?.code==='CFE_CONTEXT_INVALIDATED'||/Extension context invalidated/i.test(error?.message||'');
function contextError(error){
  if(!contextActive()||isContextError(error)){
    const next=new Error(refreshMessage);next.code='CFE_CONTEXT_INVALIDATED';
    globalThis.window?.dispatchEvent(new Event('cfe-context-invalidated'));return next;
  }
  return error;
}
function ensureContext(){if(!contextActive())throw contextError(new Error());}
export async function request(type,params={}){
  try{ensureContext();const r=await chrome.runtime.sendMessage({type,...params});
    if(!r?.ok)throw new Error(r?.error||'扩展连接暂不可用，请稍后重试。');return r.data;
  }catch(e){throw contextError(e);}
}
export async function getLocal(keys){try{ensureContext();return await chrome.storage.local.get(keys);}catch(e){throw contextError(e);}}
export async function setLocal(values){try{ensureContext();return await chrome.storage.local.set(values);}catch(e){throw contextError(e);}}
export function listenStorage(callback){
  ensureContext();chrome.storage.onChanged.addListener(callback);let removed=false;
  const dispose=()=>{if(removed)return;removed=true;
    try{chrome.storage.onChanged.removeListener(callback);}catch{} // The old runtime may already be gone.
    globalThis.window?.removeEventListener('cfe-context-invalidated',dispose);
  };
  globalThis.window?.addEventListener('cfe-context-invalidated',dispose,{once:true});return dispose;
}
