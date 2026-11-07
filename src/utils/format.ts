import type { PriceResult } from '../services/priceService'; const vnd = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }); const decimal = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
export function parseAmount(text: string): number | null { const raw = text.trim().replace(/,/g, ''); if (!/^\d+(?:\.\d+)?$/.test(raw)) return null; const amount = Number(raw); return Number.isFinite(amount) && amount > 0 ? amount : null; }
export function formatPrice(result: PriceResult, updatedAt = new Date()): string { const parts = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(updatedAt); const get = (type: string) => parts.find(part => part.type === type)?.value ?? ''; const time = `${get('hour')}:${get('minute')}:${get('second')} ${get('day')}/${get('month')}/${get('year')}`; const buyFinal = result.buyPrice * 1.0085; const sellFinal = result.sellPrice * 0.9915; return `💵 VND/USDT Realtime\n\n💰 Mua: ${vnd.format(buyFinal)} VND/USDT\n💰 Bán: ${vnd.format(sellFinal)} VND/USDT\n\n⏰ Cập nhật: ${time}`; }
export const HELP = '👋 Chào mừng đến với VNOTC — tỷ giá cập nhật liên tục, giao dịch an tâm.\n\n🙏 Cảm ơn bạn đã tin tưởng, VNOTC luôn sẵn sàng hỗ trợ bạn 24/7.\n\n📋 Cú pháp:\n/otc — Kiểm tra tỷ giá mua/bán USDT/VND';

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