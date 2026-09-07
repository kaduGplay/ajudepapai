import "dotenv/config";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variável de ambiente ausente: ${name}`);
  }
  return value;
}

export const config = {
  voidpay: {
    callbackUrl: process.env.VOIDPAY_CALLBACK_URL,
    publicKey: requireEnv("VOIDPAY_PUBLIC_KEY"),
    secretKey: requireEnv("VOIDPAY_SECRET_KEY"),
    apiUrl: process.env.VOIDPAY_API_URL ?? "https://dash.voidpayments.com/api/v1",
  },
  donorDocument: process.env.PIX_DEFAULT_DOCUMENT,
  utmifyToken: requireEnv("UTMIFY_API_TOKEN"),
  siteUrl: process.env.SITE_URL ?? "https://campanhasolidaria.fun",
  redisUrl: process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL,
  redisToken: process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN,
  cronSecret: process.env.CRON_SECRET,
  dataDir: process.env.DATA_DIR ?? "./data",
  port: Number(process.env.PORT ?? 3000),
};
