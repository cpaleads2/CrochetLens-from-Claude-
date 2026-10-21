// Ограничение частоты запросов к платным/тяжёлым публичным эндпоинтам.
// Использование в начале обработчика:
// Параметр global: true — один общий счётчик на всех посетителей (потолок суточных расходов).
//   if (!(await require('./_guard').allow(req, res, 'analyze', { max: 20, windowSec: 3600 }))) return;
// Лимит считается по хэшу IP в Supabase (таблица rate_hits). Владелец с INTERNAL_KEY лимитом не ограничивается.
// Если база недоступна, запрос пропускаем (сайт важнее лимита), но пишем в лог.
const crypto = require('crypto');

function internalOk(req) {
  const want = process.env.INTERNAL_KEY || '';
  const got = String((req && req.headers && req.headers['x-cl-internal']) || '');
  if (want.length < 8 || got.length !== want.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

function clientIp(req) {
  const h = (req && req.headers) || {};
  const xf = String(h['x-forwarded-for'] || '').split(',')[0].trim();
  return xf || String(h['x-real-ip'] || '') || 'unknown';
}

// true — пропустить; false — ответ 429 уже отправлен.
async function allow(req, res, name, { max, windowSec, global }) {
  try {
    if (req.clMode || internalOk(req)) return true;   // вызов с сервера (после оплаты) или от владельца
    const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return true;
    const salt = process.env.RATE_SALT || key.slice(0, 16);
    const id = global ? 'all' : crypto.createHash('sha256').update(salt + clientIp(req)).digest('hex').slice(0, 32);
    const r = await fetch(url + '/rest/v1/rpc/rl_hit', {
      method: 'POST',
      headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_key: name + ':' + id, p_window_sec: windowSec, p_max: max })
    });
    if (!r.ok) { console.log('rate limit check failed', r.status); return true; }
    const ok = await r.json();
    if (ok === false) {
      res.setHeader && res.setHeader('Retry-After', String(windowSec));
      res.status(429).json({ error: 'Too many requests. Please try again later.' });
      return false;
    }
    return true;
  } catch (e) {
    console.log('rate limit error', e && e.message);
    return true;
  }
}

module.exports = { allow };
