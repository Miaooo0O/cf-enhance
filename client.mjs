export async function request(type,params={}){
  const r=await chrome.runtime.sendMessage({type,...params});
  if(!r?.ok)throw new Error(r?.error||'扩展连接已失效，请刷新网页。');return r.data;
}
