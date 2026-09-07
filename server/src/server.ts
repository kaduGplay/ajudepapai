import express from "express";

import path from "node:path";
import { fileURLToPath } from "node:url";
import { newOrder, saveOrder, findOrder, findCallback, syncOrder, startWorker } from "./orders.js";
import { config } from "./config.js";
import { createPixTransaction, getTransaction, VoidPayApiError } from "./voidpay.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(__dirname, "../..");

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/', (_req, res) => res.sendFile(path.join(siteRoot, 'index.html')));
app.get('/index.html', (_req, res) => res.sendFile(path.join(siteRoot, 'index.html')));
for (const folder of ['images', 'css', 'js', 'fonts']) app.use(`/${folder}`, express.static(path.join(siteRoot, folder), { dotfiles: 'deny' }));
app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
app.post('/api/webhooks/voidpay/:id/:token', async (req, res) => {
  const order = findCallback(req.params.id, req.params.token);
  if (!order) return res.sendStatus(404);
  // Never trust the callback's reported status: confirm through the authenticated gateway API.
  order.nextCheck = 0;
  saveOrder(order);
  void syncOrder(order);
  return res.sendStatus(202);
});

interface GerarPixBody {
  amount?: number;
  valor?: number;
  product?: string;
  trackingParameters?: unknown;
}

app.post("/api/gerar-pix", async (req, res) => {
  const body = req.body as GerarPixBody;

  const amountEmCentavos = body.amount ?? (body.valor ? Math.round(body.valor * 100) : null);
  if (!Number.isSafeInteger(amountEmCentavos) || !amountEmCentavos || amountEmCentavos < 2000 || amountEmCentavos > 110000) {
    return res.status(400).json({ success: false, error: "Valor inválido ou ausente" });
  }
  const amountEmReais = amountEmCentavos / 100;

  const nome = 'Doador anônimo';
  const email = 'doacao@campanhasolidaria.fun';

  try {
    const order = newOrder(amountEmCentavos, { name: nome, email, phone: null, document: null, country: 'BR' }, body.trackingParameters);
    const result = await createPixTransaction({
      identifier: order.id,
      callbackUrl: `${config.siteUrl}/api/webhooks/voidpay/${order.id}/${order.callbackToken}`,
      amount: amountEmReais,
      client: { name: nome, email },
      products: [{ id: 'RubzhOGiaWpd', name: 'Doação Campanha Heloisa', quantity: 1, price: amountEmReais }],
    });

    if (!result.transactionId || !result.pix?.code) throw new Error('Resposta PIX inválida');
    order.transactionId = result.transactionId;
    // Gateway fee units are not documented here: report the full amount as commission.
    saveOrder(order);
    void syncOrder(order, false);
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
    const order = findOrder(id);
    if (!order) return res.status(404).json({ success: false, error: 'Transação não encontrada' });
    const transaction = await getTransaction(id);
    void syncOrder(order);
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

startWorker();
app.listen(config.port, () => {
  console.log(`Servidor PIX (VoidPay) rodando em http://localhost:${config.port}`);
});
