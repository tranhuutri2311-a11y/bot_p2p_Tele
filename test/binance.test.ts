import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchAds } from '../src/binance/binanceClient';
import { getPrice, NoValidAdsError } from '../src/services/priceService';

test('search sends amount/page, unwraps ads, paginates and deduplicates', async () => {
  const original = globalThis.fetch;
  const calls: Array<{ tradeType: string; page: number }> = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(init?.method, 'POST');
    assert.equal(body.transAmount, '20000000');
    calls.push(body);
    const valid = (advNo: string, price: string) => ({ adv: { advNo, price, minSingleTransAmount: '1', maxSingleTransAmount: '50000000' } });
    const data = body.tradeType === 'SELL' ? [valid('s1', '27000'), valid('s2', '27001'), valid('s3', '27002')]
      : body.page === 1 ? [valid('b1', '26000'), valid('b2', '26001'), ...Array.from({length:18}, (_,i) => ({adv:{advNo:'invalid'+i,price:'26000',minSingleTransAmount:'1',maxSingleTransAmount:'2'}}))]
      : [valid('b2', '26001'), valid('b3', '26002')];
    return Response.json({ success: true, data });
  };
  try {
    const result = await getPrice(20000000);
    assert.equal(result.buyPrice, 26002);
    assert.equal(result.sellPrice, 27002);
    assert.equal(calls.filter(c => c.tradeType === 'BUY').length, 2);
  } finally { globalThis.fetch = original; }
});

test('proxy query forwards amount/page and insufficient count is after filtering', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = new URL(String(url));
    assert.equal(u.searchParams.get('amount'), '20000000');
    assert.ok(u.searchParams.get('page'));
    assert.equal(init?.method, 'GET');
    return Response.json({success:true,data:[{adv:{advNo:'1',price:'26000',minSingleTransAmount:'1',maxSingleTransAmount:'2'}}]});
  };
  try {
    assert.equal((await fetchAds('BUY', undefined, 'https://proxy.example/binance', 'secret', 20000000, 2)).length, 1);
    await assert.rejects(getPrice(20000000, undefined, 'https://proxy.example/binance'), error => error instanceof NoValidAdsError && error.validCount === 0);
  } finally { globalThis.fetch = original; }
});

test('continues after a short page and deduplicates legacy adNo responses', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const ad = (adNo: string, price: string) => ({ adNo, price, minTransAmount: '1', maxTransAmount: '2000' });
    const data = body.page === 1
      ? [ad('a1', '26000'), ad('a2', '26001')]
      : [ad('a2', '26001'), ad('a3', '26002')];
    return Response.json({ success: true, data: { items: data } });
  };
  try {
    const result = await getPrice(20000000);
    assert.equal(result.buyPrice, 26002);
  } finally { globalThis.fetch = original; }
});
