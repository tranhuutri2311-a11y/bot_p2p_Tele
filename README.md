# Binance P2P Telegram Price Bot

Stateless TypeScript Cloudflare Worker. `/price` fetches Binance public P2P BUY/SELL ads on demand, filters by transaction limits, computes lowest BUY, highest SELL, spread, and approximate USDT. No database, polling, cron, or Binance key.

## Requirements

Node.js 20+, npm, Cloudflare account, Telegram bot token. Create bot with BotFather (`/newbot`).

## Install and test

```sh
npm install
npm run typecheck
npm test
npm run dev
```

Telegram cannot reach localhost directly; use an HTTPS Cloudflare Tunnel for local webhook testing.

## Deploy

```sh
npx wrangler login
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npm run deploy
```

Worker endpoint: `https://<worker-subdomain>.workers.dev/telegram/webhook`.

## Webhook

```sh
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" -d "url=https://<worker-subdomain>.workers.dev/telegram/webhook" -d "secret_token=<WEBHOOK_SECRET>"
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
curl -X POST "https://api.telegram.org/bot<TOKEN>/deleteWebhook"
```

Never commit `.dev.vars`, tokens, or webhook secrets. Supported commands: `/start`, `/help`, `/price`, `/price 20000000`, `/price 20,000,000`.

## Troubleshooting

`getWebhookInfo` shows Telegram's current URL and last delivery error. Re-register webhook after changing URL or secret. Binance/Telegram outages return a safe Vietnamese error; retry command.

## Security

Webhook requests require `X-Telegram-Bot-Api-Secret-Token`. Secrets use Wrangler secret storage. Worker logs contain only short error messages; no tokens, authorization headers, or advertiser payment data.

## Optional Render proxy

Binance may block Cloudflare egress. Deploy `proxy/` as a Render Web Service:

```text
Root Directory: proxy
Build Command: (empty)
Start Command: npm start
```

Add Render environment variable `PROXY_SECRET` with a random value. After deploy, set Worker secrets:

```powershell
npx wrangler secret put BINANCE_PROXY_URL
# https://<render-service>.onrender.com/binance
npx wrangler secret put BINANCE_PROXY_SECRET
# same value as Render PROXY_SECRET
```

The proxy exposes `/health` and `/binance?tradeType=BUY|SELL`; it stores no data and performs no polling.
