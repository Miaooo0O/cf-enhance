import(chrome.runtime.getURL('companion.mjs')).then(m=>m.mountCompanion()).catch(error=>{
 if(error?.code!=='CFE_CONTEXT_INVALIDATED'&&!/Extension context invalidated/i.test(error?.message||''))console.warn('CF Enhance 联动：'+error.message);
});
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 if(sender.id!==chrome.runtime.id||message?.type!=='cfeFetchSamples')return;
 import(chrome.runtime.getURL('companion.mjs')).then(m=>m.fetchProblemSamples(message.problem)).then(samples=>reply({samples}),error=>reply({error:error.message}));return true;
});
