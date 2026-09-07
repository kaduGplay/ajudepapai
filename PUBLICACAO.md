# Publicação em campanhasolidaria.fun

O projeto usa Node 22, um processo de aplicação e disco persistente. Não publique apenas o HTML nem use funções serverless com disco temporário: o acompanhamento de pagamentos depende do servidor e dos pedidos salvos.

1. Use um servidor Linux com Docker Engine e Docker Compose. Aponte o registro A de `campanhasolidaria.fun` para o IP desse servidor e o CNAME de `www` para `campanhasolidaria.fun`. Configure AAAA apenas se o servidor tiver IPv6 funcional.
2. Transfira o projeto e, separadamente, `server/.env`. Esse arquivo contém as credenciais reais e está excluído do Git e da imagem Docker. Restrinja suas permissões (`chmod 600 server/.env`).
3. Libere as portas 80 e 443 e execute `docker compose up -d --build` na raiz. O Caddy providencia HTTPS quando o DNS aponta para o servidor.
4. Confira `https://campanhasolidaria.fun/health`, a página e `docker compose logs --tail=100 app`. Faça um PIX real de validação somente quando estiver pronto para essa transação e confira o mesmo pedido na Utmify como pendente e depois pago.
5. Confirme no gateway a entrega do callback cadastrado em cada geração. A aplicação envia uma URL individual em `/api/webhooks/voidpay/<pedido>/<token>`. Ela consulta a API autenticada do gateway para confirmar o estado; não aceita o status declarado pelo visitante ou pelo webhook como prova de pagamento.

## Operação

Os pedidos ficam no volume `orders`, incluindo identificação genérica da doação, UTMs e estado de sincronização. Faça backup protegido desse volume. Não execute `docker compose down -v`, pois isso apaga os volumes. Use uma única réplica de `app`; o armazenamento em arquivos não suporta múltiplas instâncias.

O servidor consulta pendências a cada minuto e pagamentos concluídos a cada hora por até 45 dias, para acompanhar reembolso e chargeback. O callback pode antecipar a consulta. Falhas de rede/API são repetidas automaticamente, inclusive após reinício. Os envios respeitam o limite de idade da Utmify: 7 dias para vendas e 45 dias para reembolsos/chargebacks. Pedidos que ultrapassem essa janela sem sincronização precisam de revisão operacional.

`createdAt` permanece fixo; valores são enviados em centavos e datas em UTC. Como a unidade da taxa retornada pelo gateway não foi confirmada, a comissão enviada equivale ao valor integral da doação, conforme alternativa permitida pela documentação da Utmify. Não representa receita líquida após taxas.

Se a criação do PIX no gateway terminar com timeout, confira o pedido no gateway antes de tentar novamente: pode ter sido criado sem a resposta chegar ao servidor. Não é feita repetição automática da criação da cobrança.

O pixel Utmify instalado é `6a8a10f4e08f7866db223c66`; a API fica exclusivamente no servidor. O pixel Meta é `1509232324297951`. A sincronização Utmify continua com a página fechada. O evento Purchase do pixel Meta continua dependendo do navegador aberto; não foi configurada uma integração Meta Conversions API.

## Verificação local

`cd server && npm ci && npm run build && npm start`

Configure as variáveis do `.env.example` no `.env`. Para desenvolvimento local, use um DATA_DIR separado. A URL pública de callback exige HTTPS acessível pelo gateway.

A aplicação serve somente HTML e pastas de recursos; código do servidor, arquivos de pedidos e credenciais não são expostos por HTTP.

O checkout não solicita dados pessoais. Envia nome "Doador anônimo" e e-mail genérico "doacao@campanhasolidaria.fun". Telefone e documento são omitidos no gateway e enviados como null à Utmify. A aceitação de cobranças sem documento/telefone depende da configuração do gateway; não são fabricados CPF nem telefone.
