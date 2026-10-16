// POST /api/draft  (Authorization: Bearer <токен пользователя>)
// Тело: { kind: 'amigurumi' | 'mosaic', title?: string, payload: <те же параметры, что получает /api/generate-pdf или /api/generate-mosaic-pdf> }
// Сохраняет «черновик покупки» и возвращает { draft_id }. PDF строится позже — после оплаты.
const db = require('./_db');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Not signed in' });

  try {
    const user = await db.userFromToken(token);
    if (!user) return res.status(401).json({ error: 'Invalid session' });

    const { kind, title = '', payload } = req.body || {};
    if (kind !== 'amigurumi' && kind !== 'mosaic') return res.status(400).json({ error: 'Bad kind' });
    if (!payload || typeof payload !== 'object') return res.status(400).json({ error: 'Bad payload' });

    const row = await db.insertDraft({ user_id: user.id, kind, title: String(title).slice(0, 200), payload });
    return res.status(200).json({ draft_id: row.id });
  } catch (e) {
    return res.status(500).json({ error: 'Unexpected error' });
  }
};
