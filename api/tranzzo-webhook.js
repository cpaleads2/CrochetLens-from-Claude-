// Приём уведомлений Tranzzo. Проверяем подпись, сверяем сумму и выдаём товар (повтор безопасен).
const crypto = require('crypto');
const db = require('./_db');
const F = require('./_fulfill');

function sign(secret, data) {
  return crypto.createHash('sha1').update(secret + data + secret).digest('base64url');
}
// Подпись может прийти с '=' на конце и в обычном или url-варианте base64 — приводим к одному виду.
const norm = (v) => String(v).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function same(a, b) {
  const x = Buffer.from(norm(a)), y = Buffer.from(norm(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function form(req) {
  const b = req.body;
  if (b && typeof b === 'object' && !Buffer.isBuffer(b)) return b;
  return Object.fromEntries(new URLSearchParams(Buffer.isBuffer(b) ? b.toString() : String(b || '')));
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('POST only');
  const secret = process.env.TRANZZO_API_SECRET;
  if (!secret) return res.status(500).send('not configured');
  const f = form(req);
  console.log('tranzzo webhook: received', Object.keys(f).join(','));
  if (!f.data || !f.signature || !same(sign(secret, f.data), f.signature)) {
    console.error('tranzzo webhook: bad signature, got length', String(f.signature || '').length, 'data length', String(f.data || '').length);
    return res.status(400).send('bad signature');
  }
  try {
    const d = JSON.parse(Buffer.from(f.data, 'base64url').toString('utf8'));
    console.log('tranzzo webhook:', d.order_id, d.method, d.status, d.status_code, d.amount, d.currency, 'payload' in d ? 'has-payload' : 'NO-payload');
    const key = 'tranzzo:' + d.order_id;
    if (d.method === 'refund') {
      if (d.status === 'success' && d.order_id && await db.getOrder(key)) await db.markOrder(key, { status: 'refunded' });
      return res.status(200).send('OK');
    }
    if (d.method !== 'purchase' || d.status !== 'success') return res.status(200).send('OK');   // ждём финального успеха

    let p = d.payload;
    if (typeof p === 'string') p = JSON.parse(p);
    const ev = { provider: 'tranzzo', orderId: String(d.order_id), userId: p.u, product: p.p, licenses: p.l || [],
      lang: p.g, draftId: p.d || undefined, patternId: p.pt || undefined,
      amountCents: Math.round(Number(d.amount) * 100), currency: d.currency };
    F.checkEvent(ev);
    const cur = process.env.TRANZZO_CURRENCY || 'USD';
    const want = cur === 'XTS' ? 100 : F.expectedCents(ev.product, ev.licenses);   // песочница: всегда 1 XTS
    if (ev.amountCents !== want || d.currency !== cur) {
      console.error('tranzzo webhook: amount mismatch', d.order_id, ev.amountCents, d.currency, 'want', want, cur);
      return res.status(200).send('OK');   // не выдаём; заказ нужно разобрать вручную
    }
    await F.fulfillOrder(db, F.renderPdf, ev);
    return res.status(200).send('OK');
  } catch (e) {
    console.error('tranzzo webhook', e.message);
    return res.status(500).send('error');   // пусть Tranzzo повторит
  }
};
