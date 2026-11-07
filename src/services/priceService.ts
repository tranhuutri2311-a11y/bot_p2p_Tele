import { fetchAds } from '../binance/binanceClient'; import type { BinanceAd } from '../types/binance';
export interface PriceResult { amount: number; buyPrice: number; sellPrice: number; buyUsdt: number; sellUsdt: number; spread: number; spreadPercent: number }
export class NoValidAdsError extends Error { constructor(public side: 'BUY' | 'SELL', public validCount: number, public receivedCount = 0) { super(side); } }
export function filterAds(ads: BinanceAd[], amount: number): BinanceAd[] { return ads.filter(ad => { const p = Number(ad.price); const min = Number(ad.minSingleTransAmount ?? ad.minTransAmount); const max = Number(ad.maxSingleTransAmount ?? ad.maxTransAmount); const requested = ad.minSingleTransAmount !== undefined ? amount : amount / p; return [p, min, max, requested].every(Number.isFinite) && p > 0 && min <= requested && max >= requested; }); }
export function selectPrice(ads: BinanceAd[], amount: number, _side: 'BUY' | 'SELL'): number | null { const validAds = filterAds(ads, amount); return validAds.length >= 3 ? Number(validAds[2].price) : null; }
async function fetchMatchingAds(side: 'BUY' | 'SELL', amount: number, proxyApiKey?: string, proxyUrl?: string, proxySecret?: string): Promise<BinanceAd[]> {
  const ads: BinanceAd[] = []; const seen = new Set<string>();
  // Binance may return a short page before later pages still contain valid ads.
  for (let page = 1; page <= 10; page++) {
    let rows: BinanceAd[] = [];
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        rows = await fetchAds(side, proxyApiKey, proxyUrl, proxySecret, amount, page);
        if (rows.length > 0 || attempt === 2) break;
        console.warn('Binance empty page retry', { side, amount, page, attempt });
      } catch (error) {
        console.warn('Binance page retry', { side, amount, page, attempt, error: error instanceof Error ? error.message : 'unknown error' });
        if (attempt === 2) throw error;
      }
    }
    const fresh = rows.filter(ad => {
      const id = ad.advNo ?? ad.adNo ?? `${ad.price}:${ad.minSingleTransAmount ?? ad.minTransAmount}:${ad.maxSingleTransAmount ?? ad.maxTransAmount}:${ad.tradableAmount ?? ''}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    ads.push(...fresh);
    const matching = filterAds(ads, amount);
    console.log('Binance ads summary', { side, amount, page, receivedAds: ads.length, matchingAds: matching.length, requiredAds: 3 });
    if (matching.length >= 3 || fresh.length === 0) break;
  }
  return ads;
}
export async function getPrice(amount: number, proxyApiKey?: string, proxyUrl?: string, proxySecret?: string): Promise<PriceResult> { const [buyAds, sellAds] = await Promise.all([fetchMatchingAds('BUY', amount, proxyApiKey, proxyUrl, proxySecret), fetchMatchingAds('SELL', amount, proxyApiKey, proxyUrl, proxySecret)]); const buyPrice = selectPrice(buyAds, amount, 'BUY'); const sellPrice = selectPrice(sellAds, amount, 'SELL'); if (buyPrice === null) throw new NoValidAdsError('BUY', filterAds(buyAds, amount).length, buyAds.length); if (sellPrice === null) throw new NoValidAdsError('SELL', filterAds(sellAds, amount).length, sellAds.length); const spread = sellPrice - buyPrice; return { amount, buyPrice, sellPrice, buyUsdt: amount / buyPrice, sellUsdt: amount / sellPrice, spread, spreadPercent: spread / buyPrice * 100 }; }
