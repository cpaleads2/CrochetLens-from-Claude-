// Мини-клиент Supabase для серверных функций (REST, без библиотек). Работает с service-role ключом —
// только на сервере. Переменные окружения Vercel: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

function conf() {
  const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Server is not configured');
  return { url, key };
}

async function call(method, path, { body, prefer, headers, raw } = {}) {
  const { url, key } = conf();
  const h = Object.assign({ apikey: key, Authorization: 'Bearer ' + key }, headers || {});
  if (body !== undefined && !raw) h['Content-Type'] = 'application/json';
  if (prefer) h['Prefer'] = prefer;
  const r = await fetch(url + path, { method, headers: h, body: raw ? body : (body === undefined ? undefined : JSON.stringify(body)) });
  const text = await r.text();
  if (!r.ok) throw new Error(method + ' ' + path.split('?')[0] + ' → ' + r.status + ' ' + text.slice(0, 200));
  try { return text ? JSON.parse(text) : null; } catch (e) { return text; }
}

const eq = (v) => 'eq.' + encodeURIComponent(v);
const first = (a) => (Array.isArray(a) && a.length ? a[0] : null);

const db = {
  // Кто делает запрос: токен проверяет сам Supabase.
  async userFromToken(token) {
    const { url, key } = conf();
    const r = await fetch(url + '/auth/v1/user', { headers: { apikey: key, Authorization: 'Bearer ' + token } });
    if (!r.ok) return null;
    const u = await r.json();
    return u && u.id ? u : null;
  },

  async getOrder(orderKey) {
    return first(await call('GET', '/rest/v1/orders?select=*&order_key=' + eq(orderKey)));
  },
  // Создаёт заказ или возвращает уже существующий (повторный вебхук не создаёт дубль).
  async insertOrderIfNew(order) {
    await call('POST', '/rest/v1/orders?on_conflict=order_key', { body: order, prefer: 'resolution=ignore-duplicates,return=minimal' });
    return db.getOrder(order.order_key);
  },
  async markOrder(orderKey, patch) {
    await call('PATCH', '/rest/v1/orders?order_key=' + eq(orderKey), { body: patch, prefer: 'return=minimal' });
  },

  async getDraft(id) {
    return first(await call('GET', '/rest/v1/drafts?select=*&id=' + eq(id)));
  },
  async insertDraft(row) {
    return first(await call('POST', '/rest/v1/drafts', { body: row, prefer: 'return=representation' }));
  },

  async getPattern(id) {
    return first(await call('GET', '/rest/v1/patterns?select=*&id=' + eq(id)));
  },
  async getPatternByOrderKey(orderKey) {
    return first(await call('GET', '/rest/v1/patterns?select=*&order_key=' + eq(orderKey)));
  },
  async insertPattern(row) {
    await call('POST', '/rest/v1/patterns?on_conflict=id', { body: row, prefer: 'resolution=ignore-duplicates,return=minimal' });
    return db.getPattern(row.id);
  },

  async updatePattern(id, patch) {
    await call('PATCH', '/rest/v1/patterns?id=' + eq(id), { body: patch, prefer: 'return=minimal' });
  },
  async insertSource(row) {
    await call('POST', '/rest/v1/pattern_sources?on_conflict=pattern_id', { body: row, prefer: 'resolution=ignore-duplicates,return=minimal' });
  },
  async getSource(patternId) {
    return first(await call('GET', '/rest/v1/pattern_sources?select=*&pattern_id=' + eq(patternId)));
  },

  async uploadPdf(path, bytes) {
    const { url, key } = conf();
    const r = await fetch(url + '/storage/v1/object/patterns/' + path.split('/').map(encodeURIComponent).join('/'), {
      method: 'POST',
      headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/pdf', 'x-upsert': 'true' },
      body: bytes
    });
    if (!r.ok) throw new Error('storage upload → ' + r.status + ' ' + (await r.text()).slice(0, 200));
  },

  async insertLicenses(rows) {
    if (!rows.length) return;
    await call('POST', '/rest/v1/licenses?on_conflict=pattern_id,type', { body: rows, prefer: 'resolution=ignore-duplicates,return=minimal' });
  },
  // Уникальный индекс по (order_ref, reason) частичный, поэтому дубль ловим по ошибке 409, а не через on_conflict.
  async addLedger(row) {
    try {
      await call('POST', '/rest/v1/credit_ledger', { body: row, prefer: 'return=minimal' });
    } catch (e) {
      if (!/ 409 /.test(e.message)) throw e;
    }
  },
  async spendCredit(userId, ref) {
    return (await call('POST', '/rest/v1/rpc/spend_credit', { body: { p_user: userId, p_ref: ref } })) === true;
  }
};

module.exports = db;
