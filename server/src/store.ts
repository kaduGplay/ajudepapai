import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import type { Order } from './orders.js';

const prefix = 'campanha:v1:';
const dueKey = `${prefix}due`;
const orderKey = (id: string) => `${prefix}order:${id}`;
const lockKey = (id: string) => `${prefix}lock:${id}`;
const transactionKey = (id: string) => `${prefix}transaction:${id}`;
const ttl = 90 * 86400;
export async function redis<T>(command: (string | number)[]): Promise<T> {
  if (!config.redisUrl || !config.redisToken) throw new Error('Configure UPSTASH_REDIS_REST_URL e UPSTASH_REDIS_REST_TOKEN');
  const response = await fetch(config.redisUrl, { method: 'POST', headers: { Authorization: `Bearer ${config.redisToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(command), signal: AbortSignal.timeout(3000) });
  const body = await response.json() as { result: T; error?: string };
  if (!response.ok || body.error) throw new Error(`Armazenamento indisponível (HTTP ${response.status})`);
  return body.result;
}
// Atomic save: a function whose lease expired cannot overwrite a newer payment state.
const saveScript = `
if ARGV[1] ~= '' and redis.call('GET', KEYS[3]) ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
redis.call('ZADD', KEYS[2], ARGV[4], ARGV[5])
if ARGV[6] ~= '' then redis.call('SET', KEYS[4], ARGV[5], 'EX', ARGV[3]) end
return 1`;
const releaseScript = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`;

// File storage is retained only for local/VPS development, never on Vercel.
async function localStore() { return import('./store-local.js'); }
const useRedis = Boolean(config.redisUrl || process.env.VERCEL);
export const store = {
  async save(order: Order, lease = '') {
    if (!useRedis) return (await localStore()).local.save(order, lease);
    const saved = await redis<number>(['EVAL', saveScript, 4, orderKey(order.id), dueKey, lockKey(order.id), transactionKey(order.transactionId || order.id), lease, JSON.stringify(order), ttl, order.nextCheck, order.id, order.transactionId || '']);
    if (!saved) throw new Error('Lock expirou; atualização descartada');
  },
  async get(id: string): Promise<Order | undefined> {
    if (!useRedis) return (await localStore()).local.get(id);
    const raw = await redis<string | null>(['GET', orderKey(id)]);
    return raw ? JSON.parse(raw) as Order : undefined;
  },
  async find(transactionId: string): Promise<Order | undefined> {
    if (!useRedis) return (await localStore()).local.find(transactionId);
    const id = await redis<string | null>(['GET', transactionKey(transactionId)]);
    return id ? this.get(id) : undefined;
  },
  async due(limit: number): Promise<string[]> {
    if (!useRedis) return (await localStore()).local.due(limit);
    return redis<string[]>(['ZRANGEBYSCORE', dueKey, '-inf', Date.now(), 'LIMIT', 0, limit]);
  },
  async removeDue(id: string) {
    if (!useRedis) return (await localStore()).local.removeDue(id);
    await redis(['ZREM', dueKey, id]);
  },
  async lock(id: string): Promise<string | null> {
    if (!useRedis) return (await localStore()).local.lock(id);
    const token = randomUUID();
    return await redis(['SET', lockKey(id), token, 'NX', 'EX', 120]) === 'OK' ? token : null;
  },
  async unlock(id: string, token: string) {
    if (!useRedis) return (await localStore()).local.unlock(id, token);
    await redis(['EVAL', releaseScript, 1, lockKey(id), token]);
  }
};
