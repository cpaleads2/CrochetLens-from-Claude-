// Прокси к Anthropic API для разбора фото игрушки. Ключ ANTHROPIC_API_KEY хранится только в Vercel.
// Защита: принимаем только нужную модель и разумные размеры запроса, лимитируем частоту по IP и общий суточный потолок.
import guard from './_guard.js';

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 4000;          // клиент просит 200 (проверка фото) и 4000 (разбор)
const MAX_SYSTEM_CHARS = 12000;
const MAX_BLOCKS = 8;             // до 3 фото + текст с запасом

function bad(res, msg) { return res.status(400).json({ error: msg }); }

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY не настроен в Vercel (Settings → Environment Variables)' });
  }

  // Лимиты: с одного IP — 40 запросов в час и 120 в сутки; на весь сайт — суточный потолок (ANALYZE_DAILY_CAP, по умолчанию 1500).
  if (!(await guard.allow(req, res, 'analyze-h', { max: 40, windowSec: 3600 }))) return;
  if (!(await guard.allow(req, res, 'analyze-d', { max: 120, windowSec: 86400 }))) return;
  const cap = parseInt(process.env.ANALYZE_DAILY_CAP || '1500', 10) || 1500;
  if (!(await guard.allow(req, res, 'analyze-all', { max: cap, windowSec: 86400, global: true }))) return;

  // Из тела берём только известные поля и проверяем их; всё остальное отбрасываем.
  const b = req.body || {};
  if (b.model !== MODEL) return bad(res, 'Unsupported model');
  const maxTokens = Math.min(parseInt(b.max_tokens, 10) || 0, MAX_TOKENS);
  if (maxTokens < 1) return bad(res, 'Bad max_tokens');
  if (b.system != null && (typeof b.system !== 'string' || b.system.length > MAX_SYSTEM_CHARS)) return bad(res, 'Bad system prompt');
  if (!Array.isArray(b.messages) || b.messages.length !== 1 || b.messages[0].role !== 'user') return bad(res, 'Bad messages');
  const content = b.messages[0].content;
  if (!Array.isArray(content) || content.length < 1 || content.length > MAX_BLOCKS) return bad(res, 'Bad content');
  let images = 0;
  for (const blk of content) {
    if (blk && blk.type === 'text' && typeof blk.text === 'string' && blk.text.length <= 4000) continue;
    if (blk && blk.type === 'image' && blk.source && blk.source.type === 'base64' && /^image\/(jpeg|png|webp|gif)$/.test(blk.source.media_type) && typeof blk.source.data === 'string') { images++; continue; }
    return bad(res, 'Bad content block');
  }
  if (images > 3) return bad(res, 'Too many images');

  const payload = { model: MODEL, max_tokens: maxTokens, messages: [{ role: 'user', content }] };
  if (b.system) payload.system = b.system;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка при обращении к Anthropic API: ' + err.message });
  }
}
