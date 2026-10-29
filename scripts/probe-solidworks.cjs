// Attach/read only. Never invokes apply, OpenDoc, Start or Save.
const { spawn } = require('node:child_process');
const { createInterface } = require('node:readline');
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '..');
const child = spawn(path.join(root, 'workers/cad-python/.venv/Scripts/python.exe'), ['-m','cad_worker'], {cwd:path.join(root,'workers/cad-python'),env:{...process.env,PYTHONUTF8:'1'},stdio:['pipe','pipe','inherit']});
let seq=0;const pending=new Map();
const reader=createInterface({input:child.stdout});
reader.on('line',line=>{const r=JSON.parse(line);const p=pending.get(r.id);if(p){pending.delete(r.id);r.error?p.reject(Error(r.error.message)):p.resolve(r.result);}});
function req(method,params={}){return new Promise((resolve,reject)=>{const id=String(++seq);pending.set(id,{resolve,reject});child.stdin.write(JSON.stringify({id,method,params,protocolVersion:1})+'\n');});}
(async()=>{try{const d=await req('discover');const s=d.sessions.filter(s=>s.cadId==='solidworks'&&s.connectable);if(s.length!==1)throw Error('Need one connectable SolidWorks session');console.log('CONNECT',JSON.stringify(await req('connect',{sessionId:s[0].id})));const snapshot=await req('snapshot',{scope:'document'});fs.mkdirSync(path.join(root,'.local'),{recursive:true});fs.writeFileSync(path.join(root,'.local/solidworks-readonly-probe.json'),JSON.stringify(snapshot,null,2));console.log('READONLY_RESULT',JSON.stringify({title:snapshot.title,models:snapshot.models.length,warnings:snapshot.warnings,propertyCount:snapshot.models.reduce((n,m)=>n+m.properties.length,0)}));await req('disconnect');}finally{child.stdin.end();reader.close();}})().catch(e=>{console.error(e);child.kill();process.exitCode=1;});
setTimeout(()=>{if(child.exitCode===null){console.error('Read-only probe timed out');child.kill();process.exitCode=1;}},60000).unref();
