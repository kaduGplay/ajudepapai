import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
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
const directory = path.resolve(config.dataDir);
mkdirSync(directory, { recursive: true, mode: 0o700 });
const orders = new Map<string, Order>();
for (const filename of readdirSync(directory).filter(name => name.endsWith('.json'))) {
  const order = JSON.parse(readFileSync(path.join(directory, filename), 'utf8')) as Order;
  orders.set(order.id, order);
}
export const utc = (value: string) => new Date(value).toISOString().slice(0, 19).replace('T', ' ');
export function saveOrder(order: Order) {
  const target = path.join(directory, `${order.id}.json`);
  const temporary = `${target}.tmp`;
  writeFileSync(temporary, JSON.stringify(order), { mode: 0o600 });
  renameSync(temporary, target);
  orders.set(order.id, order);
}
export function newOrder(amount: number, customer: Order['customer'], tracking: unknown): Order {
  const params = tracking && typeof tracking === 'object' ? tracking as Record<string, unknown> : {};
  const order: Order = { id: randomUUID(), callbackToken: randomUUID(), amount, fee: 0,
    createdAt: new Date().toISOString(), approvedDate: null, refundedAt: null,
    status: 'waiting_payment', customer, nextCheck: 0,
    tracking: Object.fromEntries(['src','sck','utm_source','utm_campaign','utm_medium','utm_content','utm_term'].map(key => [key, typeof params[key] === 'string' ? params[key].slice(0, 1000) : null])) };
  saveOrder(order);
  return order;
}
export const findOrder = (transactionId: string) => [...orders.values()].find(order => order.transactionId === transactionId);
export const findCallback = (id: string, token: string) => {
  const order = orders.get(id);
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
  saveOrder(order);
}
export function payload(order: Order, isTest = false) {
  return { orderId: order.transactionId, platform: 'CampanhaSolidaria', paymentMethod: 'pix', status: order.status,
    createdAt: utc(order.createdAt), approvedDate: order.approvedDate ? utc(order.approvedDate) : null,
    refundedAt: order.refundedAt ? utc(order.refundedAt) : null, customer: order.customer,
    products: [{ id: 'RubzhOGiaWpd', name: 'Doação Campanha Heloisa', planId: null, planName: null, quantity: 1, priceInCents: order.amount }],
    trackingParameters: order.tracking,
    commission: { totalPriceInCents: order.amount, gatewayFeeInCents: order.fee, userCommissionInCents: order.amount - order.fee, currency: 'BRL' }, isTest };
}
const busy = new Set<string>();
export async function syncOrder(order: Order, refresh = true) {
  if (!order.transactionId || busy.has(order.id)) return;
  busy.add(order.id);
  try {
    if (refresh) applyTransaction(order, await getTransaction(order.transactionId));
    if (order.sentStatus !== order.status) {
      const age = Date.now() - Date.parse(order.createdAt);
      const maxAge = ['refunded','chargedback'].includes(order.status) ? 45 : 7;
      if (age > maxAge * 86400000) return;
      const sentStatus = order.status;
      const response = await fetch('https://api.utmify.com.br/api-credentials/orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-token': config.utmifyToken },
        body: JSON.stringify(payload(order)), signal: AbortSignal.timeout(15000) });
      const body = await response.json().catch(() => null);
      if (!response.ok || body?.error || body?.success === false) throw new Error(`Utmify HTTP ${response.status}`);
      order.sentStatus = sentStatus;
    }
  } catch (error) {
    console.error('Falha de sincronização; nova tentativa agendada:', order.id, error instanceof Error ? error.message : 'erro');
  } finally {
    order.nextCheck = Date.now() + (order.status === 'waiting_payment' || order.sentStatus !== order.status ? 60000 : 3600000);
    saveOrder(order); busy.delete(order.id);
  }
}
export function startWorker() {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      for (const order of orders.values()) {
        const age = Date.now() - Date.parse(order.createdAt);
        if (order.transactionId && order.nextCheck <= Date.now() && age <= 45 * 86400000) await syncOrder(order);
      }
    } finally { running = false; }
  };
  const timer = setInterval(() => { void run(); }, 15000);
  timer.unref(); void run();
}
