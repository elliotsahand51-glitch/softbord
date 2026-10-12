import React from 'react';
import {createRoot} from 'react-dom/client';
import App from './App';
import {clearEditorLocation} from './lib/editorLocation';
import './styles.css';
class ErrorBoundary extends React.Component<{children:React.ReactNode},{error:string}>{state={error:''};static getDerivedStateFromError(error:Error){return {error:error.message};}render(){if(this.state.error)return <main className="fatal-error"><h1>Softboard couldn't open this view.</h1><p>Your saved projects are still on this device. Reload to return to the library.</p><pre>{this.state.error}</pre><button onClick={()=>{clearEditorLocation();location.reload();}}>Reload Softboard</button></main>;return this.props.children;}}
createRoot(document.getElementById('root')!).render(<ErrorBoundary><App/></ErrorBoundary>);
