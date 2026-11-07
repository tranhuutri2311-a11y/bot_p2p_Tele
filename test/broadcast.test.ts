import test from 'node:test';
import assert from 'node:assert/strict';
import type { ConversationRecord } from '../src/services/usageTracker';
import { BROADCAST_JOB_KEY, mergeBroadcastTargets, readBroadcastJob, startBroadcast } from '../src/services/broadcast';

function conversation(chatId: number, chatType: string, botStatus = 'active'): ConversationRecord {
  return {
    chatId,
    chatType,
    chatTitle: null,
    chatUsername: null,
    addedByUsername: null,
    addedByDisplayName: null,
    botStatus,
    firstSeenAt: null,
    lastSeenAt: null,
  };
}

class FakeKV {
  store = new Map<string, unknown>();

  async get(key: string, type?: string): Promise<unknown> {
    const value = this.store.get(key);
    if (value === undefined) return null;
    return type === 'json' ? JSON.parse(value as string) : value;
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(options: { prefix: string }): Promise<{ keys: { name: string }[]; list_complete: boolean; cursor?: string }> {
    const keys = [...this.store.keys()].filter(name => name.startsWith(options.prefix)).map(name => ({ name }));
    return { keys, list_complete: true };
  }
}

test('merges active private and group conversations and deduplicates usage records', () => {
  const targets = mergeBroadcastTargets(
    [
      conversation(1, 'private'),
      conversation(-2, 'group'),
      conversation(-3, 'supergroup', 'kicked'),
      conversation(-4, 'channel'),
    ],
    {
      'private:1:1': { chatId: 1, userId: 1, username: '@one', displayName: null, chatType: 'private', chatTitle: null, count: 1 },
      'private:5:5': { chatId: 5, userId: 5, username: '@five', displayName: null, chatType: 'private', chatTitle: null, count: 2 },
      'group:-2:9': { chatId: -2, userId: 9, username: null, displayName: null, chatType: 'group', chatTitle: 'Group', count: 2 },
      'group:-3:9': { chatId: -3, userId: 9, username: null, displayName: null, chatType: 'group', chatTitle: 'Kicked', count: 2 },
      'supergroup:-6:9': { chatId: -6, userId: 9, username: null, displayName: null, chatType: 'supergroup', chatTitle: 'Six', count: 1 },
    },
  );

  assert.deepEqual(targets.map(target => target.chatId).sort((a, b) => a - b), [-6, -2, 1, 5]);
});

test('broadcasts the start text and clears the job when finished', async () => {
  const kv = new FakeKV();
  kv.store.set('conversation:1', JSON.stringify(conversation(1, 'private')));
  kv.store.set('conversation:-2', JSON.stringify(conversation(-2, 'group')));

  const originalFetch = globalThis.fetch;
  const chatIds: number[] = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { chat_id: number; text: string };
    chatIds.push(body.chat_id);
    assert.equal(body.text, 'hello');
    return Response.json({ ok: true });
  };

  try {
    const result = await startBroadcast({ USAGE_KV: kv as unknown as KVNamespace, TELEGRAM_BOT_TOKEN: 'token' }, 'hello', { maxMessages: 10 });
    assert.ok(result);
    assert.equal(result.total, 2);
    assert.equal(result.sent, 2);
    assert.equal(result.remaining, 0);
    assert.deepEqual(chatIds.sort((a, b) => a - b), [-2, 1]);
    assert.equal(await readBroadcastJob(kv as unknown as KVNamespace), null);
    assert.equal(kv.store.has(BROADCAST_JOB_KEY), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('persists remaining targets and resumes them in the next run', async () => {
  const kv = new FakeKV();
  for (let chatId = 1; chatId <= 5; chatId++) kv.store.set(`conversation:${chatId}`, JSON.stringify(conversation(chatId, 'private')));

  const originalFetch = globalThis.fetch;
  const chatIds: number[] = [];
  globalThis.fetch = async (_input, init) => {
    chatIds.push((JSON.parse(String(init?.body)) as { chat_id: number }).chat_id);
    return Response.json({ ok: true });
  };

  try {
    const first = await startBroadcast({ USAGE_KV: kv as unknown as KVNamespace, TELEGRAM_BOT_TOKEN: 'token' }, 'hello', { maxMessages: 2 });
    assert.ok(first);
    assert.equal(first.sent, 2);
    assert.equal(first.remaining, 3);

    const job = await readBroadcastJob(kv as unknown as KVNamespace);
    assert.equal(job?.cursor, 2);

    const { resumeBroadcast } = await import('../src/services/broadcast');
    const second = await resumeBroadcast({ USAGE_KV: kv as unknown as KVNamespace, TELEGRAM_BOT_TOKEN: 'token' }, { maxMessages: 10 });
    assert.ok(second);
    assert.equal(second.sent, 5);
    assert.equal(second.remaining, 0);
    assert.equal(chatIds.length, 5);
  } finally {
    globalThis.fetch = originalFetch;
  }
});