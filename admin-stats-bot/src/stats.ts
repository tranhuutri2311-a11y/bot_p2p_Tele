import type { Env, StatsResponse } from './types';

const REQUEST_TIMEOUT_MS = 15_000;

export async function fetchStats(env: Env): Promise<StatsResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await env.STATS_SERVICE.fetch('https://stats.internal/admin/stats', {
      headers: {
        accept: 'application/json',
        'x-admin-secret': env.ADMIN_REPORT_SECRET,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Stats API returned HTTP ${response.status}`);
    }

    return await response.json<StatsResponse>();
  } finally {
    clearTimeout(timeout);
  }
}


export async function leaveGroup(env: Env, chatId: number): Promise<{ ok: boolean; alreadyLeft?: boolean; chatTitle?: string; error?: string }> {
  const response = await env.STATS_SERVICE.fetch('https://stats.internal/admin/leave', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'x-admin-secret': env.ADMIN_REPORT_SECRET },
    body: JSON.stringify({ chatId }),
  });
  const body = await response.json<{ ok?: boolean; alreadyLeft?: boolean; chatTitle?: string; error?: string }>();
  if (!response.ok || body.ok !== true) throw new Error(body.error ?? `Leave API returned HTTP ${response.status}`);
  return { ok: true, alreadyLeft: body.alreadyLeft, chatTitle: body.chatTitle };
}

export function formatStats(stats: StatsResponse): string {
  const users = (stats.users ?? []).filter(user => user.chatType === 'private');
  const groups = (stats.conversations ?? []).filter(conversation => {
    const isGroup = conversation.chatType === 'group' || conversation.chatType === 'supergroup';
    const status = conversation.botStatus ?? 'active';
    const isActive = status !== 'kicked' && status !== 'left' && status !== 'banned';
    return isGroup && isActive;
  });
  const userRows = users.map((user, index) => {
    const identity = [user.username, user.displayName].filter(Boolean).join(' — ');
    return `${index + 1}. ${identity || user.userId || user.chatId || 'Không xác định'}`;
  });
  const groupRows = groups.map((group, index) => {
    const identity = group.chatTitle ?? group.chatUsername ?? group.chatId ?? 'Không xác định';
    return `${index + 1}. ${identity}`;
  });

  return [
    'Danh sách user active:',
    ...(userRows.length ? userRows : ['Không có user active.']),
    '',
    'Danh sách group active:',
    ...(groupRows.length ? groupRows : ['Không có group active.']),
  ].join('\n');
}

export function splitText(text: string, limit = 3900): string[] {
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > limit) {
    let breakAt = remaining.lastIndexOf('\n', limit);
    if (breakAt <= 0) breakAt = limit;
    chunks.push(remaining.slice(0, breakAt));
    remaining = remaining.slice(breakAt).replace(/^\n/, '');
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export function parseNotiText(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === '\u201c' && last === '\u201d')) return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

export interface NotifyResult {
  duplicate: boolean;
  total: number;
  sent: number;
  failed: number;
  messages: number;
  remaining: number;
  queued: boolean;
  usedDefaultText: boolean;
}

export async function notifyAll(env: Env, text: string, updateId?: number): Promise<NotifyResult> {
  const body: { text?: string; updateId?: number } = {};
  if (text.trim()) body.text = text;
  if (typeof updateId === 'number') body.updateId = updateId;

  const response = await env.STATS_SERVICE.fetch('https://stats.internal/admin/notify', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'x-admin-secret': env.ADMIN_REPORT_SECRET },
    body: JSON.stringify(body),
  });
  const payload = await response.json<{
    ok?: boolean;
    duplicate?: boolean;
    total?: number;
    sent?: number;
    failed?: number;
    messages?: number;
    remaining?: number;
    queued?: boolean;
    usedDefaultText?: boolean;
    error?: string;
  }>();
  if (!response.ok || payload.ok !== true) throw new Error(payload.error ?? `Notify API returned HTTP ${response.status}`);
  return {
    duplicate: payload.duplicate === true,
    total: payload.total ?? 0,
    sent: payload.sent ?? 0,
    failed: payload.failed ?? 0,
    messages: payload.messages ?? 0,
    remaining: payload.remaining ?? 0,
    queued: payload.queued === true,
    usedDefaultText: payload.usedDefaultText === true,
  };
}