# VNOTC Admin Stats Telegram Bot

Cloudflare Worker độc lập nhận Telegram webhook và đọc thống kê từ endpoint `/admin/stats` của bot chính.

Hai Worker kết nối nội bộ bằng Cloudflare Service Binding `STATS_SERVICE`, không phụ thuộc route `workers.dev` công khai.

## Chức năng

- `/stats`: trả danh sách `private` thành user và `group`/`supergroup` thành group.
- `/stats_json`: trả JSON đầy đủ, tự chia nhỏ nếu vượt giới hạn tin nhắn Telegram.
- `/groups`: liệt kê group active kèm chat ID.
- `/leave <chat ID>`: cho bot chính rời đúng group theo chat ID; không hỗ trợ rời theo tên để tránh trùng tên.
- `/noti`: gửi tin nhắn `/start` mặc định của bot chính tới toàn bộ user/group mà bot chính đang có hội thoại.
- `/noti <nội dung>`: thay nội dung `/start` bằng nội dung tùy chỉnh rồi gửi ngay tới toàn bộ user/group.
- Chỉ Telegram user ID nằm trong `ALLOWED_TELEGRAM_USER_IDS` được sử dụng.
- Xác thực Telegram webhook và endpoint thống kê bằng secret riêng.
- `/health`: kiểm tra Worker; `/health?deep=1` kiểm tra cả kết nối nội bộ tới bot chính.

## 1. Tạo bot Telegram

1. Mở `@BotFather` trên Telegram.
2. Gửi `/newbot`, nhập tên và username cho bot.
3. Lưu token BotFather cấp; không gửi token vào chat hoặc commit Git.
4. Nhắn tin cho `@userinfobot` để lấy Telegram numeric user ID của bạn.

## 2. Cài đặt

```powershell
cd admin-stats-bot
npm install
npm run typecheck
npm test
```

Đăng nhập Cloudflare nếu máy chưa đăng nhập:

```powershell
npx wrangler login
```

## 3. Tạo secrets Cloudflare

Tạo một webhook secret ngẫu nhiên:

```powershell
$webhookSecret = -join ((48..57) + (97..102) | Get-Random -Count 32 | ForEach-Object {[char]$_})
$webhookSecret
```

Đưa từng secret vào Worker; Wrangler sẽ yêu cầu nhập giá trị:

```powershell
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put ADMIN_REPORT_SECRET
npx wrangler secret put ALLOWED_TELEGRAM_USER_IDS
```

`ALLOWED_TELEGRAM_USER_IDS` nhận một hoặc nhiều ID, phân cách bằng dấu phẩy, ví dụ `123456789,987654321`.

Không đặt secret trong `wrangler.jsonc`. Vì admin secret đã xuất hiện trong hội thoại, nên xoay secret của bot chính trước khi dùng production:

```powershell
cd ..
npx wrangler secret put ADMIN_REPORT_SECRET
cd admin-stats-bot
npx wrangler secret put ADMIN_REPORT_SECRET
```

Nhập cùng giá trị mới cho cả hai Worker rồi deploy lại bot chính nếu Wrangler yêu cầu.

## 4. Deploy

```powershell
npm run deploy
```

Ghi lại URL Wrangler trả về, ví dụ:

```text
https://binance-p2p-admin-stats-bot.<subdomain>.workers.dev
```

## 5. Đăng ký webhook Telegram

```powershell
$token = "TOKEN_BOT_MOI"
$webhookSecret = "WEBHOOK_SECRET_DA_TAO"
$workerUrl = "https://binance-p2p-admin-stats-bot.<subdomain>.workers.dev"
$body = @{
  url = "$workerUrl/telegram/webhook"
  secret_token = $webhookSecret
  allowed_updates = @("message")
} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "https://api.telegram.org/bot$token/setWebhook" -ContentType "application/json" -Body $body
```

Kiểm tra webhook:

```powershell
Invoke-RestMethod "https://api.telegram.org/bot$token/getWebhookInfo"
Invoke-RestMethod "$workerUrl/health"
```

Sau đó mở bot mới và gửi `/start`, `/stats`, `/stats_json`.

## Local development

Sao chép `.dev.vars.example` thành `.dev.vars`, điền giá trị chỉ để chạy local rồi dùng:

```powershell
npm run dev
```

`.dev.vars` đã bị Git ignore và không được commit.
