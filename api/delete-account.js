// POST /api/delete-account  (заголовок Authorization: Bearer <access_token пользователя>)
// Удаляет файлы схем из хранилища и сам аккаунт (строки в таблицах удаляются каскадом).
// Нужны переменные окружения Vercel: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (секретный ключ, только на сервере).
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const URL_ = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL_ || !KEY) return res.status(500).json({ error: 'Server is not configured' });

  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Not signed in' });

  try {
    // 1. Кто это? Токен проверяет сам Supabase.
    const who = await fetch(URL_ + '/auth/v1/user', { headers: { apikey: KEY, Authorization: 'Bearer ' + token } });
    if (!who.ok) return res.status(401).json({ error: 'Invalid session' });
    const user = await who.json();
    const uid = user && user.id;
    if (!uid) return res.status(401).json({ error: 'Invalid session' });

    const svc = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };

    // 2. Удалить все PDF пользователя (папка <uid>/), порциями.
    for (let guard = 0; guard < 50; guard++) {
      const list = await fetch(URL_ + '/storage/v1/object/list/patterns', {
        method: 'POST', headers: svc, body: JSON.stringify({ prefix: uid + '/', limit: 100, offset: 0 })
      });
      if (!list.ok) break;
      const items = await list.json();
      if (!Array.isArray(items) || items.length === 0) break;
      const del = await fetch(URL_ + '/storage/v1/object/patterns', {
        method: 'DELETE', headers: svc, body: JSON.stringify({ prefixes: items.map(i => uid + '/' + i.name) })
      });
      if (!del.ok) break;
    }

    // 3. Удалить аккаунт (таблицы patterns/credit_ledger/licenses чистятся каскадом).
    const rm = await fetch(URL_ + '/auth/v1/admin/users/' + uid, { method: 'DELETE', headers: svc });
    if (!rm.ok) return res.status(502).json({ error: 'Could not delete account' });

    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'Unexpected error' });
  }
};
