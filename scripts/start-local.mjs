import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const url='http://localhost:4175/';
async function available(){
 try{const response=await fetch(url,{signal:AbortSignal.timeout(600)});return response.ok&&(await response.text()).includes('<title>Softboard</title>');}catch{return false;}
}
if(!await available()){
 const child=spawn(process.execPath,[fileURLToPath(new URL('./serve.mjs',import.meta.url))],{detached:true,windowsHide:true,stdio:'ignore'});
 child.unref();
 let ready=false;
 for(let attempt=0;attempt<30;attempt++){if(await available()){ready=true;break;}await new Promise(resolve=>setTimeout(resolve,200));}
 if(!ready)throw Error('Softboard could not start. Another application may be using port 4175.');
}
if(process.platform==='win32'){
 const browser=spawn('cmd.exe',['/d','/s','/c','start "" "http://localhost:4175/"'],{windowsHide:true,stdio:'ignore'});
 browser.on('error',()=>console.log(`Open ${url} in your browser.`));
}else console.log(`Open ${url} in your browser.`);
