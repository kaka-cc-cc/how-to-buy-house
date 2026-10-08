const BASE = 'https://www.gotohui.com/api/open/v1/house-price';
const cache = new Map();
const pending = new Map();
let queue = Promise.resolve();
let lastRequest = 0;
const TTL = 24 * 60 * 60 * 1000;

export function normalizePrice(data, region, now = new Date().toISOString()) {
  if (data?.ambiguous) return { ok: true, hasData: false, message: '存在同名地区，请选择具体地区。',
    candidates: (data.candidates ?? []).filter(c => Number.isSafeInteger(c.region_id)).slice(0, 50)
      .map(c => ({ id: c.region_id, name: String(c.region_name), parent: String(c.parent_region ?? '') })) };
  const price = Number(data?.second_hand_price);
  const period = data?.period;
  if (data?.has_data !== true || !Number.isFinite(price) || price <= 0 || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period ?? '')) {
    return { ok: true, hasData: false, message: '该地区或月份暂无二手房均价数据。', latestPeriod: data?.latest_period };
  }
  const number = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
  return { ok: true, hasData: true, record: { region, regionId: data.region_id,
    name: String(data.region_name ?? region), period, price,
    mom: number(data.second_hand_price_mom), yoy: number(data.second_hand_price_yoy), fetchedAt: now } };
}

function upstreamMessage(value) {
  const code = Number(value);
  if (code === 503004) return '今日房价查询额度已用完，请明天再试。';
  if (code === 503003) return '查询频率过高，请稍后再试。';
  if (code === 503001) return '数据源授权无效，请联系网站维护者。';
  return '房价数据源暂时不可用，请稍后再试。';
}

export async function fetchPrice(region, period, { key, fetcher = fetch, throttle = true } = {}) {
  if (!key) return { ok: false, code: 'NOT_CONFIGURED', message: '全国均价数据尚未接入，可先查看70城官方指数。' };
  const params = new URLSearchParams({ region });
  if (period) { params.set('year', period.slice(0, 4)); params.set('month', period.slice(5)); }
  const cacheKey = `${region}:${period ?? 'latest'}`;
  const saved = cache.get(cacheKey);
  if (saved && Date.now() - saved.at < TTL) return saved.result;
  if (pending.has(cacheKey)) return pending.get(cacheKey);
  const request = async () => {
    try {
      if (throttle) {
        const delay = Math.max(0, 1100 - (Date.now() - lastRequest));
        if (delay) await new Promise(resolve => setTimeout(resolve, delay));
        lastRequest = Date.now();
      }
      const response = await fetcher(`${BASE}?${params}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) });
      if (!response.ok) return { ok: false, code: 'UPSTREAM_ERROR', message: '房价数据源暂时不可用，请稍后再试。' };
      const body = await response.json();
      if (Number(body.status) !== 200) {
        if (Number(body.code) === 503005) {
          const result = { ok: true, hasData: false, code: '503005', message: '该地区暂无可访问的二手房均价数据。' };
          if (cache.size >= 1000) cache.delete(cache.keys().next().value);
          cache.set(cacheKey, { at: Date.now(), result });
          return result;
        }
        return { ok: false, code: String(body.code ?? 'UPSTREAM_ERROR'), message: upstreamMessage(body.code) };
      }
      const result = normalizePrice(body.data, region);
      // Keep requested and reported periods separate; never relabel stale data as the requested month.
      if (period && result.record && result.record.period !== period) return { ok: true, hasData: false,
        latestPeriod: result.record.period, message: '数据源未返回所查询月份的数据。' };
      if (cache.size >= 1000) cache.delete(cache.keys().next().value);
      cache.set(cacheKey, { at: Date.now(), result });
      return result;
    } catch { return { ok: false, code: 'UPSTREAM_ERROR', message: '房价数据源连接失败，请稍后再试。' }; }
  };
  const task = queue.then(request, request);
  queue = task.then(() => undefined, () => undefined);
  pending.set(cacheKey, task);
  try { return await task; } finally { pending.delete(cacheKey); }
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') { res.statusCode = 405; res.setHeader('Allow', 'GET'); res.end(JSON.stringify({ ok: false, message: '只支持查询。' })); return; }
  const url = new URL(req.url, 'http://localhost');
  const key = process.env.GOTOHUI_API_KEY;
  if (url.searchParams.get('action') === 'status') {
    res.end(JSON.stringify({ ok: true, configured: Boolean(key) })); return;
  }
  const region = url.searchParams.get('region')?.trim();
  const period = url.searchParams.get('period') || undefined;
  const thisMonth = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit' }).format(new Date());
  if (!region || region.length > 60 || !/^[\p{Script=Han}\d\s·（）()\-]+$/u.test(region) ||
    (period && (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period) || period > thisMonth))) {
    res.statusCode = 400; res.end(JSON.stringify({ ok: false, message: '请输入有效的城市或地区，月份不能晚于当前月份。' })); return;
  }
  const result = await fetchPrice(region, period, { key });
  res.statusCode = result.code === 'NOT_CONFIGURED' ? 503 : result.ok ? 200 : 502;
  res.end(JSON.stringify(result));
}
