import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const dir=path.resolve(fileURLToPath(new URL('../dist/',import.meta.url)));
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml','.wasm':'application/wasm','.bcmap':'application/octet-stream','.ttf':'font/ttf','.pfb':'application/octet-stream'};
const server=http.createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');let target=path.resolve(dir,'.'+decodeURIComponent(u.pathname));if(target!==dir&&!target.startsWith(dir+path.sep)){res.writeHead(403).end();return;}if((await stat(target)).isDirectory())target=path.join(target,'index.html');const data=await readFile(target);res.writeHead(200,{'Content-Type':types[path.extname(target)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin'});res.end(data);}catch{res.writeHead(404).end('Not found');}});
server.listen(4175,'127.0.0.1',()=>console.log('Softboard: http://localhost:4175'));
server.on('error',error=>{if(error.code==='EADDRINUSE')console.log('Port 4175 is already in use. Open http://localhost:4175 if Softboard is already running.');else console.error(error);process.exitCode=1;});
