import test from 'node:test';
import assert from 'node:assert/strict';
import handler, { fetchPrice, normalizePrice } from '../api/house-price.mjs';

const example = { region_id: 49, region_name: '深圳', period: '2026-03', has_data: true,
  second_hand_price: 60949, second_hand_price_yoy: -5.2, second_hand_price_mom: -0.8 };

test('normalizes actual second-hand prices and preserves missing changes', () => {
  const result = normalizePrice({ ...example, second_hand_price_mom: null }, '深圳');
  assert.equal(result.record.price, 60949);
  assert.equal(result.record.mom, null);
  assert.equal(result.record.yoy, -5.2);
  assert.equal(normalizePrice({ ...example, second_hand_price: 0 }, '深圳').hasData, false);
  assert.equal(normalizePrice({ ...example, has_data: false }, '深圳').record, undefined);
});
test('ambiguous region names return candidates rather than the wrong city price', () => {
  const result = normalizePrice({ ambiguous: true, candidates: [{ region_id: 4, region_name: '朝阳', parent_region: '辽宁' }] }, '朝阳');
  assert.equal(result.hasData, false);
  assert.equal(result.record, undefined);
  assert.deepEqual(result.candidates, [{ id: 4, name: '朝阳', parent: '辽宁' }]);
});
test('no credential performs no external request', async () => {
  const result = await fetchPrice('北京', undefined, { fetcher: () => { throw new Error('must not call'); } });
  assert.equal(result.code, 'NOT_CONFIGURED');
});
test('reads business status even if upstream HTTP status is 200', async () => {
  const result = await fetchPrice('测试额度', undefined, { key: 'test-only', throttle: false,
    fetcher: async () => ({ ok: true, json: async () => ({ status: 400, code: 503004 }) }) });
  assert.equal(result.ok, false);
  assert.equal(result.code, '503004');
});
test('deduplicates in-flight requests and caches successful responses', async () => {
  let calls = 0;
  const options = { key: 'test-only', throttle: false, fetcher: async (url, init) => {
    calls++; assert.equal(init.headers.Authorization, 'Bearer test-only');
    assert.equal(new URL(url).searchParams.get('region'), '测试缓存');
    await new Promise(resolve => setTimeout(resolve, 10));
    return { ok: true, json: async () => ({ status: 200, data: example }) };
  } };
  const results = await Promise.all([fetchPrice('测试缓存', undefined, options), fetchPrice('测试缓存', undefined, options)]);
  assert.equal(results[0].record.price, 60949);
  await fetchPrice('测试缓存', undefined, options);
  assert.equal(calls, 1);
});
test('never mislabels a returned latest price as a requested historical month', async () => {
  const result = await fetchPrice('测试月份', '2025-12', { key: 'test-only', throttle: false,
    fetcher: async () => ({ ok: true, json: async () => ({ status: 200, data: example }) }) });
  assert.equal(result.hasData, false);
  assert.equal(result.record, undefined);
  assert.equal(result.latestPeriod, '2026-03');
});
test('status endpoint hides the credential; invalid region input makes no upstream request', async () => {
  const outputs = [];
  const res = { setHeader() {}, end(value) { outputs.push(JSON.parse(value)); }, statusCode: 200 };
  await handler({ method: 'GET', url: '/api/house-price?action=status' }, res);
  assert.equal(typeof outputs[0].configured, 'boolean');
  assert.deepEqual(Object.keys(outputs[0]).sort(), ['configured', 'ok']);
  await handler({ method: 'GET', url: '/api/house-price?region=https://invalid.example' }, res);
  assert.equal(res.statusCode, 400);
});
