import test from 'node:test';
import assert from 'node:assert/strict';
process.env.VOIDPAY_PUBLIC_KEY='test';process.env.VOIDPAY_SECRET_KEY='test';process.env.UTMIFY_API_TOKEN='test';
process.env.VOIDPAY_CALLBACK_URL='https://example.com/api/webhooks/voidpay/fixed/token';
const {callbackUrl,isSharedCallback,notificationIds}=await import('../dist/webhook.js');
test('all payments share a fixed callback, with exact URL authentication',()=>{
 assert.equal(callbackUrl(),callbackUrl());
 assert.equal(isSharedCallback('fixed','token'),true);
 assert.equal(isSharedCallback('fixed','wrong'),false);
 assert.deepEqual(notificationIds({data:{transaction:{id:'tx-123'},metadata:{orderId:'order-456'}}}),['tx-123','order-456']);
 assert.deepEqual(notificationIds({status:'paid',amount:100,transactionId:'../../invalid'}),[]);
});
