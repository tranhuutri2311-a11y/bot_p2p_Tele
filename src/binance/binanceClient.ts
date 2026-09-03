import type { BinanceAd, BinanceResponse } from '../types/binance';
const ENDPOINTS = ['https://www.binance.com/bapi/c2c/v1/public/c2c/agent/ad-list', 'https://p2p.binance.com/bapi/c2c/v1/public/c2c/agent/ad-list']; const TIMEOUT_MS = 8000;
export async function fetchAds(tradeType: 'BUY' | 'SELL', proxyApiKey?: string, proxyUrl?: string, proxySecret?: string): Promise<BinanceAd[]> {
  let lastError = 'Binance request failed';
  for (const endpoint of ENDPOINTS) { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try { const target = `${endpoint}?fiat=VND&asset=USDT&tradeType=${tradeType}&limit=20`; const requestUrl = proxyUrl ? `${proxyUrl.replace(/\/$/, '')}?tradeType=${tradeType}` : proxyApiKey ? `https://api.scraperapi.com/?api_key=${encodeURIComponent(proxyApiKey)}&url=${encodeURIComponent(target)}` : target; const response = await fetch(requestUrl, { signal: controller.signal, headers: { accept: 'application/json, text/plain, */*', ...(proxySecret ? { 'x-proxy-secret': proxySecret } : {}), 'accept-language': 'en-US,en;q=0.9', origin: 'https://www.binance.com', referer: 'https://www.binance.com/', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36' } });
    if (!response.ok) { lastError = `Binance HTTP ${response.status}`; continue; } let body: unknown; try { body = await response.json(); } catch { throw new Error('Binance malformed JSON'); }
    if (!isResponse(body) || body.success === false) throw new Error('Binance unexpected response');
    const rows = Array.isArray(body.data) ? body.data : body.data && typeof body.data === 'object' && Array.isArray((body.data as { items?: unknown[] }).items) ? (body.data as { items: unknown[] }).items : null;
    if (!rows) throw new Error('Binance unexpected response'); return rows.filter(isAd);
  } finally { clearTimeout(timer); } }
  throw new Error(lastError);
}
function isResponse(value: unknown): value is BinanceResponse { return typeof value === 'object' && value !== null && ('data' in value || 'success' in value); }
function isAd(value: unknown): value is BinanceAd { if (typeof value !== 'object' || value === null) return false; const ad = value as Record<string, unknown>; return (typeof ad.price === 'string' || typeof ad.price === 'number') && ((typeof ad.minSingleTransAmount === 'string' || typeof ad.minSingleTransAmount === 'number') ? (typeof ad.maxSingleTransAmount === 'string' || typeof ad.maxSingleTransAmount === 'number') : (typeof ad.minTransAmount === 'string' || typeof ad.minTransAmount === 'number') && (typeof ad.maxTransAmount === 'string' || typeof ad.maxTransAmount === 'number')); }
