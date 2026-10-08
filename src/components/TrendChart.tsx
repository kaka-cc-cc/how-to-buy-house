export interface TrendSeries {
  name: string;
  points: { month: string; value: number }[];
}

const colors = ['#2563eb', '#0f766e', '#b45309', '#7c3aed', '#be185d'];

export function TrendChart({ series, unit }: { series: TrendSeries[]; unit: string }) {
  const valid = series.filter(s => s.points.length > 0);
  const compact = (month: string) => month.replace('-', '');
  const observed = [...new Set(valid.flatMap(s => s.points.map(p => compact(p.month))))].sort();
  if (observed.length === 0) return <div className="chart-empty">选择城市并加载数据后显示走势</div>;
  const serial = (month: string) => Number(compact(month).slice(0, 4)) * 12 + Number(compact(month).slice(4)) - 1;
  const months = Array.from({ length: serial(observed.at(-1)!) - serial(observed[0]) + 1 }, (_, i) => {
    const value = serial(observed[0]) + i;
    return `${Math.floor(value / 12)}${String(value % 12 + 1).padStart(2, '0')}`;
  });
  const values = valid.flatMap(s => s.points.map(p => p.value));
  const low = Math.min(...values), high = Math.max(...values);
  const padding = Math.max((high - low) * 0.15, high * 0.005, 1);
  const min = Math.max(0, low - padding), max = high + padding;
  const x = (month: string) => 60 + months.indexOf(compact(month)) / Math.max(months.length - 1, 1) * 790;
  const y = (value: number) => 260 - (value - min) / (max - min) * 220;
  const labelIndexes = [...new Set([0, Math.floor((months.length - 1) / 3),
    Math.floor((months.length - 1) * 2 / 3), months.length - 1])];
  return <div className="trend-chart">
    <div className="chart-legend">{valid.map((s, i) => <span key={s.name}>
      <i style={{ background: colors[i % colors.length] }} />{s.name}
    </span>)}<span className="chart-unit">{unit}</span></div>
    <svg viewBox="0 0 900 305" role="img" aria-label={`${valid.map(s => s.name).join('、')}价格走势`}>
      {[0, 1, 2, 3, 4].map(i => {
        const value = min + (max - min) * i / 4;
        return <g key={i}><line x1="60" x2="850" y1={y(value)} y2={y(value)} stroke="#e2e8f0" />
          <text x="50" y={y(value) + 4} textAnchor="end">{value.toLocaleString('zh-CN', { maximumFractionDigits: unit === '元/㎡' ? 0 : 1 })}</text></g>;
      })}
      {labelIndexes.map(i => <text key={i} x={x(months[i])} y="290" textAnchor="middle">
        {months[i].replace(/^(\d{4})(\d{2})$/, '$1-$2')}</text>)}
      {valid.map((s, i) => <g key={s.name}>
        <path d={s.points.map((point, j) => `${j && serial(point.month) - serial(s.points[j - 1].month) === 1 ? 'L' : 'M'}${x(point.month)},${y(point.value)}`).join(' ')}
          fill="none" stroke={colors[i % colors.length]} strokeWidth="2.5" />
        {s.points.map(point => <circle key={point.month} cx={x(point.month)} cy={y(point.value)} r={s.points.length > 24 ? 2 : 3}
          fill={colors[i % colors.length]}><title>{s.name} {point.month}: {point.value.toFixed(2)} {unit}</title></circle>)}
      </g>)}
    </svg>
  </div>;
}
