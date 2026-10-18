// Создаёт платёж Tranzzo (hosted-страница оплаты) и возвращает адрес, куда отправить покупателя.
// POST, заголовок Authorization: Bearer <токен входа>. Тело: { product, licenses?, draft_id?, pattern_id? }
// Цена считается на сервере. Что именно куплено, кладём в payload платежа — вебхук подписан Tranzzo, ему верим.
// Переменные Vercel: TRANZZO_POS_ID, TRANZZO_API_KEY, TRANZZO_API_SECRET, TRANZZO_ENDPOINTS_KEY,
// необязательные: TRANZZO_BASE (по умолчанию https://cpay.tranzzo.com; для теста https://cpay-stg.tranzzo.com),
// TRANZZO_CURRENCY (по умолчанию USD; в песочнице XTS), SITE_URL (по умолчанию https://www.crochetlens.com).
const crypto = require('crypto');
const db = require('./_db');
const { expectedCents, checkEvent } = require('./_fulfill');

function conf() {
  const c = {
    base: (process.env.TRANZZO_BASE || 'https://cpay.tranzzo.com').replace(/\/$/, ''),
    pos: process.env.TRANZZO_POS_ID, key: process.env.TRANZZO_API_KEY,
    secret: process.env.TRANZZO_API_SECRET, endpoints: process.env.TRANZZO_ENDPOINTS_KEY,
    currency: process.env.TRANZZO_CURRENCY || 'USD',
    site: (process.env.SITE_URL || 'https://www.crochetlens.com').replace(/\/$/, '')
  };
  if (!c.pos || !c.key || !c.secret || !c.endpoints) throw new Error('Payments are not configured');
  return c;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  try {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const user = token ? await db.userFromToken(token) : null;
    if (!user) return res.status(401).json({ error: 'Sign in required' });

    const b = req.body || {};
    const licenses = Array.isArray(b.licenses) ? [...new Set(b.licenses)] : [];
    const ev = { provider: 'tranzzo', orderId: 'x', userId: user.id, product: b.product, licenses, draftId: b.draft_id, patternId: b.pattern_id };
    try { checkEvent(ev); } catch (e) { return res.status(400).json({ error: e.message }); }
    // Проверяем, что черновик / схема принадлежат этому пользователю, до оплаты.
    if (ev.product === 'single') {
      const d = await db.getDraft(ev.draftId);
      if (!d || d.user_id !== user.id) return res.status(404).json({ error: 'Draft not found' });
    }
    if (ev.product === 'license') {
      const p = await db.getPattern(ev.patternId);
      if (!p || p.user_id !== user.id) return res.status(404).json({ error: 'Pattern not found' });
    }

    const c = conf();
    const cents = expectedCents(ev.product, licenses);
    const orderId = 'CL' + Date.now().toString(36) + crypto.randomBytes(5).toString('hex');
    const payload = JSON.stringify({ u: user.id, p: ev.product, l: licenses, d: ev.draftId || null, pt: ev.patternId || null });
    const body = JSON.stringify({
      pos_id: c.pos, mode: 'hosted', method: 'purchase',
      amount: cents / 100, currency: c.currency,
      description: 'CrochetLens: ' + ev.product,
      products: [], order_id: orderId, payload,
      customer_id: user.id, customer_email: user.email || undefined,
      server_url: c.site + '/api/tranzzo-webhook',
      result_url: c.site + '/account.html?paid=1'
    });
    // Подпись тела запроса (HMAC-SHA1): секрет по сети не передаётся.
    const sig = crypto.createHmac('sha1', c.secret).update(body).digest('hex');
    const r = await fetch(c.base + '/api/v1/payment', {
      method: 'POST', redirect: 'manual',
      headers: { 'Content-Type': 'application/json', 'X-API-AUTH': 'CPAY-HMAC ' + c.key + ':' + sig, 'X-API-KEY': c.endpoints },
      body
    });
    const loc = r.headers.get('location');
    if (!loc) {
      console.error('tranzzo create failed', r.status, (await r.text()).slice(0, 300));
      return res.status(502).json({ error: 'Payment provider error' });
    }
    return res.status(200).json({ url: new URL(loc, c.base).toString(), order_id: orderId });
  } catch (e) {
    console.error('tranzzo-create', e.message);
    return res.status(500).json({ error: 'Server error' });
  }
};
