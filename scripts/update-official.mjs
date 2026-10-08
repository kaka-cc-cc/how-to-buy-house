import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const plain = value => value.replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;|\s|　/g, '').trim();

export function parseOfficialTable(html, cities) {
  const tables = [...html.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)].map(match => ({ html: match[0], at: match.index }));
  let table = tables.find(item => plain(item.html).includes('二手住宅销售价格指数') && !plain(item.html).includes('分类指数'));
  if (!table) {
    const title = html.search(/表\s*2[\s\S]{0,500}?二手住宅销售价格指数/);
    table = tables.find(item => item.at > title && title >= 0);
  }
  if (!table) throw new Error('没有找到表2：二手住宅销售价格指数，未修改数据。');
  const result = new Map();
  for (const row of table.html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell => plain(cell[1]));
    for (let i = 0; i < cells.length; i++) {
      if (!cities.includes(cells[i])) continue;
      const hb = Number(cells[i + 1]);
      const tb = Number(cells[i + 2]);
      if (!Number.isFinite(hb) || !Number.isFinite(tb) || hb <= 0 || tb <= 0 || hb > 150 || tb > 150) throw new Error(`指标异常：${cells[i]}`);
      if (result.has(cells[i])) throw new Error(`重复城市：${cells[i]}`);
      result.set(cells[i], [hb, tb]);
    }
  }
  if (result.size !== cities.length) throw new Error(`仅解析到 ${result.size}/${cities.length} 个城市，未修改数据。`);
  return cities.map(city => result.get(city));
}

async function main() {
  const source = process.argv.find(arg => arg.startsWith('--url='))?.slice(6);
  const month = process.argv.find(arg => arg.startsWith('--month='))?.slice(8);
  if (!source || !/^\d{4}(0[1-9]|1[0-2])$/.test(month ?? '')) throw new Error('用法：npm run update:official -- --month=202609 --url=国家统计局原始发布链接');
  const url = new URL(source);
  if (url.protocol !== 'https:' || !(url.hostname === 'stats.gov.cn' || url.hostname.endsWith('.stats.gov.cn'))) throw new Error('只接受国家统计局 HTTPS 原始发布页面。');
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error('原始页面获取失败，未修改数据。');
  const html = await response.text();
  const [year, monthNumber] = [month.slice(0, 4), String(Number(month.slice(4)))];
  if (!plain(html).includes(`${year}年${monthNumber}月`)) throw new Error('原始页面月份与指定月份不一致，未修改数据。');
  const file = new URL('../src/data/official-index.json', import.meta.url);
  const data = JSON.parse(await fs.readFile(file));
  const rows = parseOfficialTable(html, data.cities);
  const latest = Object.keys(data.months).sort().at(-1);
  const next = new Date(Date.UTC(Number(latest.slice(0, 4)), Number(latest.slice(4)), 1)).toISOString().slice(0, 7).replace('-', '');
  if (!data.months[month] && month !== next) throw new Error('月份必须连续，请先补齐缺失月份。');
  data.months[month] = rows;
  data.months = Object.fromEntries(Object.entries(data.months).sort(([a], [b]) => a.localeCompare(b)));
  if (month >= latest) data.latestSourceUrl = url.href;
  await fs.writeFile(file, JSON.stringify(data) + '\n');
  console.log(`已更新 ${month}，完整收录 ${rows.length} 城二手房指数。`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
