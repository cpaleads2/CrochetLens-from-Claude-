// POST /api/redeem  (Authorization: Bearer <токен>)  Тело: { draft_id }
// Тратит одну схему из купленного пакета и кладёт готовый PDF в «Мои схемы».
// Повторный запрос с тем же draft_id ничего не списывает второй раз.
const db = require('./_db');
const { renderPdf, deliverPattern } = require('./_fulfill');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Not signed in' });

  try {
    const user = await db.userFromToken(token);
    if (!user) return res.status(401).json({ error: 'Invalid session' });

    const draftId = req.body && req.body.draft_id;
    if (!draftId || typeof draftId !== 'string') return res.status(400).json({ error: 'Missing draft_id' });
    const draft = await db.getDraft(draftId);
    if (!draft || draft.user_id !== user.id) return res.status(404).json({ error: 'Draft not found' });

    const orderKey = 'credit:' + draftId;
    const ok = await db.spendCredit(user.id, orderKey);
    if (!ok) return res.status(402).json({ error: 'No pattern credits left' });

    const pattern = await deliverPattern(db, renderPdf, { userId: user.id, draftId, orderKey });
    return res.status(200).json({ ok: true, pattern_id: pattern.id });
  } catch (e) {
    return res.status(500).json({ error: 'Unexpected error' });
  }
};
