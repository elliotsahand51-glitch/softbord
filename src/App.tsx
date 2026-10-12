import {useEffect,useState} from 'react';
import type {SoftDocument} from './types';
import {Library} from './components/Library';
import {Editor} from './components/Editor';
import {useOffline} from './lib/offline';
import {loadDocument} from './lib/storage';
import {clearEditorLocation,readEditorLocation,writeEditorLocation} from './lib/editorLocation';

export default function App(){
 const [resume]=useState(readEditorLocation),[document,setDocument]=useState<SoftDocument|null>(null),[opening,setOpening]=useState(!!resume),[openError,setOpenError]=useState('');
 const [theme,setTheme]=useState(()=>{try{return localStorage.getItem('softboard-theme')||'light';}catch{return 'light';}});
 const offline=useOffline();
 useEffect(()=>{
  if(!resume)return;
  let cancelled=false;
  void loadDocument(resume.documentId).then(saved=>{
   if(cancelled)return;
   if(saved)setDocument(saved);else{clearEditorLocation();setOpenError('The last open project is no longer on this device. Choose another project from your library.');}
  }).catch(error=>{if(!cancelled)setOpenError(error instanceof Error?error.message:'Could not reopen the last project.');}).finally(()=>{if(!cancelled)setOpening(false);});
  return()=>{cancelled=true;};
 },[resume]);
 const open=(next:SoftDocument)=>{writeEditorLocation({documentId:next.id});setOpenError('');setDocument(next);};
 const close=()=>{clearEditorLocation();setOpenError('');setDocument(null);};
 const toggleTheme=()=>{const next=theme==='light'?'dark':'light';setTheme(next);try{localStorage.setItem('softboard-theme',next);}catch{}};
 return <div className="app" data-theme={theme}>{opening?<main className="busy-message" role="status"><span className="spinner"/>Reopening your project…</main>:document?<Editor key={document.id} initial={document} onClose={close} theme={theme} onTheme={toggleTheme} offline={offline}/>:<>{openError&&<div className="error-message" role="alert">{openError}<button className="text-button" onClick={close}>Dismiss</button></div>}<Library onOpen={open} theme={theme} onTheme={toggleTheme} offline={offline}/></>}</div>;
}
