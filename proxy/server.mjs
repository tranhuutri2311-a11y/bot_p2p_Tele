import http from 'node:http';
const port = Number(process.env.PORT || 3000);
const secret = process.env.PROXY_SECRET;
const hosts = ['https://www.binance.com', 'https://p2p.binance.com'];
const server = http.createServer(async (req, res) => {
  if (req.url === '/health') { res.writeHead(200, {'content-type':'text/plain'}); return res.end('ok'); }
  if (req.url?.startsWith('/binance')) {
    if (!secret || req.headers['x-proxy-secret'] !== secret) { res.writeHead(401); return res.end('Unauthorized'); }
    const params = new URL(req.url, 'http://localhost').searchParams;
    const type = params.get('tradeType');
    const amount = Number(params.get('amount') ?? 20000000);
    const page = Number(params.get('page') ?? 1);
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(page) || page < 1 || page > 10) { res.writeHead(400); return res.end('Invalid amount/page'); }
    if (type !== 'BUY' && type !== 'SELL') { res.writeHead(400); return res.end('Invalid tradeType'); }
    for (const host of hosts) try {
      const target = `${host}/bapi/c2c/v2/friendly/c2c/adv/search`;
      const response = await fetch(target, {method:'POST',body:JSON.stringify({fiat:'VND',asset:'USDT',tradeType:type,transAmount:String(amount),page,rows:20,payTypes:[],publisherType:null}),signal:AbortSignal.timeout(25000),headers:{'content-type':'application/json',accept:'application/json','user-agent':'Mozilla/5.0 BinanceP2PProxy/1.0'}});
      if (!response.ok) continue;
      res.writeHead(200, {'content-type':'application/json','cache-control':'no-store'}); return res.end(await response.text());
    } catch {}
    res.writeHead(502); return res.end('Binance unavailable');
  }
  res.writeHead(404); res.end('Not found');
});
server.listen(port, () => console.log(`Proxy listening on ${port}`));
