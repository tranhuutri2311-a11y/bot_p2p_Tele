import { handleTelegramUpdate } from './telegram/telegramHandler';
export interface Env { TELEGRAM_BOT_TOKEN: string; TELEGRAM_WEBHOOK_SECRET: string; BINANCE_PROXY_API_KEY?: string; BINANCE_PROXY_URL?: string; BINANCE_PROXY_SECRET?: string }
export default { async fetch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== '/telegram/webhook') return new Response('Not found', { status: 404 });
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.TELEGRAM_WEBHOOK_SECRET) return new Response('Unauthorized', { status: 401 });
  try { await handleTelegramUpdate(await request.json(), env); } catch (error) { console.error('Webhook processing failed', error instanceof Error ? error.message : 'unknown error'); }
  return new Response('ok');
} } satisfies ExportedHandler<Env>;
