import {RefreshCw} from 'lucide-react';

export function OfflineUpdate({editing=false,disabled=false,onReload}:{editing?:boolean;disabled?:boolean;onReload:()=>void}){
 return <div className="update-notice" role="status">
  <span>Softboard update ready</span>
  <button type="button" onClick={onReload} disabled={disabled}>
   <RefreshCw size={14}/>{editing?'Save and reload':'Reload'}
  </button>
 </div>;
}
