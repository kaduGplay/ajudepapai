# GitHub → Vercel → campanhasolidaria.fun

O projeto está adaptado para funções Vercel com Upstash Redis. O visitante escolhe o valor e gera o PIX sem preencher dados pessoais. O servidor envia identificação genérica, telefone com zeros e o documento fixo configurado em PIX_DEFAULT_DOCUMENT, conforme solicitado pelo responsável pela campanha. Esse documento não é coletado do visitante nem enviado como documento do doador à Utmify.

## 1. Subir no GitHub

Envie a raiz inteira do projeto, incluindo `api`, `server/src`, `scripts`, `package.json`, `package-lock.json` e `vercel.json`. Não selecione apenas `index.html`.

O `.gitignore` exclui `.env`, `.env.*` (exceto `.env.example`), `node_modules`, pedidos locais, arquivos compilados e `.vercel`. As credenciais reais ficam em `server/.env` e NÃO devem ser enviadas manualmente pelo upload do GitHub. O upload manual não aplica o `.gitignore` automaticamente. Se arquivos secretos já tiverem sido enviados, exclua-os do histórico e substitua as credenciais expostas.

## 2. Importar na Vercel

- **Root Directory:** raiz do repositório (`.`), não `server`.
- **Framework Preset:** Other.
- **Node.js:** 22.x.
- **Build Command:** `npm run build`.
- **Output Directory:** `public`.
- **Install Command:** padrão (`npm install`).

O `vercel.json` já define build, saída, função e rotas. O build copia somente a página e os recursos públicos. A API é uma função separada; não inicia servidor nem temporizador contínuo na Vercel.

## 3. Conectar banco e variáveis ANTES de receber doações

No projeto Vercel, abra Storage/Marketplace, conecte um banco **Upstash Redis** e habilite as variáveis para Production. Use o token de leitura e escrita, não um token somente leitura. A integração pode disponibilizar `KV_REST_API_URL` e `KV_REST_API_TOKEN`; esses nomes também são aceitos.

Em Settings → Environment Variables, configure:

| Variável | Valor |
| --- | --- |
| `VOIDPAY_PUBLIC_KEY` | Chave pública existente em `server/.env` |
| `VOIDPAY_SECRET_KEY` | Chave secreta existente em `server/.env` |
| `UTMIFY_API_TOKEN` | Chave Utmify existente em `server/.env` |
| `SITE_URL` | `https://campanhasolidaria.fun` |
| `UPSTASH_REDIS_REST_URL` | URL REST fornecida pelo Upstash |
| `UPSTASH_REDIS_REST_TOKEN` | Token REST de leitura e escrita fornecido pelo Upstash |
| `PIX_DEFAULT_DOCUMENT` | Documento fixo autorizado, existente em `server/.env` |
| `CRON_SECRET` | Segredo aleatório de pelo menos 32 caracteres |

Não prefixe as chaves com `NEXT_PUBLIC_`, não as coloque no HTML e não configure `DATA_DIR` na Vercel. Gere `CRON_SECRET`, por exemplo, com `openssl rand -hex 32`. Faça Redeploy após alterar as variáveis. Não conecte previews de branches ao mesmo banco/chaves de produção para testes de pagamento.

## 4. Domínio e callback

Adicione `campanhasolidaria.fun` em Settings → Domains e copie exatamente os registros DNS indicados pela Vercel para seu provedor. Aguarde a validação do domínio e HTTPS. Se adicionar `www`, configure o redirecionamento para o domínio principal.

Cada PIX é criado com um callback individual em:

`https://campanhasolidaria.fun/api/webhooks/voidpay/<pedido>/<token>`

A aplicação gera os dois identificadores automaticamente. Não substitua a URL no gateway por uma URL fixa. O gateway precisa conseguir acessar o domínio de produção sem uma tela de login/Deployment Protection. Confirme nos logs do gateway a entrega real do callback.

O webhook consulta a API autenticada da VoidPay; ignora o status alegado no corpo da notificação. Só envia `paid` à Utmify após confirmação da VoidPay. Em falha ou concorrência responde 503 para permitir nova tentativa. O pedido já salvo também fica na fila persistente do Redis.

## 5. Novas tentativas e cron

O cron padrão é diário, `0 6 * * *`, para ser aceito no plano Hobby. O webhook confirma pagamentos sem depender da página aberta; a consulta do navegador também sincroniza. O cron recupera notificações/envios perdidos em lotes de até 200 pedidos, limitados pelo tempo disponível. Se houver mais pedidos, eles permanecem na fila para execuções seguintes. Monitore os logs e o volume da fila; cron diário não garante recuperação rápida de falhas.

Para recuperação frequente, no plano Pro altere o schedule para `* * * * *` e publique novamente. Outra opção é um agendador externo que faça GET a `https://campanhasolidaria.fun/api/cron/reconcile` a cada minuto com o header `Authorization: Bearer <CRON_SECRET>`. Não coloque o segredo na URL.

Os registros expiram após 90 dias sem gravação. O acompanhamento automático termina após 45 dias da criação. As janelas da Utmify continuam sendo 7 dias para vendas e 45 para reembolso/chargeback. Os logs avisam quando uma venda está fora da janela. Uma trava compartilhada evita atualizações concorrentes; o ID do pedido permanece igual em todas as tentativas, inclusive se uma resposta da Utmify for perdida.

## 6. Conferência após o deploy

1. Abra `/api/health` (verifica a função, não testa credenciais externas) e confira a página e imagem.
2. Confirme que `/server/.env`, `/server/src/config.ts` e arquivos privados retornam 404.
3. Valide um PIX real quando estiver pronto para essa cobrança: confira o pedido pendente na Utmify, pague, feche a página e verifique o mesmo pedido como pago. Confira a entrega do webhook e os logs de sincronização.
4. A chamada ao cron sem Authorization deve retornar 401. Com o segredo correto, retorna contagens `checked` e `synced`.

A credencial Utmify foi validada anteriormente com `isTest=true`, sem gravar venda. Banco Upstash, deploy Vercel e confirmação real do gateway ainda exigem validação no ambiente configurado. Não foi feita uma cobrança real para testar este deploy.

A geração de cobrança não é repetida automaticamente se o gateway responder com timeout: confirme no gateway antes de tentar novamente. Um timeout pode ocorrer depois de o PIX ter sido criado.

## Rastreamento

Pixel Utmify: `6a8a10f4e08f7866db223c66`. Pixel Meta: `1509232324297951`.

UTMs, `src` e `sck` são armazenados com o pedido. Datas seguem UTC e `createdAt` não muda. Valores são enviados em centavos. Enquanto as unidades da taxa do gateway não forem confirmadas, a comissão informada é o valor integral, opção permitida pela Utmify; não representa receita líquida.

A confirmação Utmify funciona pelo servidor com a página fechada. O evento Purchase do pixel Meta continua dependendo do navegador aberto; Meta Conversions API não foi configurada.

## Desenvolvimento

Na raiz: `npm install`, `npm run build`, `npm test`.

Para servidor local: configure `server/.env` e execute `cd server && npm start`. Sem Redis e fora da Vercel, o modo local usa `DATA_DIR` e um único processo. Docker/Compose continuam disponíveis para VPS; não são usados pela Vercel.

Referências: [Redis na Vercel](https://vercel.com/docs/redis), [limites de cron](https://vercel.com/docs/cron-jobs/usage-and-pricing), [proteção de cron](https://vercel.com/docs/cron-jobs/manage-cron-jobs), [API REST Upstash](https://upstash.com/docs/redis/features/restapi).
