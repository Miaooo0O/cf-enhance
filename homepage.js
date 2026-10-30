import(chrome.runtime.getURL('enhance.mjs')).then(m=>m.mount()).catch(error=>{
  if(error?.code==='CFE_CONTEXT_INVALIDATED'||/Extension context invalidated/i.test(error?.message||'')){
    const notice=document.getElementById('cfe-notice');if(notice)notice.textContent='扩展已更新，请刷新当前 CF 页面。';
  }else console.error(error);
});
