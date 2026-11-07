import assert from 'node:assert/strict';
import test from 'node:test';
import worker, { type Env } from '../src/index';
import { HELP } from '../src/utils/format';

class FakeKV {
  store = new Map<string, string>();

  async get(key: string, type?: string): Promise<unknown> {
    const value = this.store.get(key);
    if (value === undefined) return null;
    return type === 'json' ? JSON.parse(value) : value;
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(options: { prefix: string; cursor?: string }): Promise<{ keys: { name: string }[]; list_complete: boolean; cursor?: string }> {
    const keys = [...this.store.keys()].filter(name => name.startsWith(options.prefix)).map(name => ({ name }));
    return { keys, list_complete: true };
  }
}

function makeEnv(): Env {
  const kv = new FakeKV();
  kv.store.set('conversation:1', JSON.stringify({
    chatId: 1, chatType: 'private', chatTitle: null, chatUsername: null,
    addedByUsername: null, addedByDisplayName: null, botStatus: 'active',
    firstSeenAt: null, lastSeenAt: null,
  }));
  return {
    TELEGRAM_BOT_TOKEN: 'token',
    TELEGRAM_WEBHOOK_SECRET: 'webhook',
    ADMIN_REPORT_SECRET: 'admin-secret',
    USAGE_KV: kv as unknown as KVNamespace,
  };
}

test('/admin/notify without text broadcasts the exact /start message with Vietnamese and icons', async () => {
  const originalFetch = globalThis.fetch;
  const bodies: { chat_id: number; text: string }[] = [];
  globalThis.fetch = async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)) as { chat_id: number; text: string });
    return Response.json({ ok: true });
  };

  try {
    const response = await worker.fetch(new Request('https://bot.test/admin/notify', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-secret': 'admin-secret' },
      body: JSON.stringify({ updateId: 99 }),
    }), makeEnv(), {} as ExecutionContext);

    assert.equal(response.status, 200);
    const result = await response.json() as { ok: boolean; sent: number; usedDefaultText: boolean };
    assert.equal(result.ok, true);
    assert.equal(result.sent, 1);
    assert.equal(result.usedDefaultText, true);
    assert.equal(bodies.length, 1);
    assert.equal(bodies[0].text, HELP);
    assert.ok(bodies[0].text.includes('Chào mừng đến với VNOTC'));
    assert.ok(bodies[0].text.includes('Cảm ơn bạn đã tin tưởng'));
    assert.ok(bodies[0].text.includes('Cú pháp:'));
    assert.ok(bodies[0].text.includes('Kiểm tra tỷ giá mua/bán USDT/VND'));
    assert.ok(bodies[0].text.includes('Đại lý & khách giao dịch khối lượng lớn'));
    assert.ok(bodies[0].text.includes('@ontop99'));
    for (const icon of ['👋', '🙏', '📋', '💼']) assert.ok(bodies[0].text.includes(icon), `missing icon ${icon}`);
    assert.equal(Buffer.from(JSON.stringify(bodies[0]), 'utf8').toString('utf8'), JSON.stringify(bodies[0]));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('/admin/notify forwards custom Vietnamese text and icons unchanged', async () => {
  const originalFetch = globalThis.fetch;
  let sent = '';
  globalThis.fetch = async (_input, init) => {
    sent = (JSON.parse(String(init?.body)) as { text: string }).text;
    return Response.json({ ok: true });
  };

  const custom = '📈 Giá mới hôm nay\n💰 Mua: 26.500 — Bán: 26.800\nLiên hệ @ontop99';
  try {
    const response = await worker.fetch(new Request('https://bot.test/admin/notify', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-secret': 'admin-secret' },
      body: JSON.stringify({ text: custom, updateId: 100 }),
    }), makeEnv(), {} as ExecutionContext);

    assert.equal(response.status, 200);
    assert.equal(sent, custom);
  } finally {
    globalThis.fetch = originalFetch;
  }
});