import {request,listenStorage} from './client.mjs';
import {parsePairing} from './bridge-protocol.mjs';
export async function mountBridgePopup(root){
 const $=id=>root.querySelector('#'+id);if(!$('bridgeConnect'))return ()=>{};
 const refresh=async()=>{try{const s=await request('bridgeStatus');$('bridgeStatus').textContent=s?.detail||'未连接。先在 VS Code 执行“CF Enhance: 配对浏览器”。';}catch(e){$('bridgeStatus').textContent=e.message;}};
 $('bridgeConnect').onclick=async()=>{
  try{parsePairing($('bridgeCode').value);const permission=await chrome.permissions.request({origins:['http://127.0.0.1/*']});if(!permission)throw Error('需要允许连接本机 VS Code，其他网页功能不受影响。');
   $('bridgeConnect').disabled=true;$('bridgeStatus').textContent='正在配对…';await request('bridgePair',{code:$('bridgeCode').value});$('bridgeCode').value='';await refresh();
  }catch(e){$('bridgeStatus').textContent=e.message;}finally{$('bridgeConnect').disabled=false;}
 };
 $('bridgeDisconnect').onclick=async()=>{try{await request('bridgeDisconnect');await refresh();}catch(e){$('bridgeStatus').textContent=e.message;}};
 const unlisten=listenStorage((changes,area)=>{if(area==='local'&&changes.bridgeStatus)$('bridgeStatus').textContent=changes.bridgeStatus.newValue?.detail||'未连接';});await refresh();return unlisten;
}
