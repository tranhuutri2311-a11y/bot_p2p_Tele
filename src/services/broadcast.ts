import type { ConversationRecord, UsageRecord } from './usageTracker';
import { usageKey } from './usageTracker';
import { splitText } from '../utils/format';

const TELEGRAM_API = 'https://api.telegram.org';
const SENDS_PER_SECOND = 20;
const DEFAULT_MESSAGES_PER_RUN = 40;
const MAX_SEND_ATTEMPTS = 3;
const JOB_SAVE_INTERVAL_MS = 1_500;
const MAX_RECORDED_FAILURES = 30;
const KV_READ_BATCH_SIZE = 20;
const PRIVATE_CHUNK_DELAY_MS = 1_100;
const GROUP_CHUNK_DELAY_MS = 3_100;
const LOCK_TTL_SECONDS = 120;
const SUPPORTED_CHAT_TYPES = new Set(['private', 'group', 'supergroup']);
const INACTIVE_STATUSES = new Set(['kicked', 'left', 'banned']);

export const BROADCAST_JOB_KEY = 'notify:job';
export const BROADCAST_LOCK_KEY = 'notify:lock';

let nextSendAt = 0;

export interface BroadcastTarget {
  chatId: number;
  chatType: string;
  label: string | null;
}

export interface BroadcastFailure {
  chatId: number;
  label: string | null;
  error: string;
}

export interface BroadcastJob {
  text: string;
  targets: BroadcastTarget[];
  cursor: number;
  sent: number;
  failed: number;
  messages: number;
  failures: BroadcastFailure[];
  createdAt: string;
}

export interface BroadcastResult {
  total: number;
  sent: number;
  failed: number;
  messages: number;
  remaining: number;
  failures: BroadcastFailure[];
}

export function mergeBroadcastTargets(
  conversations: ConversationRecord[],
  usage: Record<string, UsageRecord>,
): BroadcastTarget[] {
  const targets = new Map<number, BroadcastTarget>();
  const inactive = new Set<number>();

  for (const conversation of conversations) {
    if (!Number.isSafeInteger(conversation.chatId)) continue;
    if (!SUPPORTED_CHAT_TYPES.has(conversation.chatType) || INACTIVE_STATUSES.has(conversation.botStatus ?? 'active')) {
      inactive.add(conversation.chatId);
      continue;
    }
    targets.set(conversation.chatId, {
      chatId: conversation.chatId,
      chatType: conversation.chatType,
      label: conversation.chatTitle ?? conversation.chatUsername ?? null,
    });
  }

  for (const [identity, row] of Object.entries(usage)) {
    const chatId = row.chatId ?? Number(identity.split(':')[1]);
    if (!Number.isSafeInteger(chatId) || inactive.has(chatId) || targets.has(chatId)) continue;
    if (!SUPPORTED_CHAT_TYPES.has(row.chatType)) continue;
    targets.set(chatId, {
      chatId,
      chatType: row.chatType,
      label: row.chatTitle ?? row.displayName ?? row.username ?? null,
    });
  }

  return [...targets.values()];
}

export async function listBroadcastTargets(kv: KVNamespace): Promise<BroadcastTarget[]> {
  const conversations: ConversationRecord[] = [];
  let cursor: string | undefined;

  do {
    const page = await kv.list({ prefix: 'conversation:', cursor });
    for (let index = 0; index < page.keys.length; index += KV_READ_BATCH_SIZE) {
      const batch = page.keys.slice(index, index + KV_READ_BATCH_SIZE);
      const records = await Promise.all(batch.map(item => kv.get<ConversationRecord>(item.name, 'json')));
      for (const record of records) if (record) conversations.push(record);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  const usage = await kv.get<Record<string, UsageRecord>>(usageKey(), 'json') ?? {};
  return mergeBroadcastTargets(conversations, usage);
}

export async function readBroadcastJob(kv: KVNamespace): Promise<BroadcastJob | null> {
  return await kv.get<BroadcastJob>(BROADCAST_JOB_KEY, 'json');
}

export async function createBroadcastJob(kv: KVNamespace, text: string): Promise<BroadcastJob> {
  return {
    text,
    targets: await listBroadcastTargets(kv),
    cursor: 0,
    sent: 0,
    failed: 0,
    messages: 0,
    failures: [],
    createdAt: new Date().toISOString(),
  };
}

async function acquireLock(kv: KVNamespace): Promise<string | null> {
  if (await kv.get(BROADCAST_LOCK_KEY)) return null;
  const id = crypto.randomUUID();
  await kv.put(BROADCAST_LOCK_KEY, id, { expirationTtl: LOCK_TTL_SECONDS });
  return id;
}

async function releaseLock(kv: KVNamespace, id: string): Promise<void> {
  try {
    if (await kv.get(BROADCAST_LOCK_KEY) === id) await kv.delete(BROADCAST_LOCK_KEY);
  } catch (error) {
    console.error('Unable to release broadcast lock', error instanceof Error ? error.message : 'unknown error');
  }
}

export async function runBroadcastJob(
  env: { USAGE_KV: KVNamespace; TELEGRAM_BOT_TOKEN: string },
  job: BroadcastJob,
  options: { deadlineAt?: number; maxMessages?: number } = {},
): Promise<BroadcastResult> {
  const deadlineAt = options.deadlineAt ?? Number.POSITIVE_INFINITY;
  const maxMessages = options.maxMessages ?? DEFAULT_MESSAGES_PER_RUN;
  const chunks = splitText(job.text, 3900);
  let lastSavedAt = Date.now();

  while (job.cursor < job.targets.length && job.messages < maxMessages && Date.now() < deadlineAt) {
    const target = job.targets[job.cursor++];
    const outcome = await sendTarget(env.TELEGRAM_BOT_TOKEN, target, chunks);

    if (outcome.error) {
      job.failed++;
      if (job.failures.length < MAX_RECORDED_FAILURES) {
        job.failures.push({ chatId: target.chatId, label: target.label, error: outcome.error });
      }
    } else {
      job.sent++;
    }
    job.messages += outcome.messages;

    if (Date.now() - lastSavedAt >= JOB_SAVE_INTERVAL_MS) {
      lastSavedAt = Date.now();
      await saveJob(env.USAGE_KV, job);
    }
  }

  const remaining = Math.max(0, job.targets.length - job.cursor);
  if (remaining === 0) await env.USAGE_KV.delete(BROADCAST_JOB_KEY);
  else await saveJob(env.USAGE_KV, job);

  return {
    total: job.targets.length,
    sent: job.sent,
    failed: job.failed,
    messages: job.messages,
    remaining,
    failures: job.failures,
  };
}

async function saveJob(kv: KVNamespace, job: BroadcastJob): Promise<void> {
  await kv.put(BROADCAST_JOB_KEY, JSON.stringify(job));
}

export function emptyResult(): BroadcastResult {
  return { total: 0, sent: 0, failed: 0, messages: 0, remaining: 0, failures: [] };
}

export async function startBroadcast(
  env: { USAGE_KV: KVNamespace; TELEGRAM_BOT_TOKEN: string },
  text: string,
  options: { deadlineAt?: number; maxMessages?: number } = {},
): Promise<BroadcastResult | null> {
  const lock = await acquireLock(env.USAGE_KV);
  if (!lock) return null;

  try {
    if (await readBroadcastJob(env.USAGE_KV)) return null;
    const job = await createBroadcastJob(env.USAGE_KV, text);
    return await runBroadcastJob(env, job, options);
  } finally {
    await releaseLock(env.USAGE_KV, lock);
  }
}

export async function resumeBroadcast(
  env: { USAGE_KV: KVNamespace; TELEGRAM_BOT_TOKEN: string },
  options: { deadlineAt?: number; maxMessages?: number } = {},
): Promise<BroadcastResult | null> {
  const pending = await readBroadcastJob(env.USAGE_KV);
  if (!pending) return null;

  const lock = await acquireLock(env.USAGE_KV);
  if (!lock) return null;

  try {
    const job = await readBroadcastJob(env.USAGE_KV);
    if (!job) return null;
    return await runBroadcastJob(env, job, options);
  } finally {
    await releaseLock(env.USAGE_KV, lock);
  }
}

async function sendTarget(
  token: string,
  target: BroadcastTarget,
  chunks: string[],
): Promise<{ messages: number; error?: string }> {
  const chunkDelay = target.chatType === 'private' ? PRIVATE_CHUNK_DELAY_MS : GROUP_CHUNK_DELAY_MS;
  let messages = 0;
  try {
    for (const [index, chunk] of chunks.entries()) {
      if (index > 0) await sleep(chunkDelay);
      await acquireSendSlot();
      await sendWithRetry(token, target.chatId, chunk);
      messages++;
    }
    return { messages };
  } catch (error) {
    return { messages, error: error instanceof Error ? error.message : 'unknown error' };
  }
}

async function acquireSendSlot(): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, nextSendAt);
  nextSendAt = slot + Math.ceil(1000 / SENDS_PER_SECOND);
  if (slot > now) await sleep(slot - now);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendWithRetry(token: string, chatId: number, text: string): Promise<void> {
  for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt++) {
    const response = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });

    const payload = await response.json().catch(() => null) as { ok?: boolean; description?: string; parameters?: { retry_after?: number } } | null;

    if (response.ok && payload?.ok === true) return;

    if (response.status === 429 && attempt < MAX_SEND_ATTEMPTS) {
      const retryAfter = Math.min(Math.max(payload?.parameters?.retry_after ?? 1, 1), 10);
      await sleep(retryAfter * 1000);
      continue;
    }

    throw new Error(payload?.description ?? `Telegram HTTP ${response.status}`);
  }
}