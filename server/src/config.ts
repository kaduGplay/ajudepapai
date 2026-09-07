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
    publicKey: requireEnv("VOIDPAY_PUBLIC_KEY"),
    secretKey: requireEnv("VOIDPAY_SECRET_KEY"),
    apiUrl: process.env.VOIDPAY_API_URL ?? "https://dash.voidpayments.com/api/v1",
  },
  utmifyToken: requireEnv("UTMIFY_API_TOKEN"),
  siteUrl: process.env.SITE_URL ?? "https://campanhasolidaria.fun",
  dataDir: process.env.DATA_DIR ?? "./data",
  port: Number(process.env.PORT ?? 3000),
};
