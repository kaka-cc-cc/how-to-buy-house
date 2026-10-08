import { useState } from 'react';
import { Card, Input, Select, Table } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { TrendChart } from './TrendChart';
import { downloadCsv, formatChange, formatMonth, getOfficialHistory, getOfficialRows,
  latestOfficialMonth, officialCities, officialMonths, officialSource, readSaved, saveLocal } from '../lib/data';
import type { OfficialRow } from '../lib/data';

const validCities = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 5 &&
  value.every(city => typeof city === 'string' && officialCities.includes(city));

export function OfficialTracker() {
  const [cities, setCities] = useState(() => readSaved('house-official-cities', ['北京', '上海', '杭州', '深圳'], validCities));
  const [month, setMonth] = useState(latestOfficialMonth);
  const [range, setRange] = useState(24);
  const [search, setSearch] = useState('');
  const rows = getOfficialRows(month).filter(row => row.city.includes(search.trim()));
  const columns: ColumnsType<OfficialRow> = [
    { title: '城市', dataIndex: 'city', fixed: 'left', width: 100 },
    { title: '月度环比', dataIndex: 'mom', sorter: (a, b) => a.mom - b.mom, render: change, width: 130 },
    { title: '年度同比', dataIndex: 'yoy', sorter: (a, b) => a.yoy - b.yoy, render: change, width: 130 },
    { title: '价格指数', dataIndex: 'index', sorter: (a, b) => a.index - b.index, render: (value: number) => value.toFixed(2), width: 130 },
    { title: '较2022-05涨跌', key: 'change', sorter: (a, b) => a.index - b.index,
      render: (_, row) => change(Number((row.index - 100).toFixed(2))), width: 170 },
  ];
  return <>
    <div className="section-intro"><h2>70 城官方二手房价格指数</h2>
      <p>观察成交价格的涨跌趋势。2022 年 5 月统一设为 100，指数不能换算为每平方米房价。</p>
      <a href={officialSource} target="_blank" rel="noreferrer">国家统计局最新一期原始发布 ↗</a>
    </div>
    <Card title="城市趋势对比" extra={<span className="subtle">最多 5 个城市</span>}>
      <div className="filter-row">
        <Select aria-label="官方指数对比城市" mode="multiple" showSearch optionFilterProp="label" maxCount={5}
          value={cities} options={officialCities.map(city => ({ value: city, label: city }))}
          placeholder="选择对比城市" className="city-select" onChange={values => { setCities(values); saveLocal('house-official-cities', values); }} />
        <Select aria-label="官方指数数据月份" value={month} onChange={setMonth} options={[...officialMonths].reverse()
          .map(m => ({ value: m, label: formatMonth(m) }))} />
        <Select aria-label="走势时间范围" value={range} onChange={setRange}
          options={[{ value: 12, label: '近12个月' }, { value: 24, label: '近24个月' }, { value: 0, label: '全部历史' }]} />
      </div>
      <TrendChart series={cities.map(city => ({ name: city, points: range ? getOfficialHistory(city, month).slice(-range) : getOfficialHistory(city, month) }))} unit="指数" />
    </Card>
    <Card title={`${formatMonth(month)} · 全部 70 城`} className="section-card">
      <div className="filter-row table-toolbar"><Input.Search aria-label="搜索官方指数城市" placeholder="搜索城市" value={search}
        onChange={event => setSearch(event.target.value)} allowClear />
        <button className="plain-button" onClick={() => downloadCsv(`官方二手房指数-${formatMonth(month)}.csv`,
          [['城市', '月份', '环比(%)', '同比(%)', '指数(2022-05=100)', '较基期涨跌(%)', '来源'],
            ...rows.map(r => [r.city, formatMonth(month), r.mom, r.yoy, r.index, Number((r.index - 100).toFixed(3)), '国家统计局'])])}>导出当前表格</button>
      </div>
      <Table rowKey="city" dataSource={rows} columns={columns} scroll={{ x: 660 }} size="middle"
        pagination={{ defaultPageSize: 20, showSizeChanger: false, showTotal: total => `共 ${total} 个城市` }} />
    </Card>
    <p className="source-note">数据来自项目已有月度记录，最新一期为 {formatMonth(latestOfficialMonth)}；月度发布后需更新数据文件。
      环比、同比由官方指数减 100 得到；累计指数由月度环比逐月计算。</p>
  </>;
}

function change(value: number) {
  return <span className={value > 0 ? 'change-up' : value < 0 ? 'change-down' : 'subtle'}>{formatChange(value)}</span>;
}
