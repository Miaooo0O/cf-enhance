import(chrome.runtime.getURL('companion.mjs')).then(m=>m.mountCompanion()).catch(error=>{
 if(error?.code!=='CFE_CONTEXT_INVALIDATED'&&!/Extension context invalidated/i.test(error?.message||''))console.warn('CF Enhance 联动：'+error.message);
});
