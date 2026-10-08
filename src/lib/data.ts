import official from '../data/official-index.json';
import regions from '../data/regions.json';

export interface Region {
  code: string;
  name: string;
  province: string;
  level: string;
}

export interface PriceRecord {
  region: string;
  regionId?: number;
  name: string;
  period: string;
  price: number;
  mom: number | null;
  yoy: number | null;
  fetchedAt: string;
}

export interface PriceResponse {
  ok: boolean;
  configured?: boolean;
  code?: string;
  message?: string;
  hasData?: boolean;
  latestPeriod?: string;
  record?: PriceRecord;
  candidates?: { id: number; name: string; parent: string }[];
}

export interface OfficialRow {
  city: string;
  month: string;
  mom: number;
  yoy: number;
  index: number;
}

export const catalog: Region[] = regions;
export const officialCities = official.cities;
export const officialMonths = Object.keys(official.months).sort();
export const officialSource = official.latestSourceUrl;
export const latestOfficialMonth = officialMonths.at(-1)!;
export const sourceUrl = 'https://www.gotohui.com/open-api/docs';

const accumulated: Record<string, OfficialRow[]> = {};
const previous: Record<string, number> = {};
const monthlyData = official.months as Record<string, number[][]>;
for (const month of officialMonths) {
  accumulated[month] = officialCities.map((city, i) => {
    const [momIndex, yoyIndex] = monthlyData[month][i];
    const index = Number(((previous[city] ?? 100) * momIndex / 100).toFixed(3));
    previous[city] = index;
    return { city, month, mom: Number((momIndex - 100).toFixed(2)),
      yoy: Number((yoyIndex - 100).toFixed(2)), index };
  });
}

export function getOfficialRows(month: string): OfficialRow[] {
  return accumulated[month] ?? [];
}

export function getOfficialHistory(city: string, end: string): { month: string; value: number }[] {
  return [{ month: official.baseMonth, value: 100 }, ...officialMonths.filter(m => m <= end)
    .map(month => ({ month, value: accumulated[month].find(row => row.city === city)!.index }))];
}

export function formatMonth(month: string): string {
  const compact = month.replace('-', '');
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}`;
}

export function formatChange(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

export function readSaved<T>(key: string, fallback: T, valid: (value: unknown) => value is T): T {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
    return valid(value) ? value : fallback;
  } catch { return fallback; }
}

export function saveLocal(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Storage may be disabled. */ }
}

export function downloadCsv(filename: string, rows: (string | number | null)[][]): void {
  const contents = rows.map(row => row.map(value => {
    // Prevent spreadsheet formulas when exporting user-entered region names.
    const text = String(value ?? '');
    const safe = typeof value === 'string' && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  }).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\uFEFF', contents], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url; link.download = filename; link.click();
  URL.revokeObjectURL(url);
}

export async function queryPrice(region: string, period?: string, signal?: AbortSignal): Promise<PriceResponse> {
  const params = new URLSearchParams({ region });
  if (period) params.set('period', period);
  const response = await fetch(`/api/house-price?${params}`, { signal });
  const data = await response.json() as PriceResponse;
  if (typeof data.ok !== 'boolean') throw new Error('价格服务返回格式异常');
  return data;
}
