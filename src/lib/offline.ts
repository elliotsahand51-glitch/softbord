import {useEffect,useState} from 'react';

export interface OfflineState {
 ready:boolean;
 network:boolean;
 problem:string;
 updateReady:boolean;
 reload:()=>void;
}

/** Installing an update never reloads a document or changes its local data. */
export function useOffline():OfflineState{
 const [ready,setReady]=useState(false),[network,setNetwork]=useState(navigator.onLine),[problem,setProblem]=useState(''),[updateReady,setUpdateReady]=useState(false);
 useEffect(()=>{
  let disposed=false;
  let registration:ServiceWorkerRegistration|undefined;
  let observedController='serviceWorker' in navigator?navigator.serviceWorker.controller:null;
  let lastCheck=0;
  const cleanups:Array<()=>void>=[];
  const inspect=()=>{if(!disposed&&registration?.active){setReady(true);setProblem('');}};
  const fail=()=>{
   // A failed update does not invalidate the previously installed offline shell.
   if(!disposed&&!registration?.active&&!navigator.serviceWorker?.controller)setProblem('Offline setup failed. Stay online and reload to retry.');
  };
  const check=()=>{
   if(disposed||!registration||!navigator.onLine||document.visibilityState==='hidden'||Date.now()-lastCheck<60_000)return;
   lastCheck=Date.now();
   void registration.update().catch(fail);
  };
  const online=()=>{setNetwork(navigator.onLine);if(navigator.onLine)check();};
  const visible=()=>{if(document.visibilityState==='visible')check();};
  window.addEventListener('online',online);window.addEventListener('offline',online);
  window.addEventListener('focus',check);document.addEventListener('visibilitychange',visible);
  const interval=window.setInterval(check,5*60_000);

  if('serviceWorker' in navigator&&!import.meta.env.DEV){
   const changed=()=>{
    const controller=navigator.serviceWorker.controller;
    if(disposed||!controller)return;
    // The first install claims an uncontrolled page. Only replacing a controller
    // that already served this open page means its running bundle is outdated.
    if(observedController&&controller!==observedController)setUpdateReady(true);
    observedController=controller;
    setReady(true);setProblem('');
   };
   // Subscribe before register(): activation may finish before that promise does.
   navigator.serviceWorker.addEventListener('controllerchange',changed);
   cleanups.push(()=>navigator.serviceWorker.removeEventListener('controllerchange',changed));
   navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`,{updateViaCache:'none'}).then(value=>{
    if(disposed)return;
    registration=value;
    const watch=()=>{
     const worker=value.installing;if(!worker)return;
     const state=()=>{inspect();if(worker.state==='redundant')fail();};
     worker.addEventListener('statechange',state);
     cleanups.push(()=>worker.removeEventListener('statechange',state));state();
    };
    value.addEventListener('updatefound',watch);
    cleanups.push(()=>value.removeEventListener('updatefound',watch));
    inspect();watch();check();
    void navigator.serviceWorker.ready.then(()=>{if(!disposed){setReady(true);setProblem('');}});
   }).catch(fail);
  }else if(import.meta.env.DEV)setProblem('Development preview');
  else setProblem('This browser cannot prepare offline access.');
  return()=>{
   disposed=true;
   window.clearInterval(interval);
   window.removeEventListener('online',online);window.removeEventListener('offline',online);
   window.removeEventListener('focus',check);document.removeEventListener('visibilitychange',visible);
   cleanups.forEach(fn=>fn());
  };
 },[]);
 return {ready,network,problem,updateReady,reload:()=>window.location.reload()};
}
