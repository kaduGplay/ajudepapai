import { config } from "./config.js";

export interface VoidPayClient {
  name: string;
  email: string;
  phone?: string;
  document?: string;
}

export interface VoidPayProduct {
  id: string;
  name: string;
  quantity?: number;
  price: number;
  physical?: boolean;
}

export interface CreatePixParams {
  identifier: string;
  amount: number;
  client: VoidPayClient;
  products?: VoidPayProduct[];
  metadata?: Record<string, string>;
  callbackUrl?: string;
}

export interface CreatePixResponse {
  transactionId: string;
  status: "OK" | "FAILED" | "PENDING" | "REJECTED" | "CANCELED";
  webhookToken?: string;
  fee: number;
  order: { id: string; url?: string; receiptUrl?: string };
  pix: { code: string; image?: string; base64: string };
}

export interface VoidPayErrorResponse {
  statusCode: number;
  errorCode: string;
  message: string;
  details?: { field: string; value: unknown; issue: string };
}

export type TransactionStatus = "PENDING" | "COMPLETED" | "FAILED" | "REFUNDED" | "CHARGED_BACK";

export interface TransactionDetails {
  id: string;
  clientIdentifier: string | null;
  currency: string;
  amount: number;
  chargeAmount: number;
  status: TransactionStatus;
  statusDescription: string | null;
  paymentMethod: string;
  errorDescription: string | null;
  webhookUrl: string | null;
  createdAt: string;
  refundedAt: string | null;
  payedAt: string | null;
  pixInformation?: { qrCode: string; image: string | null; base64: string };
}

export class VoidPayApiError extends Error {
  constructor(public statusCode: number, public body: VoidPayErrorResponse | string) {
    super(typeof body === "string" ? body : body.message);
  }
}

function authHeaders(): Record<string, string> {
  return {
    "x-public-key": config.voidpay.publicKey,
    "x-secret-key": config.voidpay.secretKey,
    "Content-Type": "application/json",
  };
}

export async function createPixTransaction(params: CreatePixParams): Promise<CreatePixResponse> {
  const res = await fetch(`${config.voidpay.apiUrl}/gateway/pix/receive`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(20000),
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    throw new VoidPayApiError(res.status, (data as VoidPayErrorResponse) ?? `HTTP ${res.status}`);
  }

  return data as CreatePixResponse;
}

export async function getTransaction(transactionId: string): Promise<TransactionDetails> {
  const url = `${config.voidpay.apiUrl}/gateway/transactions?id=${encodeURIComponent(transactionId)}`;
  const res = await fetch(url, { method: "GET", headers: authHeaders(), signal: AbortSignal.timeout(8000) });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    throw new VoidPayApiError(res.status, (data as VoidPayErrorResponse) ?? `HTTP ${res.status}`);
  }

  return data as TransactionDetails;
}
