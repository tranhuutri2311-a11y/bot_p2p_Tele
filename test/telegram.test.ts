import test from 'node:test';
import assert from 'node:assert/strict';
import { handleTelegramUpdate } from '../src/telegram/telegramHandler';
import type { Env } from '../src/index';

test('ignores every message except /start and /otc', async () => {
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error('unexpected request'); };
  try {
    for (const text of ['hello', '/help', '/price', '/otcfoo']) {
      await handleTelegramUpdate({ message: { chat: { id: 1 }, text } }, {} as Env);
    }
    assert.equal(requests, 0);
  } finally { globalThis.fetch = original; }
});

test('/start sends the welcome message without fetching Binance', async () => {
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; return Response.json({ ok: true, result: {} }); };
  try {
    await handleTelegramUpdate({ message: { chat: { id: 1 }, text: '/start' } }, {} as Env);
    assert.equal(requests, 1);
  } finally { globalThis.fetch = original; }
});
