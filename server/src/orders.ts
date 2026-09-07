import { store } from './store.js';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { getTransaction, type TransactionDetails } from './voidpay.js';

export interface Order {
  id: string; transactionId?: string; callbackToken: string; amount: number; fee: number;
  createdAt: string; approvedDate: string | null; refundedAt: string | null;
  status: 'waiting_payment' | 'paid' | 'refused' | 'refunded' | 'chargedback';
  customer: { name: string; email: string; phone: string | null; document: string | null; country: string };
  tracking: Record<string, string | null>; sentStatus?: string; nextCheck: number;
}
export const utc = (value: string) => new Date(value).toISOString().slice(0, 19).replace('T', ' ');
export const saveOrder = (order: Order) => store.save(order);
export async function newOrder(amount: number, customer: Order['customer'], tracking: unknown): Promise<Order> {
  const params = tracking && typeof tracking === 'object' ? tracking as Record<string, unknown> : {};
  const order: Order = { id: randomUUID(), callbackToken: randomUUID(), amount, fee: 0,
    createdAt: new Date().toISOString(), approvedDate: null, refundedAt: null,
    status: 'waiting_payment', customer, nextCheck: 0,
    tracking: Object.fromEntries(['src','sck','utm_source','utm_campaign','utm_medium','utm_content','utm_term'].map(key => [key, typeof params[key] === 'string' ? params[key].slice(0, 1000) : null])) };
  await saveOrder(order);
  return order;
}
export const findOrder = (transactionId: string) => store.find(transactionId);
export const findCallback = async (id: string, token: string) => {
  const order = await store.get(id);
  return order?.callbackToken === token ? order : undefined;
};
export function applyTransaction(order: Order, transaction: TransactionDetails) {
  const status = transaction.status;
  if (status === 'REFUNDED') {
    order.status = 'refunded'; order.refundedAt = transaction.refundedAt || new Date().toISOString();
  } else if (status === 'CHARGED_BACK') {
    order.status = 'chargedback'; order.refundedAt = transaction.refundedAt || new Date().toISOString();
  } else if (status === 'COMPLETED') {
    if (!['refunded', 'chargedback'].includes(order.status)) order.status = 'paid';
    order.approvedDate ||= transaction.payedAt || new Date().toISOString();
  } else if (status === 'FAILED' && order.status === 'waiting_payment') order.status = 'refused';
  if (transaction.payedAt) order.approvedDate ||= transaction.payedAt;
}
export function payload(order: Order, isTest = false) {
  return { orderId: order.transactionId, platform: 'CampanhaSolidaria', paymentMethod: 'pix', status: order.status,
    createdAt: utc(order.createdAt), approvedDate: order.approvedDate ? utc(order.approvedDate) : null,
    refundedAt: order.refundedAt ? utc(order.refundedAt) : null, customer: order.customer,
    products: [{ id: 'RubzhOGiaWpd', name: 'Doação Campanha Heloisa', planId: null, planName: null, quantity: 1, priceInCents: order.amount }],
    trackingParameters: order.tracking,
    commission: { totalPriceInCents: order.amount, gatewayFeeInCents: order.fee, userCommissionInCents: order.amount - order.fee, currency: 'BRL' }, isTest };
}
export async function syncOrder(original: Order, refresh = true): Promise<boolean> {
  const lease = await store.lock(original.id);
  if (!lease) return false;
  let order: Order | undefined;
  let ok = false;
  try {
    order = await store.get(original.id);
    if (!order?.transactionId) return false;
    if (refresh) applyTransaction(order, await getTransaction(order.transactionId));
    // Persist gateway confirmation before attempting a third-party delivery.
    await store.save(order, lease);
    if (order.sentStatus !== order.status) {
      const age = Date.now() - Date.parse(order.createdAt);
      const maxAge = ['refunded','chargedback'].includes(order.status) ? 45 : 7;
      if (age > maxAge * 86400000) {
        console.error('Pedido fora da janela de envio Utmify:', order.id);
        return false;
      }
      const response = await fetch('https://api.utmify.com.br/api-credentials/orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-token': config.utmifyToken },
        body: JSON.stringify(payload(order)), signal: AbortSignal.timeout(8000) });
      const body = await response.json().catch(() => null);
      if (!response.ok || body?.error || body?.success === false) throw new Error(`Utmify HTTP ${response.status}`);
      order.sentStatus = order.status;
    }
    ok = true;
  } catch (error) {
    console.error('Falha de sincronização; nova tentativa agendada:', original.id, error instanceof Error ? error.message : 'erro');
  } finally {
    try {
      if (order) {
        order.nextCheck = Date.now() + (order.status === 'waiting_payment' || order.sentStatus !== order.status ? 60000 : 3600000);
        await store.save(order, lease);
        Object.assign(original, order);
      }
    } finally { await store.unlock(original.id, lease); }
  }
  return ok;
}
export async function reconcileOrders(limit = 10) {
  const ids = await store.due(limit);
  const results = await Promise.all(ids.map(async id => {
    const order = await store.get(id);
    if (!order || Date.now() - Date.parse(order.createdAt) > 45 * 86400000) {
      await store.removeDue(id);return false;
    }
    // Incomplete gateway creations cannot be retried safely as new charges.
    if (!order.transactionId) {
      if (Date.now() - Date.parse(order.createdAt) > 300000) await store.removeDue(id);
      return false;
    }
    return syncOrder(order);
  }));
  return { checked: ids.length, synced: results.filter(Boolean).length };
}
export function startWorker() {
  if (process.env.VERCEL) return;
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await reconcileOrders(); } catch { console.error('Falha ao consultar pedidos pendentes'); }
    finally { running = false; }
  };
  const timer = setInterval(() => { void run(); }, 15000);
  timer.unref(); void run();
}
