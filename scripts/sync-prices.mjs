import fs from 'node:fs/promises';
import { fetchPrice } from '../api/house-price.mjs';

const key = process.env.GOTOHUI_API_KEY;
if (!key) { console.error('请先在 .env.local 配置 GOTOHUI_API_KEY。'); process.exit(1); }
const limit = Number(process.argv.find(arg => arg.startsWith('--limit='))?.split('=')[1] ?? 90);
if (!Number.isInteger(limit) || limit < 1 || limit > 90) { console.error('单批限制必须为 1–90，保留部分查询额度供页面使用。'); process.exit(1); }
const catalog = JSON.parse(await fs.readFile(new URL('../src/data/regions.json', import.meta.url)));
const snapshotPath = new URL('../public/data/prices.json', import.meta.url);
const statePath = new URL('../.cache/prices-progress.json', import.meta.url);
const batchMonth = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit' }).format(new Date());
const snapshot = JSON.parse(await fs.readFile(snapshotPath));
let state = { month: batchMonth, attempted: {} };
try { const saved = JSON.parse(await fs.readFile(statePath)); if (saved.month === batchMonth) state = saved; } catch { /* First run. */ }
const records = new Map(snapshot.records.map(record => [record.region, record]));
await fs.mkdir(new URL('../.cache', import.meta.url), { recursive: true });
let queried = 0;
let loaded = 0;
for (const region of catalog) {
  if (state.attempted[region.code] || queried >= limit) continue;
  const name = region.name.replace(/市$/, '');
  const result = await fetchPrice(name, undefined, { key });
  queried++;
  if (!result.ok) {
    console.error(result.message);
    // Keep the failed region pending. Never destroy older successful records.
    break;
  }
  state.attempted[region.code] = new Date().toISOString();
  if (result.record) { records.set(name, result.record); loaded++; }
  else console.log(`${region.name}：${result.message ?? '暂无数据'}`);
  // Save after each request so interrupted batches can resume.
  await fs.writeFile(snapshotPath, JSON.stringify({ updatedAt: new Date().toISOString(), source: '聚汇数据', records: [...records.values()] }, null, 2) + '\n');
  await fs.writeFile(statePath, JSON.stringify(state, null, 2) + '\n');
}
console.log(`本批查询 ${queried}，成功取得 ${loaded}；本月已尝试 ${Object.keys(state.attempted).length}/${catalog.length}。`);
