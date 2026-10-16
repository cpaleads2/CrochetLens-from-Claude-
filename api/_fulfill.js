// Выдача товара после оплаты. Не зависит от платёжного провайдера: вебхук любого провайдера
// превращает своё событие в { provider, orderId, userId, product, ... } и вызывает fulfillOrder().
// Все операции безопасны при повторе: провайдер может прислать один и тот же вебхук несколько раз.
const crypto = require('crypto');

// Что можно купить. Цены здесь нужны только для сверки; реальные цены задаются в панели провайдера.
const PRODUCTS = {
  single: { priceCents: 699 },    // 1 схема
  pack10: { priceCents: 3499, credits: 10 },
  license: { priceCents: 0 }      // лицензия на уже готовую схему
};
const LICENSE_TYPES = ['commercial', 'resale'];

// Один и тот же заказ всегда даёт один и тот же id схемы — повторная доставка не плодит файлы.
function stableUuid(seed) {
  const b = crypto.createHash('sha256').update(seed).digest().subarray(0, 16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// Строит PDF, вызывая готовые обработчики /api/generate-pdf и /api/generate-mosaic-pdf без HTTP.
function renderPdf(kind, payload) {
  const handler = kind === 'mosaic' ? require('./generate-mosaic-pdf') : require('./generate-pdf');
  return new Promise((resolve, reject) => {
    const chunks = [];
    let code = 200;
    const res = {
      setHeader() {},
      status(c) { code = c; return res; },
      json(o) { reject(new Error('PDF error: ' + (o && o.error || code))); },
      send(buf) { code === 200 ? resolve(Buffer.from(buf)) : reject(new Error('PDF error ' + code)); }
    };
    Promise.resolve(handler({ method: 'POST', body: payload, headers: {} }, res)).catch(reject);
  });
}

// Готовит PDF из черновика и кладёт в «Мои схемы». orderKey делает операцию повторяемой.
async function deliverPattern(db, render, { userId, draftId, orderKey }) {
  let pattern = await db.getPatternByOrderKey(orderKey);
  if (pattern) return pattern;
  const draft = await db.getDraft(draftId);
  if (!draft || draft.user_id !== userId) throw new Error('Draft not found');
  const bytes = await render(draft.kind, draft.payload);
  const id = stableUuid(orderKey);
  const path = userId + '/' + id + '.pdf';
  await db.uploadPdf(path, bytes);
  pattern = await db.insertPattern({ id, user_id: userId, kind: draft.kind, title: draft.title || '', pdf_path: path, order_key: orderKey });
  return pattern;
}

function checkEvent(e) {
  if (!e || !e.provider || !e.orderId || !e.userId) throw new Error('Bad order event');
  if (!PRODUCTS[e.product]) throw new Error('Unknown product: ' + e.product);
  const lic = e.licenses || [];
  if (!lic.every((t) => LICENSE_TYPES.includes(t))) throw new Error('Unknown license type');
  if (e.product === 'pack10' && lic.length) throw new Error('Pack has no licenses');
  if (e.product === 'single' && !e.draftId) throw new Error('Missing draft');
  if (e.product === 'license' && (!e.patternId || !lic.length)) throw new Error('Missing pattern or license');
}

// event: { provider, orderId, userId, product: 'single'|'pack10'|'license', licenses?: [], draftId?, patternId?, amountCents?, currency? }
async function fulfillOrder(db, render, event) {
  checkEvent(event);
  const key = event.provider + ':' + event.orderId;
  const licenses = event.licenses || [];

  const order = await db.insertOrderIfNew({
    order_key: key, provider: event.provider, user_id: event.userId, product: event.product,
    licenses, draft_id: event.draftId || null, pattern_id: event.patternId || null,
    amount_cents: event.amountCents == null ? null : event.amountCents, currency: event.currency || null, status: 'paid'
  });
  if (order && order.status === 'fulfilled') return { ok: true, duplicate: true };

  let patternId = null;
  if (event.product === 'pack10') {
    await db.addLedger({ user_id: event.userId, delta: PRODUCTS.pack10.credits, reason: 'pack_purchase', order_ref: key });
  } else {
    let pattern;
    if (event.product === 'single') {
      pattern = await deliverPattern(db, render, { userId: event.userId, draftId: event.draftId, orderKey: key });
    } else {
      pattern = await db.getPattern(event.patternId);
      if (!pattern || pattern.user_id !== event.userId) throw new Error('Pattern not found');
    }
    patternId = pattern.id;
    await db.insertLicenses(licenses.map((type) => ({ user_id: event.userId, pattern_id: patternId, type, order_ref: key })));
  }

  await db.markOrder(key, { status: 'fulfilled', fulfilled_at: new Date().toISOString(), pattern_id: patternId });
  return { ok: true, patternId };
}

module.exports = { PRODUCTS, LICENSE_TYPES, stableUuid, renderPdf, deliverPattern, fulfillOrder };
