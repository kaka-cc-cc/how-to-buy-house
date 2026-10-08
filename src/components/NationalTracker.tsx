import { useEffect, useState } from 'react';
import { Alert, Button, Card, Drawer, Input, Select, Switch, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { TrendChart } from './TrendChart';
import { catalog, downloadCsv, formatChange, queryPrice, readSaved, saveLocal, sourceUrl } from '../lib/data';
import type { PriceRecord, PriceResponse, Region } from '../lib/data';

const queryName = (region: Region) => region.name.replace(/市$/, '');
const validFavorites = (value: unknown): value is string[] => Array.isArray(value) &&
  value.every(code => typeof code === 'string' && catalog.some(region => region.code === code));
const validRecords = (value: unknown): value is PriceRecord[] => Array.isArray(value) && value.every(record => {
  if (!record || typeof record !== 'object') return false;
  const r = record as Partial<PriceRecord>;
  return typeof r.region === 'string' && typeof r.name === 'string' && typeof r.price === 'number' && Number.isFinite(r.price) && r.price > 0 &&
    typeof r.period === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(r.period) && typeof r.fetchedAt === 'string' &&
    Number.isFinite(Date.parse(r.fetchedAt)) && (r.mom === null || typeof r.mom === 'number') &&
    (r.yoy === null || typeof r.yoy === 'number');
});
type PriceRow = Region & { record?: PriceRecord };

export function NationalTracker({ onShowOfficial }: { onShowOfficial: () => void }) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [serviceError, setServiceError] = useState('');
  const [favorites, setFavorites] = useState(() => readSaved('house-favorites', ['110100', '310100', '330100', '440300'], validFavorites));
  const [records, setRecords] = useState(() => readSaved('house-price-cache', [], validRecords));
  const [selected, setSelected] = useState(favorites.slice(0, 5));
  const [search, setSearch] = useState('');
  const [province, setProvince] = useState<string>();
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [detail, setDetail] = useState<{ region: string; name: string }>();
  const [candidates, setCandidates] = useState<PriceResponse['candidates']>();
  const [history, setHistory] = useState<PriceRecord[]>([]);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyNotice, setHistoryNotice] = useState('');
  const [customQuery, setCustomQuery] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/house-price?action=status', { signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error(); return response.json(); })
      .then((data: PriceResponse) => {
        if (typeof data.configured !== 'boolean') throw new Error();
        setConfigured(data.configured);
      }).catch(error => { if (error.name !== 'AbortError') setServiceError('均价查询服务暂时不可用，已保存的数据仍可查看。'); });
    fetch('/data/prices.json', { signal: controller.signal }).then(response => response.json())
      .then((snapshot: { records?: unknown }) => {
        if (!validRecords(snapshot.records)) return;
        const incoming = snapshot.records;
        setRecords(previous => mergeRecords(previous, incoming));
      }).catch(() => { /* A missing snapshot does not replace saved data. */ });
    return () => controller.abort();
  }, []);
  useEffect(() => saveLocal('house-price-cache', records), [records]);
  useEffect(() => saveLocal('house-favorites', favorites), [favorites]);

  const latestRecords = new Map<string, PriceRecord>();
  for (const record of [...records].sort((a, b) => a.period.localeCompare(b.period))) latestRecords.set(record.region, record);
  const allRows = catalog.map(region => ({ ...region, record: latestRecords.get(queryName(region)) }));
  const rows = allRows.filter(region => (!province || region.province === province) &&
    (!onlyFavorites || favorites.includes(region.code)) && `${region.name}${region.province}`.includes(search.trim()));
  const loadedCount = allRows.filter(row => row.record).length;

  function follow(code: string) {
    setFavorites(values => values.includes(code) ? values.filter(value => value !== code) : [...values, code]);
  }
  async function load(region: string, fresh = false): Promise<PriceResponse> {
    const saved = latestRecords.get(region);
    if (!fresh && saved && Date.now() - Date.parse(saved.fetchedAt) < 86400000) return { ok: true, hasData: true, record: saved };
    const result = await queryPrice(region);
    if (result.record) setRecords(previous => mergeRecords(previous, [result.record!]));
    return result;
  }
  async function refreshSelected() {
    setBusy(true); setNotice('');
    let loaded = 0;
    const failures: string[] = [];
    for (const code of selected) {
      const region = catalog.find(item => item.code === code)!;
      try {
        const response = await load(queryName(region), true);
        if (response.record) loaded++;
        else failures.push(`${region.name}：${response.message ?? '暂无数据'}`);
        if (response.code === '503004') break;
      } catch { failures.push(`${region.name}：查询失败`); }
    }
    setNotice(`已更新 ${loaded} 个地区。${failures.join('；')}`); setBusy(false);
  }
  async function openDetail(region: string, name: string) {
    setDetail({ region, name }); setHistory([]); setHistoryNotice(''); setCandidates(undefined);
    if (!configured) {
      const saved = latestRecords.get(region);
      if (saved) setHistory(records.filter(record => record.region === region).sort((a, b) => a.period.localeCompare(b.period)).slice(-6));
      return;
    }
    setBusy(true);
    try {
      const result = await load(region);
      setCandidates(result.candidates);
      if (result.record) setHistory([result.record]);
      else setHistoryNotice(result.message ?? '暂无数据');
    } catch { setHistoryNotice('查询失败，请稍后重试。'); }
    finally { setBusy(false); }
  }
  async function loadHistory() {
    if (!detail) return;
    const latest = latestRecords.get(detail.region) ?? history.at(-1);
    if (!latest) { setHistoryNotice('请先取得该地区的最新价格，再加载历史。'); return; }
    setHistoryBusy(true); setHistoryNotice('');
    const [year, month] = latest.period.split('-').map(Number);
    const points: PriceRecord[] = [];
    let missing = 0;
    let failure = '';
    for (let offset = 5; offset >= 0; offset--) {
      const date = new Date(Date.UTC(year, month - 1 - offset, 1));
      const period = date.toISOString().slice(0, 7);
      const saved = records.find(r => r.region === detail.region && r.period === period && Date.now() - Date.parse(r.fetchedAt) < 86400000);
      if (saved) { points.push(saved); continue; }
      try {
        const result = await queryPrice(detail.region, period);
        if (!result.ok) { failure = result.message ?? '历史查询失败'; break; }
        if (result.record) points.push(result.record); else missing++;
      } catch { failure = '历史查询失败'; break; }
    }
    setHistory(points); setRecords(previous => mergeRecords(previous, points));
    setHistoryNotice(failure || (missing ? `${missing} 个月暂无数据，图表只显示实际返回的记录。` : '已加载近 6 个月记录。'));
    setHistoryBusy(false);
  }

  const columns: ColumnsType<PriceRow> = [
    { title: '关注', key: 'favorite', width: 64, fixed: 'left', render: (_, row) => <button className="favorite-button"
      aria-label={`${favorites.includes(row.code) ? '取消关注' : '关注'}${row.name}`} onClick={() => follow(row.code)}>
      {favorites.includes(row.code) ? '★' : '☆'}</button> },
    { title: '地区', dataIndex: 'name', width: 130, render: (_, row) => <button className="text-button" disabled={busy || historyBusy}
      onClick={() => void openDetail(queryName(row), row.name)}>{row.name}</button> },
    { title: '省份', dataIndex: 'province', width: 150 },
    { title: '二手房参考均价', key: 'price', width: 170, sorter: (a, b) => (a.record?.price ?? -1) - (b.record?.price ?? -1),
      render: (_, row) => row.record ? `${row.record.price.toLocaleString('zh-CN')} 元/㎡` : <span className="subtle">暂无数据</span> },
    { title: '环比', key: 'mom', width: 110, sorter: (a, b) => (a.record?.mom ?? -Infinity) - (b.record?.mom ?? -Infinity),
      render: (_, row) => <Change value={row.record?.mom ?? null} /> },
    { title: '同比', key: 'yoy', width: 110, sorter: (a, b) => (a.record?.yoy ?? -Infinity) - (b.record?.yoy ?? -Infinity),
      render: (_, row) => <Change value={row.record?.yoy ?? null} /> },
    { title: '数据月份', key: 'period', width: 120, render: (_, row) => row.record?.period ?? '—' },
    { title: '查询', key: 'action', width: 90, render: (_, row) => <button className="text-button" disabled={!configured || busy}
      onClick={() => void openDetail(queryName(row), row.name)}>查看走势</button> },
  ];
  return <>
    <div className="section-intro"><h2>全国二手房参考均价</h2>
      <p>按城市、地区筛选，保存你关注的地方。第三方参考均价与官方成交价格指数分开展示。</p></div>
    {configured === false && <Alert type="info" showIcon message="全国均价数据尚未接入"
      description={<span>地区目录已就绪，均价将在数据源连接后按需查询。现在可以查看已收录的 <button className="text-button" onClick={onShowOfficial}>70城官方指数</button>。</span>} />}
    {serviceError && <Alert type="warning" showIcon message={serviceError} />}
    <div className="summary-grid">
      <div><span>地区目录</span><strong>{catalog.length}</strong><small>中国大陆地级地区及省直辖地区</small></div>
      <div><span>已取得均价</span><strong>{loadedCount}<em> / {catalog.length}</em></strong><small>目录数量不代表数据源实际覆盖数量</small></div>
      <div><span>我的关注</span><strong>{favorites.length}</strong><small>保存在当前浏览器</small></div>
    </div>
    <Card title="关注与对比">
      <div className="filter-row"><Select aria-label="均价对比地区" mode="multiple" showSearch optionFilterProp="label" maxCount={5}
        className="city-select" value={selected} onChange={setSelected} placeholder="选择最多5个地区"
        options={catalog.map(region => ({ value: region.code, label: `${region.name} · ${region.province}` }))} />
        <Button onClick={() => void refreshSelected()} loading={busy} disabled={!configured || selected.length === 0}>更新对比地区</Button></div>
      <div className="comparison-grid">{selected.map(code => {
        const region = catalog.find(item => item.code === code)!;
        const record = latestRecords.get(queryName(region));
        return <button key={code} className="price-card" disabled={busy || historyBusy} onClick={() => void openDetail(queryName(region), region.name)}>
          <span>{region.name}</span><strong>{record ? record.price.toLocaleString('zh-CN') : '—'}<small> 元/㎡</small></strong>
          <span className="subtle">{record?.period ?? '尚无价格记录'}</span>
          <span>环比 <Change value={record?.mom ?? null} /> · 同比 <Change value={record?.yoy ?? null} /></span>
        </button>;
      })}</div>
      {notice && <p role="status" className="source-note">{notice}</p>}
    </Card>
    <Card title="全国地区查询" className="section-card">
      <div className="filter-row table-toolbar">
        <Input.Search aria-label="搜索全国地区" placeholder="搜索城市、地区或省份" value={search} allowClear
          onChange={event => { setSearch(event.target.value); setPage(1); }} />
        <Select aria-label="筛选省份" placeholder="全部省份" allowClear value={province} onChange={value => { setProvince(value); setPage(1); }}
          options={[...new Set(catalog.map(r => r.province))].map(value => ({ value, label: value }))} />
        <label className="switch-label"><Switch checked={onlyFavorites} onChange={value => { setOnlyFavorites(value); setPage(1); }} />只看关注</label>
        <button className="plain-button" onClick={() => downloadCsv('全国二手房参考均价.csv',
          [['地区', '省份', '参考均价(元/㎡)', '环比(%)', '同比(%)', '数据月份', '查询时间', '数据源'],
            ...rows.map(row => [row.name, row.province, row.record?.price ?? null, row.record?.mom ?? null,
              row.record?.yoy ?? null, row.record?.period ?? null, row.record?.fetchedAt ?? null, row.record ? '聚汇数据' : '暂无数据'])])}>导出当前表格</button>
      </div>
      <Table rowKey="code" columns={columns} dataSource={rows} scroll={{ x: 1040 }} size="middle"
        pagination={{ current: page, onChange: setPage, pageSize: 20, showSizeChanger: false, showTotal: total => `共 ${total} 个地区` }} />
      <div className="custom-query"><span>目录外的城市或区县</span><Input.Search aria-label="查询目录外地区" placeholder="如：杭州余杭"
        value={customQuery} onChange={event => setCustomQuery(event.target.value)} disabled={!configured || busy}
        enterButton="查询" onSearch={value => { if (value.trim()) void openDetail(value.trim(), value.trim()); }} /></div>
    </Card>
    <p className="source-note">来源：<a href={sourceUrl} target="_blank" rel="noreferrer">聚汇数据</a>。均价口径以数据源说明为准，不等于每套房的实际成交价。
      部分地区可能无数据或月份较旧，请以每条记录的月份为准。单次结果缓存 24 小时；默认额度为每天 100 次免费查询。</p>
    <Drawer title={detail ? `${detail.name} · 二手房参考均价` : '地区价格'} open={Boolean(detail)} width={640}
      destroyOnHidden onClose={() => { if (!historyBusy && !busy) setDetail(undefined); }}>
      {!configured && <Alert type="info" message="全国均价数据尚未连接" />}
      {busy && <p role="status">正在查询价格…</p>}
      {candidates?.length ? <div><p>请选择准确的地区：</p>{candidates.map(candidate => <button className="plain-button candidate"
        key={candidate.id} disabled={busy} onClick={() => void openDetail(String(candidate.id), `${candidate.name} · ${candidate.parent}`)}>
        {candidate.name} · {candidate.parent}</button>)}</div> : null}
      {history.length > 0 && <>
        <p className="detail-price">{history.at(-1)!.price.toLocaleString('zh-CN')} <small>元/㎡</small></p>
        <p>数据月份：{history.at(-1)!.period} · 环比 <Change value={history.at(-1)!.mom} /> · 同比 <Change value={history.at(-1)!.yoy} /></p>
        <Button loading={historyBusy} disabled={busy || !configured} onClick={() => void loadHistory()}>加载近6个月走势</Button>
        <p className="source-note">最多使用 6 次免费查询，已有缓存会优先复用。</p>
        <TrendChart unit="元/㎡" series={[{ name: detail!.name, points: history.map(record => ({ month: record.period, value: record.price })) }]} />
      </>}
      {historyNotice && <p role="status">{historyNotice}</p>}
    </Drawer>
  </>;
}

function Change({ value }: { value: number | null }) {
  return <span className={value !== null && value > 0 ? 'change-up' : value !== null && value < 0 ? 'change-down' : 'subtle'}>{formatChange(value)}</span>;
}
function mergeRecords(previous: PriceRecord[], incoming: PriceRecord[]): PriceRecord[] {
  const combined = new Map(previous.map(record => [`${record.region}:${record.period}`, record]));
  for (const record of incoming) {
    const key = `${record.region}:${record.period}`;
    const old = combined.get(key);
    if (!old || record.fetchedAt >= old.fetchedAt) combined.set(key, record);
  }
  return [...combined.values()].sort((a, b) => a.fetchedAt.localeCompare(b.fetchedAt)).slice(-3000);
}
