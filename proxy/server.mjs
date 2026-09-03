import http from 'node:http';
const port = Number(process.env.PORT || 3000);
const secret = process.env.PROXY_SECRET;
const hosts = ['https://www.binance.com', 'https://p2p.binance.com'];
const server = http.createServer(async (req, res) => {
  if (req.url === '/health') { res.writeHead(200, {'content-type':'text/plain'}); return res.end('ok'); }
  if (req.url?.startsWith('/binance')) {
    if (!secret || req.headers['x-proxy-secret'] !== secret) { res.writeHead(401); return res.end('Unauthorized'); }
    const type = new URL(req.url, 'http://localhost').searchParams.get('tradeType');
    if (type !== 'BUY' && type !== 'SELL') { res.writeHead(400); return res.end('Invalid tradeType'); }
    for (const host of hosts) try {
      const target = `${host}/bapi/c2c/v1/public/c2c/agent/ad-list?fiat=VND&asset=USDT&tradeType=${type}&limit=20`;
      const response = await fetch(target, {headers:{accept:'application/json','user-agent':'Mozilla/5.0 BinanceP2PProxy/1.0'}});
      if (!response.ok) continue;
      res.writeHead(200, {'content-type':'application/json','cache-control':'no-store'}); return res.end(await response.text());
    } catch {}
    res.writeHead(502); return res.end('Binance unavailable');
  }
  res.writeHead(404); res.end('Not found');
});
server.listen(port, () => console.log(`Proxy listening on ${port}`));
