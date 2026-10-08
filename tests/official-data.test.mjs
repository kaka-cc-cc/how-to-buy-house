import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseOfficialTable } from '../scripts/update-official.mjs';

const data = JSON.parse(fs.readFileSync(new URL('../src/data/official-index.json', import.meta.url)));
test('official monthly series is complete, unique and finite', () => {
  assert.equal(new Set(data.cities).size, 70);
  let previous = data.baseMonth;
  for (const [month, rows] of Object.entries(data.months)) {
    const next = new Date(Date.UTC(Number(previous.slice(0, 4)), Number(previous.slice(4)), 1)).toISOString().slice(0, 7).replace('-', '');
    assert.equal(month, next);
    assert.equal(rows.length, 70);
    assert.ok(rows.every(row => row.length === 2 && row.every(value => Number.isFinite(value) && value > 0)));
    previous = month;
  }
});
test('matches the checked original NBS releases for Beijing', () => {
  const beijing = data.cities.indexOf('北京');
  assert.deepEqual(data.months['202206'][beijing], [100.5, 104.5]);
  assert.deepEqual(data.months['202506'][beijing], [99, 98.2]);
  assert.deepEqual(data.months['202608'][beijing], [99.9, 96.5]);
});
test('extracts table 2 and refuses incomplete city data', () => {
  const html = '<p>表2：2026年8月70个大中城市二手住宅销售价格指数</p><table><tr><td>北　京</td><td>99.9</td><td>96.5</td><td>93.4</td><td>唐 山</td><td>99.4</td><td>92.6</td><td>92</td></tr></table>';
  assert.deepEqual(parseOfficialTable(html, ['北京', '唐山']), [[99.9, 96.5], [99.4, 92.6]]);
  assert.throws(() => parseOfficialTable(html, ['北京', '上海']), /解析到/);
});
test('national catalog is unique and includes cities outside the official 70', () => {
  const catalog = JSON.parse(fs.readFileSync(new URL('../src/data/regions.json', import.meta.url)));
  assert.equal(new Set(catalog.map(region => region.code)).size, catalog.length);
  assert.ok(catalog.some(region => region.name === '苏州市'));
  assert.ok(catalog.some(region => region.name === '东莞市'));
  assert.ok(catalog.some(region => region.name === '石河子市'));
  assert.ok(!catalog.some(region => region.name === '市辖区'));
});
