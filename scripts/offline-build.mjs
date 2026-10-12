import {readdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,relative} from 'node:path';
const root=new URL('../dist/',import.meta.url);
async function walk(dir){const entries=await readdir(dir,{withFileTypes:true});const result=[];for(const e of entries){const p=new URL(e.name+(e.isDirectory()?'/':''),dir);if(e.isDirectory())result.push(...await walk(p));else result.push(p);}return result;}
const files=(await walk(root)).filter(f=>!f.pathname.endsWith('/sw.js'));
const hash=createHash('sha256');for(const f of files)hash.update(await readFile(f));const version=hash.digest('hex').slice(0,16);
const urls=files.map(f=>'./'+decodeURIComponent(f.pathname.slice(root.pathname.length)));
const source=`const CACHE='softboard-v3-${version}';
const ASSETS=${JSON.stringify(['./',...urls])};
self.addEventListener('install',event=>event.waitUntil((async()=>{const cache=await caches.open(CACHE);try{for(let i=0;i<ASSETS.length;i+=12){await Promise.all(ASSETS.slice(i,i+12).map(async url=>{const request=new Request(new URL(url,self.registration.scope),{cache:'reload',credentials:'same-origin'});const response=await fetch(request);if(!response.ok||response.type==='opaque')throw Error('Offline asset missing: '+url);await cache.put(request,response);}));}}catch(error){await caches.delete(CACHE);throw error;}await self.skipWaiting();})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{await self.clients.claim();/* Keep older versions: an already open tab may still import its hashed assets. */})()));
self.addEventListener('fetch',event=>{if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;event.respondWith((async()=>{const cache=await caches.open(CACHE);const cached=await cache.match(event.request,{ignoreSearch:false});if(cached)return cached;if(event.request.mode==='navigate'){const shell=await cache.match(new URL('./index.html',self.registration.scope));if(shell)return shell;}const previous=await caches.match(event.request);if(previous)return previous;return fetch(event.request);})());});
`;
await writeFile(new URL('sw.js',root),source);
console.log('Offline shell prepared:',urls.length,'files; version',version);
