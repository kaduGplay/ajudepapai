import { config } from './config.js';
import { store } from './store.js';
import { findOrder, type Order } from './orders.js';

export function callbackUrl(): string {
  const value = config.voidpay.callbackUrl;
  if (!value) throw new Error('Configure VOIDPAY_CALLBACK_URL com um webhook fixo');
  return value;
}
export function isSharedCallback(id: string, token: string): boolean {
  if (!config.voidpay.callbackUrl) return false;
  return new URL(config.voidpay.callbackUrl).pathname === `/api/webhooks/voidpay/${id}/${token}`;
}
export function notificationIds(payload: unknown): string[] {
  const found = new Set<string>();
  function visit(value: unknown, depth: number) {
    if (!value || typeof value !== 'object' || depth > 4) return;
    const object = value as Record<string, unknown>;
    for (const key of ['id', 'transactionId', 'transaction_id', 'identifier', 'clientIdentifier', 'orderId', 'order_id', 'external_id']) {
      const id = object[key];
      if (typeof id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(id)) found.add(id);
    }
    for (const key of ['data','transaction','payment','order','metadata','payload','resource']) visit(object[key], depth + 1);
  }
  visit(payload, 0);
  return [...found].slice(0, 12);
}
export async function notificationOrder(payload: unknown): Promise<Order | undefined> {
  for (const id of notificationIds(payload)) {
    const order = await findOrder(id) ?? await store.get(id);
    if (order?.transactionId) return order;
  }
  return undefined;
}
