/* Minimal zero-dependency static file server for local dev / QA screenshots.
   Usage: node tools/serve.mjs [port]   (serves the repo root over HTTP so the
   ES modules load — they won't from file://). */
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {extname,join,normalize} from 'node:path';

const PORT=Number(process.argv[2]||8731);
const ROOT=process.cwd();
const MIME={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon'};

createServer(async (req,res)=>{
  try{
    let p=decodeURIComponent(req.url.split('?')[0]);
    if(p==='/'||p==='')p='/index.html';
    const file=normalize(join(ROOT,p));
    if(!file.startsWith(ROOT)){res.writeHead(403);return res.end('no');}
    const body=await readFile(file);
    res.writeHead(200,{'content-type':MIME[extname(file)]||'application/octet-stream'});
    res.end(body);
  }catch(e){res.writeHead(404);res.end('404');}
}).listen(PORT,()=>console.log('serving '+ROOT+' on http://localhost:'+PORT+'/'));
