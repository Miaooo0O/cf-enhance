async function startAvailable(bridge,{configured=0,preferred=0}={}){
 if(!Number.isInteger(configured)||configured!==0&&(configured<1024||configured>65535))throw Error('端口应为 0（自动）或 1024–65535。');
 const requested=configured===27121?0:configured;
 const remembered=Number.isInteger(preferred)&&preferred>=1024&&preferred<=65535?preferred:0;
 const candidate=requested||remembered;
 try{await bridge.start(candidate);return {port:bridge.port,fallback:false};}
 catch(error){if(!candidate||error.code!=='EADDRINUSE')throw error;await bridge.start(0);return {port:bridge.port,fallback:true};}
}
module.exports={startAvailable};
