import { handleTelegramUpdate } from './telegram/telegramHandler';
import { usageKey, type ConversationRecord } from './services/usageTracker';
import { sendMessage } from './telegram/telegramClient';
import { readBroadcastJob, resumeBroadcast, startBroadcast } from './services/broadcast';
import { HELP } from './utils/format';

export interface Env { TELEGRAM_BOT_TOKEN: string; TELEGRAM_WEBHOOK_SECRET: string; BINANCE_PROXY_API_KEY?: string; BINANCE_PROXY_URL?: string; BINANCE_PROXY_SECRET?: string; USAGE_KV: KVNamespace; ADMIN_TELEGRAM_CHAT_ID?: string; ADMIN_REPORT_SECRET?: string; ALLOWED_GROUP_ADDER_IDS?: string }

const NOTIFY_CRON = '* * * * *';
const NOTIFY_REQUEST_BUDGET_MS = 15_000;
const NOTIFY_MESSAGES_PER_RUN = 40;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/admin/stats' && request.method === 'GET') return adminStats(request, env);
    if (url.pathname === '/admin/leave' && request.method === 'POST') return adminLeave(request, env);
    if (url.pathname === '/admin/notify' && request.method === 'POST') return adminNotify(request, env);
    if (url.pathname === '/health' && request.method === 'GET') return healthCheck(env, url.searchParams.get('deep') === '1');
    if (url.pathname !== '/telegram/webhook') return new Response('Not found', { status: 404 });
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.TELEGRAM_WEBHOOK_SECRET) return new Response('Unauthorized', { status: 401 });
    try { await handleTelegramUpdate(await request.json(), env, ctx); } catch (error) { console.error('Webhook processing failed', error instanceof Error ? error.message : 'unknown error'); }
    return new Response('ok');
  },

  async scheduled(event, env): Promise<void> {
    if (event.cron === NOTIFY_CRON) {
      try {
        const result = await resumeBroadcast(env, { deadlineAt: Date.now() + NOTIFY_REQUEST_BUDGET_MS });
        if (result) console.log('Broadcast resumed', { sent: result.sent, failed: result.failed, remaining: result.remaining });
      } catch (error) {
        console.error('Broadcast resume failed', error instanceof Error ? error.message : 'unknown error');
      }
      return;
    }

    if (!env.ADMIN_TELEGRAM_CHAT_ID) return;
    const data = await env.USAGE_KV.get<Record<string, UsageRecord>>(usageKey(), 'json');
    if (!data) return;
    const rows = Object.values(data);
    const total = rows.reduce((sum, row) => sum + (row.count ?? 0), 0);
    const users = rows.filter(row => row.chatType === 'private').length;
    const groups = rows.filter(row => row.chatType === 'group' || row.chatType === 'supergroup').length;
    const top = rows.sort((a, b) => (b.count ?? 0) - (a.count ?? 0)).slice(0, 10).map((row, i) => `${i + 1}. ${row.username ?? row.displayName ?? row.userId ?? 'unknown'} — ${row.count ?? 0}`).join('\n');
    try {
      await sendMessage(env.TELEGRAM_BOT_TOKEN, Number(env.ADMIN_TELEGRAM_CHAT_ID), `📊 Thống kê\n\n👤 User: ${users}\n👥 Group: ${groups}\n📈 Tổng lượt: ${total}\n\n${top || 'Chưa có dữ liệu.'}`);
    } catch (error) {
      console.error('Weekly report failed', error instanceof Error ? error.message : 'unknown error');
    }
  },
} satisfies ExportedHandler<Env>;

async function adminNotify(request: Request, env: Env): Promise<Response> {
  if (!env.ADMIN_REPORT_SECRET || request.headers.get('x-admin-secret') !== env.ADMIN_REPORT_SECRET) return new Response('Unauthorized', { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 }); }

  const requested = (body as { text?: unknown })?.text;
  const updateId = (body as { updateId?: unknown })?.updateId;
  if (requested !== undefined && typeof requested !== 'string') return Response.json({ ok: false, error: 'text must be a string' }, { status: 400 });
  if (updateId !== undefined && !Number.isSafeInteger(updateId)) return Response.json({ ok: false, error: 'updateId must be an integer' }, { status: 400 });

  const dedupeKey = typeof updateId === 'number' ? `notify:update:${updateId}` : null;
  if (dedupeKey && await env.USAGE_KV.get(dedupeKey)) return Response.json({ ok: true, duplicate: true, busy: false, total: 0, sent: 0, failed: 0, messages: 0, remaining: 0, usedDefaultText: !requested?.trim() });

  const text = requested?.trim() ? requested : HELP;
  if (dedupeKey) await env.USAGE_KV.put(dedupeKey, new Date().toISOString(), { expirationTtl: 86_400 });

  try {
    const result = await startBroadcast(env, text, { deadlineAt: Date.now() + NOTIFY_REQUEST_BUDGET_MS, maxMessages: NOTIFY_MESSAGES_PER_RUN });
    if (!result) {
      const pending = await readBroadcastJob(env.USAGE_KV);
      const remaining = pending ? Math.max(0, pending.targets.length - pending.cursor) : 0;
      return Response.json({ ok: false, busy: true, error: 'Một thông báo khác đang được gửi. Vui lòng thử lại sau.', remaining }, { status: 409 });
    }

    console.log('Broadcast started', { total: result.total, sent: result.sent, failed: result.failed, remaining: result.remaining });
    return Response.json({
      ok: true,
      duplicate: false,
      busy: false,
      total: result.total,
      sent: result.sent,
      failed: result.failed,
      messages: result.messages,
      remaining: result.remaining,
      queued: result.remaining > 0,
      usedDefaultText: !requested?.trim(),
      failures: result.failures.slice(0, 10),
    }, { headers: { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' } });
  } catch (error) {
    if (dedupeKey) await env.USAGE_KV.delete(dedupeKey);
    const message = error instanceof Error ? error.message : 'unknown error';
    console.error('Broadcast failed', message);
    return Response.json({ ok: false, error: message }, { status: 502 });
  }
}
async function adminStats(request: Request, env: Env): Promise<Response> {
  if (!env.ADMIN_REPORT_SECRET || request.headers.get('x-admin-secret') !== env.ADMIN_REPORT_SECRET) return new Response('Unauthorized', { status: 401 });
  let data = await env.USAGE_KV.get<Record<string, UsageRecord>>(usageKey(), 'json') ?? {};
  if (Object.keys(data).length === 0) { data = await migrateLegacyWeeklyUsage(env); }
  const rows = Object.values(data);
  const total = rows.reduce((sum, row) => sum + (row.count ?? 0), 0);
  const counts = new Map<number, number>();
  for (const [identity, row] of Object.entries(data)) { const chatId = row.chatId ?? Number(identity.split(':')[1]); if (Number.isFinite(chatId)) counts.set(chatId, (counts.get(chatId) ?? 0) + (row.count ?? 0)); }
  const storedConversations = await reconcileGroupConversations(env, await listConversations(env.USAGE_KV));
  const known = new Map(storedConversations.map(item => [item.chatId, item]));
  for (const [identity, row] of Object.entries(data)) {
    const chatId = row.chatId ?? Number(identity.split(':')[1]);
    if (!Number.isFinite(chatId) || known.has(chatId)) continue;
    known.set(chatId, { chatId, chatType: row.chatType, chatTitle: row.chatTitle, chatUsername: null, addedByUsername: null, addedByDisplayName: null, botStatus: 'active', firstSeenAt: null, lastSeenAt: null });
  }
  const conversations = [...known.values()].map(item => ({ ...item, requestCount: counts.get(item.chatId) ?? 0 })).sort((a, b) => b.requestCount - a.requestCount);
  return Response.json({
    week: 'all',
    totalRequests: total,
    activePrivateUsers: rows.filter(row => row.chatType === 'private').length,
    activeGroups: conversations.filter(item => { const isGroup = item.chatType === 'group' || item.chatType === 'supergroup'; const status = item.botStatus ?? 'active'; return isGroup && status !== 'kicked' && status !== 'left' && status !== 'banned'; }).length,
    users: rows.sort((a, b) => (b.count ?? 0) - (a.count ?? 0)),
    conversations,
  }, { headers: { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' } });
}

async function migrateLegacyWeeklyUsage(env: Env): Promise<Record<string, UsageRecord>> {
  const merged: Record<string, UsageRecord> = {};
  let cursor: string | undefined;
  do {
    const page = await env.USAGE_KV.list({ prefix: 'usage:', cursor });
    const targets = page.keys.map(item => item.name).filter(name => name.startsWith('usage:') && name !== usageKey()).slice(0, 100);
    for (const name of targets) {
      const bucket = await env.USAGE_KV.get<Record<string, UsageRecord>>(name, 'json');
      if (!bucket) continue;
      for (const [identity, row] of Object.entries(bucket)) {
        const current = merged[identity] ?? { chatId: row.chatId, userId: row.userId ?? null, username: row.username ?? null, displayName: row.displayName ?? null, chatType: row.chatType ?? 'unknown', chatTitle: row.chatTitle ?? null, count: 0 };
        current.username = row.username ?? current.username;
        current.displayName = row.displayName ?? current.displayName;
        current.chatTitle = row.chatTitle ?? current.chatTitle;
        current.count = (current.count ?? 0) + (row.count ?? 0);
        merged[identity] = current;
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  if (Object.keys(merged).length) await env.USAGE_KV.put(usageKey(), JSON.stringify(merged));
  return merged;
}

async function adminLeave(request: Request, env: Env): Promise<Response> {
  if (!env.ADMIN_REPORT_SECRET || request.headers.get('x-admin-secret') !== env.ADMIN_REPORT_SECRET) return new Response('Unauthorized', { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 }); }
  const chatId = Number((body as { chatId?: unknown })?.chatId);
  if (!Number.isSafeInteger(chatId)) return Response.json({ ok: false, error: 'chatId is required' }, { status: 400 });
  const key = `conversation:${chatId}`;
  const record = await env.USAGE_KV.get<ConversationRecord>(key, 'json');
  if (!record) return Response.json({ ok: false, error: 'Group not found' }, { status: 404 });
  if (record.chatType !== 'group' && record.chatType !== 'supergroup') return Response.json({ ok: false, error: 'Not a group conversation' }, { status: 400 });
  if (record.botStatus === 'kicked' || record.botStatus === 'left' || record.botStatus === 'banned') return Response.json({ ok: true, alreadyLeft: true, chatId, chatTitle: record.chatTitle });
  try {
    const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/leaveChat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: chatId }) });
    const payload = await response.json() as { ok?: boolean; description?: string };
    if (!response.ok || payload.ok !== true) {
      const error = payload.description ?? `Telegram HTTP ${response.status}`;
      if (/not a member of the chat|chat not found|chat is deactivated/i.test(error)) {
        const updated: ConversationRecord = { ...record, botStatus: 'left', lastSeenAt: new Date().toISOString() };
        await env.USAGE_KV.put(key, JSON.stringify(updated));
        return Response.json({ ok: true, alreadyLeft: true, chatId, chatTitle: record.chatTitle });
      }
      console.error('Telegram leaveChat failed', { chatId, status: response.status, error });
      return Response.json({ ok: false, error }, { status: 502 });
    }
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'unknown error' }, { status: 502 });
  }
  const updated: ConversationRecord = { ...record, botStatus: 'left', lastSeenAt: new Date().toISOString() };
  await env.USAGE_KV.put(key, JSON.stringify(updated));
  return Response.json({ ok: true, chatId, chatTitle: record.chatTitle });
}

interface UsageRecord { chatId?: number; userId: number | null; username: string | null; displayName: string | null; chatType: string; chatTitle: string | null; count: number }
type ConversationView = Omit<ConversationRecord, 'firstSeenAt' | 'lastSeenAt'> & { firstSeenAt: string | null; lastSeenAt: string | null };

async function listConversations(kv: KVNamespace): Promise<ConversationView[]> {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await kv.list({ prefix: 'conversation:', cursor });
    keys.push(...page.keys.map(item => item.name));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  const records = await Promise.all(keys.map(key => kv.get<ConversationRecord>(key, 'json')));
  return records.filter((item): item is ConversationRecord => item !== null);
}

async function reconcileGroupConversations(env: Pick<Env, 'USAGE_KV' | 'TELEGRAM_BOT_TOKEN'>, conversations: ConversationView[]): Promise<ConversationView[]> {
  return Promise.all(conversations.map(async conversation => {
    const isGroup = conversation.chatType === 'group' || conversation.chatType === 'supergroup';
    const status = conversation.botStatus ?? 'active';
    if (!isGroup || status === 'kicked' || status === 'left' || status === 'banned') return conversation;

    try {
      const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getChat?chat_id=${encodeURIComponent(String(conversation.chatId))}`);
      if (response.ok) {
        const payload = await response.json() as { result?: { title?: string; username?: string; type?: string } };
        const chat = payload.result;
        const updated = { ...conversation, chatType: chat?.type ?? conversation.chatType, chatTitle: chat?.title ?? conversation.chatTitle, chatUsername: chat?.username ? `@${chat.username}` : null };
        const changed = updated.chatType !== conversation.chatType || updated.chatTitle !== conversation.chatTitle || updated.chatUsername !== conversation.chatUsername;
        if (changed) await env.USAGE_KV.put(`conversation:${conversation.chatId}`, JSON.stringify(updated));
        return updated;
      }
      if (response.status !== 400 && response.status !== 403) {
        console.error('Group reconciliation failed', { chatId: conversation.chatId, status: response.status });
        return conversation;
      }

      const updated = { ...conversation, botStatus: 'kicked', lastSeenAt: new Date().toISOString() };
      await env.USAGE_KV.put(`conversation:${conversation.chatId}`, JSON.stringify(updated));
      return updated;
    } catch (error) {
      console.error('Group reconciliation failed', { chatId: conversation.chatId, error: error instanceof Error ? error.message : 'unknown error' });
      return conversation;
    }
  }));
}

async function healthCheck(env: Env, deep: boolean): Promise<Response> {
  const checks: Record<string, string> = { worker: 'ok' };
  if (env.TELEGRAM_BOT_TOKEN) {
    try { const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getMe`); const body = await response.json() as { ok?: boolean }; checks.telegram = response.ok && body.ok === true ? 'ok' : 'error'; } catch { checks.telegram = 'error'; }
  } else checks.telegram = 'not_configured';
  if (env.BINANCE_PROXY_URL && env.BINANCE_PROXY_SECRET) {
    try {
      const proxyBase = new URL(env.BINANCE_PROXY_URL);
      const healthUrl = `${proxyBase.origin}/health`;
      const response = await fetch(healthUrl);
      checks.proxy = response.ok && (await response.text()) === 'ok' ? 'ok' : 'error';
      if (deep) { const response = await fetch(`${env.BINANCE_PROXY_URL}?tradeType=BUY`, { headers: { 'x-proxy-secret': env.BINANCE_PROXY_SECRET } }); checks.binance = response.ok ? 'ok' : `error_${response.status}`; }
    } catch { checks.proxy = 'error'; if (deep) checks.binance = 'error'; }
  } else { checks.proxy = 'not_configured'; if (deep) checks.binance = 'not_configured'; }
  const healthy = Object.values(checks).every(value => value === 'ok');
  return Response.json({ status: healthy ? 'ok' : 'degraded', checks, deep, checkedAt: new Date().toISOString() }, { status: healthy ? 200 : 503, headers: { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8' } });
}
