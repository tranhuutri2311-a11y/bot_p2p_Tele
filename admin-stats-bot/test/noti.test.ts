import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../src/index';
import type { Env } from '../src/types';

function makeEnv(serviceFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>): Env {
  return {
    TELEGRAM_BOT_TOKEN: 'admin-token',
    TELEGRAM_WEBHOOK_SECRET: 'webhook-secret',
    ADMIN_REPORT_SECRET: 'admin-secret',
    ALLOWED_TELEGRAM_USER_IDS: '42',
    STATS_SERVICE: { fetch: serviceFetch } as unknown as Fetcher,
  };
}

test('/noti forwards custom text with the update id and reports the result', async () => {
  const originalFetch = globalThis.fetch;
  const notifications: { text: string }[] = [];
  let forwarded: unknown;
  globalThis.fetch = async (_input, init) => {
    notifications.push(JSON.parse(String(init?.body)) as { text: string });
    return Response.json({ ok: true });
  };

  const env = makeEnv(async (_input, init) => {
    forwarded = JSON.parse(String(init?.body));
    return Response.json({ ok: true, duplicate: false, total: 3, sent: 2, failed: 1, messages: 2, remaining: 1, queued: true, usedDefaultText: false });
  });

  try {
    const response = await worker.fetch(new Request('https://admin.test/telegram/webhook', {
      method: 'POST',
      headers: { 'X-Telegram-Bot-Api-Secret-Token': 'webhook-secret', 'content-type': 'application/json' },
      body: JSON.stringify({ update_id: 10, message: { chat: { id: 99 }, from: { id: 42 }, text: '/noti "giá mới"' } }),
    }), env);

    assert.equal(response.status, 200);
    assert.deepEqual(forwarded, { text: 'giá mới', updateId: 10 });
    assert.equal(notifications.length, 1);
    assert.match(notifications[0].text, /Tổng hội thoại: 3/);
    assert.match(notifications[0].text, /Còn lại: 1/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('/noti without an argument asks the main bot to use its /start text', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ ok: true });

  let forwarded: unknown;
  const env = makeEnv(async (_input, init) => {
    forwarded = JSON.parse(String(init?.body));
    return Response.json({ ok: true, duplicate: false, total: 0, sent: 0, failed: 0, messages: 0, remaining: 0, queued: false, usedDefaultText: true });
  });

  try {
    await worker.fetch(new Request('https://admin.test/telegram/webhook', {
      method: 'POST',
      headers: { 'X-Telegram-Bot-Api-Secret-Token': 'webhook-secret', 'content-type': 'application/json' },
      body: JSON.stringify({ update_id: 11, message: { chat: { id: 99 }, from: { id: 42 }, text: '/noti' } }),
    }), env);

    assert.deepEqual(forwarded, { updateId: 11 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});