# Binance P2P Telegram Price Bot

Stateless TypeScript Cloudflare Worker. `/otc` fetches Binance public P2P BUY/SELL ads on demand, filters by transaction limits, then uses the third valid BUY and third valid SELL advertisement as source prices. No database, polling, cron, or Binance key.

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

Health checks:

```text
https://<worker-subdomain>.workers.dev/health
https://<worker-subdomain>.workers.dev/health?deep=1
```

`/health` checks Worker, Telegram, and Render. `deep=1` also checks Binance through the Render proxy. Response never includes secret values.
## Admin broadcast

`POST /admin/notify` is a secret-protected admin endpoint used by `admin-stats-bot` (service binding `STATS_SERVICE`):

- `{}` broadcasts the exact `/start` message (`HELP`) to every known private/group conversation.
- `{ "text": "..." }` broadcasts custom text instead.

Each run sends at most 40 messages at about 20 messages/second; remaining conversations are resumed automatically by the `* * * * *` cron. Progress is stored in `notify:job`, and `notify:update:<update_id>` deduplicates Telegram webhook retries.

## Webhook

```sh
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" -d "url=https://<worker-subdomain>.workers.dev/telegram/webhook" -d "secret_token=<WEBHOOK_SECRET>"
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
curl -X POST "https://api.telegram.org/bot<TOKEN>/deleteWebhook"
```

Never commit `.dev.vars`, tokens, or webhook secrets. Supported commands: `/otc`, `/otc 20000000`, `/otc 20,000,000`. Other messages are ignored.

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

## Operations Runbook

### Kiểm tra sau deploy

```powershell
Invoke-RestMethod "https://<render-service>.onrender.com/health"
Invoke-RestMethod "https://<worker-url>/health"
Invoke-RestMethod "https://<worker-url>/health?deep=1"
```

Sau đó gửi `/otc` và `/otc 20000000` trong Telegram. Nếu Render health OK nhưng deep health lỗi Binance, lỗi nằm ở Render -> Binance. Nếu deep health OK nhưng Telegram không trả lời, kiểm tra webhook/token.

### Phân loại lỗi

| Triệu chứng | Tầng kiểm tra |
|---|---|
| Worker URL 404 | Cloudflare route/path |
| Webhook 401 | Telegram secret header |
| Telegram HTTP 404 | `TELEGRAM_BOT_TOKEN` |
| Proxy `/health` không trả `ok` | Render service/deploy |
| Proxy HTTP 401 | `PROXY_SECRET` và `BINANCE_PROXY_SECRET` |
| Proxy HTTP 404 | `BINANCE_PROXY_URL` thiếu `/binance` |
| Binance HTTP 403 | Binance WAF hoặc proxy outbound |
| `The operation was aborted` | Cold start, mạng chậm hoặc timeout 30 giây |
| Không tìm thấy BUY/SELL | Amount không phù hợp min/max |

## Price selection

For each side, ads are filtered first using the requested amount. The bot then uses the third valid ad in Binance response order for the source price. It does not use the first ad, minimum price, or maximum price. Fewer than three valid ads returns the controlled no-ad error.

### Rotation secrets

Khi nghi ngờ lộ secret: tạo secret mới, đổi `PROXY_SECRET` trên Render, đổi `BINANCE_PROXY_SECRET` trên Cloudflare, đăng ký webhook lại nếu đổi webhook secret, rồi test `/health?deep=1` và `/otc`. Telegram token bị lộ phải revoke bằng BotFather và tạo token mới.

## Clean Handoff Procedure

1. Khách tạo GitHub, Cloudflare, Render và Telegram account riêng.
2. Chuyển repository hoặc thêm khách làm repository owner.
3. Khách deploy Render từ thư mục `proxy`.
4. Khách tạo `PROXY_SECRET` mới trên Render.
5. Khách deploy Worker bằng Wrangler.
6. Khách tạo bốn Worker secrets mới.
7. Khách tạo bot Telegram mới hoặc chuyển quyền bot cũ.
8. Khách đăng ký webhook bằng Worker URL mới.
9. Hai bên chạy checklist nghiệm thu.
10. Người bán xóa quyền truy cập và revoke credential cũ.

Không bàn giao password cá nhân, access token dùng cho dự án khác hoặc secret từng xuất hiện trong chat/commit.

### Hồ sơ bàn giao

- GitHub repository URL.
- Worker URL và webhook path.
- Render service URL.
- Tên secret, không ghi giá trị thật.
- Lệnh deploy, health check và rollback.
- Ngày nghiệm thu và plan/billing.
- Giới hạn đã biết: Render sleep, Binance WAF, timeout.

## Rollback

Cloudflare Dashboard -> Worker -> Deployments -> chọn version ổn định -> Roll back/promote -> chạy `/health?deep=1` -> test `/otc`. Thay đổi secret không cần deploy source.

## Data and Privacy

Worker xử lý Telegram update trong thời gian request. Proxy chỉ forward Binance request/response, không database và không persistent storage. Không lưu chat history, bank data, phone number hoặc advertiser identity. Giá hiển thị không phải cam kết giao dịch; người dùng cần xác nhận lại trên Binance.
