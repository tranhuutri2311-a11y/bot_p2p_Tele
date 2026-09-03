import test from 'node:test'; import assert from 'node:assert/strict'; import { selectPrice } from '../src/services/priceService'; import { parseAmount } from '../src/utils/format';
const ads = (rows: string[][]) => rows.map(([price, minSingleTransAmount, maxSingleTransAmount]) => ({ price, minSingleTransAmount, maxSingleTransAmount }));
test('BUY filters unsupported ads and selects minimum', () => assert.equal(selectPrice(ads([['26000','1000000','5000000'],['26100','10000000','50000000']]), 20000000, 'BUY'), 26100));
test('SELL filters unsupported ads and selects maximum', () => assert.equal(selectPrice(ads([['26500','10000000','50000000'],['26600','1000000','5000000']]), 20000000, 'SELL'), 26500));
test('no valid ads returns null', () => assert.equal(selectPrice(ads([['26000','1','2']]), 20, 'BUY'), null));
test('amount parsing', () => { assert.equal(parseAmount('20000000'), 20000000); assert.equal(parseAmount('20,000,000'), 20000000); assert.equal(parseAmount('abc'), null); assert.equal(parseAmount('0'), null); });
