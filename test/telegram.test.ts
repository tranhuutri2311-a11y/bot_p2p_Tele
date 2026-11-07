import test from 'node:test';
import assert from 'node:assert/strict';
import { handleTelegramUpdate } from '../src/telegram/telegramHandler';
import type { Env } from '../src/index';
import { HELP } from '../src/utils/format';

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

test('/start sends the exact welcome text with Vietnamese and icons', async () => {
  const original = globalThis.fetch;
  let requests = 0;
  let sentText = '';
  globalThis.fetch = async (_input, init) => {
    requests++;
    sentText = (JSON.parse(String(init?.body)) as { text?: string }).text ?? '';
    return Response.json({ ok: true, result: {} });
  };
  try {
    await handleTelegramUpdate({ message: { chat: { id: 1 }, text: '/start' } }, {} as Env);
    assert.equal(requests, 1);
    assert.equal(sentText, HELP);
  } finally { globalThis.fetch = original; }
});

test('welcome text matches the /start and /noti template', () => {
  assert.equal(HELP, [
    '👋 Chào mừng đến với VNOTC — tỷ giá cập nhật liên tục, giao dịch an tâm.',
    '',
    '🙏 Cảm ơn bạn đã tin tưởng, VNOTC luôn sẵn sàng hỗ trợ bạn 24/7.',
    '',
    '📋 Cú pháp:',
    '/otc — Kiểm tra tỷ giá mua/bán USDT/VND',
    '',
    '💼 Đại lý & khách giao dịch khối lượng lớn',
    'Liên hệ @ontop99 để nhận báo giá tốt nhất.',
  ].join('\n'));
});
