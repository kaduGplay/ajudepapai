import test from 'node:test';
import assert from 'node:assert/strict';
process.env.VERCEL = '1';
process.env.VOIDPAY_PUBLIC_KEY = 'test';
process.env.VOIDPAY_SECRET_KEY = 'test';
process.env.UTMIFY_API_TOKEN = 'test';
process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example.test';
process.env.UPSTASH_REDIS_REST_TOKEN = 'test';
const values = new Map(), scores = new Map(), sent = [];
let fail = false;
global.fetch = async (url, options = {}) => {
 if (url === process.env.UPSTASH_REDIS_REST_URL) {
  if(fail) throw new Error('redis offline');
  const [op,...args] = JSON.parse(options.body);let result;
  if(op==='GET') result = values.get(args[0]) ?? null;
  else if(op==='SET') { result = args.includes('NX') && values.has(args[0]) ? null : 'OK';if(result)values.set(args[0],args[1]); }
  else if(op==='ZRANGEBYSCORE') result=[...scores].filter(([,score])=>score<=Number(args[2])).sort((a,b)=>a[1]-b[1]).slice(0,args[5]).map(([id])=>id);
  else if(op==='ZREM') result=Number(scores.delete(args[1]));
  else if(op==='EVAL') {
   const [,count,...rest]=args;
   if(count===1){const [key,token]=rest;result=values.get(key)===token?Number(values.delete(key)):0;}
   else {const [orderKey,,lockKey,transactionKey,token,json,,nextCheck,id,transactionId]=rest;
    result = token && values.get(lockKey)!==token ? 0 : 1;
    if(result){values.set(orderKey,json);scores.set(id,Number(nextCheck));if(transactionId)values.set(transactionKey,id);}
   }
  } else throw new Error('unexpected Redis command');
  return {ok:true,status:200,json:async()=>({result})};
 }
 if(url.includes('api-credentials')){sent.push(JSON.parse(options.body));return {ok:true,json:async()=>({OK:true})};}
 return {ok:true,json:async()=>({status:'COMPLETED',payedAt:new Date().toISOString()})};
};
const {store} = await import('../dist/store.js');
const {newOrder,saveOrder,syncOrder,findOrder} = await import('../dist/orders.js');
test('Vercel uses shared storage, serializes concurrent confirmations and survives fresh module instances',async()=>{
 const order=await newOrder(3000,{name:'Doador anônimo',email:'doacao@campanhasolidaria.fun',phone:null,document:null,country:'BR'},{utm_source:'FB'});
 order.transactionId='redis-order';await saveOrder(order);
 const fresh=await import('../dist/store.js?fresh-instance');
 assert.equal((await fresh.store.find('redis-order')).amount,3000);
 await Promise.all([syncOrder(structuredClone(order)),syncOrder(structuredClone(order))]);
 assert.equal(sent.length,1);assert.equal(sent[0].status,'paid');
 assert.equal((await findOrder('redis-order')).sentStatus,'paid');
 assert.equal(sent[0].trackingParameters.utm_source,'FB');
 const lease=await store.lock(order.id);
 assert.equal(await fresh.store.lock(order.id),null);
 await fresh.store.unlock(order.id,'wrong-lease');assert.equal(await store.lock(order.id),null);
 await store.unlock(order.id,lease);
 await assert.rejects(store.save({...order,status:'waiting_payment'},lease),/Lock expirou/);
 assert.equal((await store.find('redis-order')).status,'paid');
 fail=true;await assert.rejects(newOrder(3000,order.customer,{}),/redis offline/);
});
