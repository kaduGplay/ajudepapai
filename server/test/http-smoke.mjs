import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const port = 31987;
const child = spawn(process.execPath, ['dist/server.js'], { env: { ...process.env, PORT:String(port), DATA_DIR:mkdtempSync(path.join(tmpdir(),'utmify-http-')), VOIDPAY_PUBLIC_KEY:'test', VOIDPAY_SECRET_KEY:'test', UTMIFY_API_TOKEN:'test', CRON_SECRET:'test-cron-secret' }, stdio:['ignore','pipe','pipe'] });
try {
 await new Promise((resolve,reject)=> { const timeout=setTimeout(()=>reject(new Error('Server startup timeout')),5000);child.stdout.once('data',()=>{clearTimeout(timeout);resolve()});child.once('exit',code=>{clearTimeout(timeout);reject(new Error(`Server exited ${code}`))});child.stderr.on('data',data=>process.stderr.write(data)) });
 const base=`http://127.0.0.1:${port}`;
 assert.equal((await fetch(base+'/api/cron/reconcile')).status,401);
 assert.equal((await fetch(base+'/api/cron/reconcile',{headers:{authorization:'Bearer invalid'}})).status,401);
 assert.equal((await fetch(base+'/api/cron/reconcile',{headers:{authorization:'Bearer test-cron-secret'}})).status,200);
 for(const route of ['/', '/images/heloisa.jpeg','/health']) assert.equal((await fetch(base+route)).status,200,route);
 for(const route of ['/server/.env','/server/src/config.ts','/server/data/orders.json','/.env']) assert.equal((await fetch(base+route)).status,404,route);
 assert.equal((await fetch(base+'/api/gerar-pix',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({amount:0})})).status,400);
 assert.equal((await fetch(base+'/api/webhooks/voidpay/unknown/wrong',{method:'POST'})).status,404);
 console.log('OK: página, foto, health; arquivos privados bloqueados; dados inválidos e callback desconhecido recusados.');
} finally { child.kill(); }
