import { fetchStats, formatStats, leaveGroup, notifyAll, parseNotiText, splitText } from './stats';
import { sendMessage } from './telegram';
import type { Env, TelegramUpdate } from './types';

const HELP = [
  '🤖 Bot thống kê VNOTC',
  '',
  '/stats — Xem thống kê tổng quan',
  '/stats_json — Xem toàn bộ JSON thống kê',
  '/groups — Liệt kê group active kèm chat ID',
  '/leave <chat ID> — Cho bot chính rời group',
  '/noti [nội dung] — Gửi thông báo tới tất cả user/group',
  '/help — Xem hướng dẫn',
].join('\n');

export function parseAllowedUserIds(value: string): Set<number> {
  return new Set(
    value.split(',')
      .map(item => Number(item.trim()))
      .filter(Number.isSafeInteger),
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health' && request.method === 'GET') {
      if (url.searchParams.get('deep') !== '1') {
        return Response.json({ status: 'ok', checkedAt: new Date().toISOString() });
      }
      try {
        await fetchStats(env);
        return Response.json({ status: 'ok', checks: { worker: 'ok', statsService: 'ok' }, checkedAt: new Date().toISOString() });
      } catch (error) {
        console.error('Deep health check failed', error instanceof Error ? error.message : 'unknown error');
        return Response.json({ status: 'degraded', checks: { worker: 'ok', statsService: 'error' }, checkedAt: new Date().toISOString() }, { status: 503 });
      }
    }
    if (url.pathname !== '/telegram/webhook') return new Response('Not found', { status: 404 });
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.TELEGRAM_WEBHOOK_SECRET) {
      return new Response('Unauthorized', { status: 401 });
    }

    try {
      await handleUpdate(await request.json<unknown>(), env);
    } catch (error) {
      console.error('Webhook processing failed', error instanceof Error ? error.message : 'unknown error');
    }
    return new Response('ok');
  },
} satisfies ExportedHandler<Env>;

function activeGroups(stats: Awaited<ReturnType<typeof fetchStats>>) {
  return (stats.conversations ?? []).filter(conversation => {
    const isGroup = conversation.chatType === 'group' || conversation.chatType === 'supergroup';
    const status = conversation.botStatus ?? 'active';
    return isGroup && status !== 'kicked' && status !== 'left' && status !== 'banned' && typeof conversation.chatId === 'number';
  });
}

async function handleUpdate(value: unknown, env: Env): Promise<void> {
  const update = value as TelegramUpdate;
  const chatId = update.message?.chat?.id;
  const userId = update.message?.from?.id;
  const text = update.message?.text?.trim() ?? '';
  if (typeof chatId !== 'number' || typeof userId !== 'number' || !text) return;

  if (!parseAllowedUserIds(env.ALLOWED_TELEGRAM_USER_IDS).has(userId)) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, 'Bạn không có quyền sử dụng bot này.');
    return;
  }

  if (/^\/(start|help)(?:@\w+)?$/i.test(text)) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, HELP);
    return;
  }

  if (/^\/groups(?:@\w+)?$/i.test(text)) {
    await handleGroupsCommand(env, chatId);
    return;
  }

  const leaveMatch = text.match(/^\/leave(?:@\w+)?\s+(.+)$/i);
  if (leaveMatch) {
    await handleLeaveCommand(env, chatId, leaveMatch[1]);
    return;
  }
  const notiMatch = text.match(/^\/noti(?:@\w+)?(?:\s+([\s\S]*))?$/i);
  if (notiMatch) {
    await handleNotiCommand(env, chatId, parseNotiText(notiMatch[1] ?? ''), update.update_id);
    return;
  }

  if (!/^\/stats(?:_json)?(?:@\w+)?$/i.test(text)) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, HELP);
    return;
  }

  try {
    const stats = await fetchStats(env);
    if (/^\/stats_json/i.test(text)) {
      const chunks = splitText(JSON.stringify(stats, null, 2));
      for (const [index, chunk] of chunks.entries()) {
        const prefix = chunks.length > 1 ? 'JSON ' + (index + 1) + '/' + chunks.length + '\n' : '';
        await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, prefix + chunk);
      }
    } else {
      await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, formatStats(stats));
    }
  } catch (error) {
    console.error('Stats request failed', error instanceof Error ? error.message : 'unknown error');
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, 'Không thể lấy thống kê lúc này. Vui lòng thử lại sau.');
  }
}

async function handleGroupsCommand(env: Env, chatId: number): Promise<void> {
  try {
    const stats = await fetchStats(env);
    const groups = activeGroups(stats);
    const rows = groups.map(function (group, index) {
      return (index + 1) + '. ' + (group.chatTitle ?? group.chatUsername ?? 'Không tên') + ' — ' + group.chatId;
    });
    const output = ['Danh sách group active:'].concat(rows.length ? rows : ['Không có group active.']).join('\n');
    for (const chunk of splitText(output)) await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, chunk);
  } catch (error) {
    console.error('Groups command failed', error instanceof Error ? error.message : 'unknown error');
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, 'Không thể lấy danh sách group lúc này. Vui lòng thử lại sau.');
  }
}

async function handleLeaveCommand(env: Env, chatId: number, query: string): Promise<void> {
  var targetChatId = Number(query.trim());
  if (!/^-\d+$/.test(query.trim()) || !Number.isSafeInteger(targetChatId)) {
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, 'Dùng chat ID để tránh rời nhầm group. Gửi /groups rồi dùng: /leave <chat ID>.');
    return;
  }

  try {
    var stats = await fetchStats(env);
    var group = activeGroups(stats).find(function (item) { return item.chatId === targetChatId; });
    if (!group) {
      await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, 'Không tìm thấy group active với chat ID này. Gửi /groups để kiểm tra lại.');
      return;
    }
    var result = await leaveGroup(env, targetChatId);
    var title = result.chatTitle ?? group.chatTitle ?? String(targetChatId);
    if (result.alreadyLeft) {
      await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, 'Bot đã rời ' + title + ' từ trước.');
    } else {
      await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, 'Đã cho bot chính rời group: ' + title + '.');
    }
  } catch (error) {
    var message = error instanceof Error ? error.message : 'unknown error';
    console.error('Leave command failed', message);
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, 'Không thể rời group: ' + message);
  }
}

async function handleNotiCommand(env: Env, chatId: number, message: string, updateId?: number): Promise<void> {
  try {
    const result = await notifyAll(env, message, updateId);
    if (result.duplicate) {
      await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, 'Lệnh /noti này đã được xử lý trước đó.');
      return;
    }
    const lines = [
      result.queued ? 'Đang gửi thông báo tới tất cả user/group...' : 'Đã gửi thông báo tới tất cả user/group.',
      'Tổng hội thoại: ' + result.total,
      'Thành công: ' + result.sent,
      'Thất bại: ' + result.failed,
      'Số tin nhắn đã gửi: ' + result.messages,
    ];
    if (result.usedDefaultText) lines.push('Nội dung: tin nhắn /start mặc định');
    if (result.remaining > 0) lines.push('Còn lại: ' + result.remaining + ' (bot chính sẽ tự gửi tiếp mỗi phút)');
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, lines.join('\n'));
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown error';
    console.error('Noti command failed', detail);
    await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, 'Không thể gửi thông báo: ' + detail);
  }
}