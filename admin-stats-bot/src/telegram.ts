const TELEGRAM_API = 'https://api.telegram.org';

export async function sendMessage(token: string, chatId: number, text: string): Promise<void> {
  const response = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });

  if (!response.ok) {
    throw new Error(`Telegram API returned HTTP ${response.status}`);
  }
}
