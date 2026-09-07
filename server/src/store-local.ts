import { mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import type { Order } from './orders.js';
if (process.env.VERCEL) throw new Error('Disco local não é permitido em produção Vercel');
const directory = path.resolve(config.dataDir);
mkdirSync(directory, { recursive: true, mode: 0o700 });
const orders = new Map<string, Order>();
const locks = new Map<string, string>();
const excluded = new Set<string>();
for (const file of readdirSync(directory).filter(name => name.endsWith('.json'))) {
  const order = JSON.parse(readFileSync(path.join(directory, file), 'utf8')) as Order;
  orders.set(order.id, order);
}
export const local = {
  save(order: Order, lease: string) {
    if (lease && locks.get(order.id) !== lease) throw new Error('Lock expirou');
    const filename = path.join(directory, `${order.id}.json`);
    writeFileSync(`${filename}.tmp`, JSON.stringify(order), { mode: 0o600 });
    renameSync(`${filename}.tmp`, filename);orders.set(order.id, structuredClone(order));
  },
  get(id: string) { const order = orders.get(id);return order ? structuredClone(order) : undefined; },
  find(id: string) { const order = [...orders.values()].find(o => o.transactionId === id);return order ? structuredClone(order) : undefined; },
  due(limit: number) { return [...orders.values()].filter(o => !excluded.has(o.id) && o.nextCheck <= Date.now()).sort((a,b) => a.nextCheck-b.nextCheck).slice(0,limit).map(o => o.id); },
  removeDue(id: string) { excluded.add(id); },
  lock(id: string) { if (locks.has(id)) return null;const token=randomUUID();locks.set(id,token);return token; },
  unlock(id: string, token: string) { if (locks.get(id) === token) locks.delete(id); }
};
