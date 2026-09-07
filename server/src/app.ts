import express, { type ErrorRequestHandler, type RequestHandler } from "express";
import { timingSafeEqual } from "node:crypto";

import path from "node:path";
import { fileURLToPath } from "node:url";
import { newOrder, saveOrder, findOrder, findCallback, syncOrder, reconcileOrders } from "./orders.js";
import { callbackUrl, isSharedCallback, notificationOrder } from "./webhook.js";
import { config } from "./config.js";
import { createPixTransaction, getTransaction, VoidPayApiError } from "./voidpay.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, "../..");

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));
app.get(['/health', '/api/health'], (_req, res) => res.json({ ok: true }));
app.get('/', (_req, res) => res.sendFile(path.join(siteRoot, 'index.html')));
app.get('/index.html', (_req, res) => res.sendFile(path.join(siteRoot, 'index.html')));
for (const folder of ['images', 'css', 'js', 'fonts']) app.use(`/${folder}`, express.static(path.join(siteRoot, folder), { dotfiles: 'deny' }));
app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
const asyncRoute = (handler: RequestHandler): RequestHandler => (req, res, next) => { Promise.resolve(handler(req, res, next)).catch(next); };
app.get('/api/cron/reconcile', asyncRoute(async (req, res) => {
  const expected = Buffer.from(`Bearer ${config.cronSecret || ''}`);
  const actual = Buffer.from(req.headers.authorization || '');
  if (!config.cronSecret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return res.sendStatus(401);
  const deadline = Date.now() + 15000;
  const totals = { checked: 0, synced: 0 };
  do {
    const result = await reconcileOrders();
    totals.checked += result.checked;totals.synced += result.synced;
    if (result.checked < 10) break;
  } while (Date.now() < deadline && totals.checked < 200);
  return res.json(totals);
}));
app.post('/api/webhooks/voidpay/:id/:token', asyncRoute(async (req, res) => {
  const shared = isSharedCallback(req.params.id, req.params.token);
  const legacyOrder = shared ? undefined : await findCallback(req.params.id, req.params.token);
  if (!shared && !legacyOrder) return res.sendStatus(404);
  // The URL authenticates the notification; its body only identifies the order.
  // Payment status is always fetched through the authenticated gateway API.
  const order = await notificationOrder(req.body) ?? (shared ? undefined : legacyOrder);
  if (!order) {
    console.warn('Webhook sem pedido reconhecido; será necessário repetir a notificação');
    return res.sendStatus(503);
  }
  const ok = await syncOrder(order);
  return res.sendStatus(ok ? 200 : 503);
}));

interface GerarPixBody {
  amount?: number;
  valor?: number;
  product?: string;
  trackingParameters?: unknown;
}

app.post("/api/gerar-pix", async (req, res) => {
  const body = (req.body ?? {}) as GerarPixBody;

  const amountEmCentavos = body.amount ?? (body.valor ? Math.round(body.valor * 100) : null);
  if (!Number.isSafeInteger(amountEmCentavos) || !amountEmCentavos || amountEmCentavos < 2000 || amountEmCentavos > 110000) {
    return res.status(400).json({ success: false, error: "Valor inválido ou ausente" });
  }
  const amountEmReais = amountEmCentavos / 100;

  const nome = 'Doador anônimo';
  const email = 'doacao@campanhasolidaria.fun';

  try {
    const fixedCallback = callbackUrl();
    const order = await newOrder(amountEmCentavos, { name: nome, email, phone: null, document: null, country: 'BR' }, body.trackingParameters);
    const result = await createPixTransaction({
      identifier: order.id,
      callbackUrl: fixedCallback,
      metadata: { orderId: order.id },
      amount: amountEmReais,
      client: { name: nome, email, phone: '00000000000', document: config.donorDocument },
      products: [{ id: 'RubzhOGiaWpd', name: 'Doação Campanha Heloisa', quantity: 1, price: amountEmReais }],
    });

    if (!result.transactionId || !result.pix?.code) throw new Error('Resposta PIX inválida');
    order.transactionId = result.transactionId;
    // Gateway fee units are not documented here: report the full amount as commission.
    await saveOrder(order);
    await syncOrder(order, false);
    return res.json({
      success: true,
      pix_code: result.pix.code,
      pix_qrcode_base64: result.pix.base64 || null,
      pix_qrcode_url: result.pix.image ?? null,
      external_id: result.transactionId,
      order_url: result.order.url ?? null,
    });
  } catch (err) {
    if (err instanceof VoidPayApiError) {
      const message = typeof err.body === "string" ? err.body : err.body.message;
      console.error("Erro da VoidPay ao gerar PIX:", err.statusCode);
      return res.status(err.statusCode).json({ success: false, error: message });
    }
    console.error("Erro ao gerar PIX:", err);
    return res.status(500).json({ success: false, error: "Erro inesperado ao gerar PIX" });
  }
});

app.get("/api/verificar-pix", async (req, res) => {
  const id = req.query.id;
  if (!id || typeof id !== "string") {
    return res.status(400).json({ success: false, error: "ID da transação não fornecido" });
  }

  try {
    const order = await findOrder(id);
    if (!order) return res.status(404).json({ success: false, error: 'Transação não encontrada' });
    const transaction = await getTransaction(id);
    await syncOrder(order);
    const paid = transaction.status === "COMPLETED";

    return res.json({
      success: true,
      status: paid ? "paid" : transaction.status.toLowerCase(),
      paid_amount: paid ? transaction.chargeAmount : 0,
      amount: transaction.amount,
      paid_at: transaction.payedAt,

    });
  } catch (err) {
    if (err instanceof VoidPayApiError) {
      const message = typeof err.body === "string" ? err.body : err.body.message;
      return res.status(err.statusCode).json({ success: false, error: message });
    }
    console.error("Erro ao consultar PIX:", err);
    return res.status(500).json({ success: false, error: "Erro inesperado ao consultar transação" });
  }
});

const handleError: ErrorRequestHandler = (error, _req, res, _next) => {
  console.error('Falha na requisição:', error instanceof Error ? error.message : 'erro');
  res.status(503).json({ success: false, error: 'Serviço temporariamente indisponível. Tente novamente.' });
};
app.use(handleError);
export default app;
