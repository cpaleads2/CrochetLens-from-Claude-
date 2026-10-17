// Режимы выдачи PDF и брендинг.
//   free   — ознакомительный: открыт один первый элемент, на каждой странице логотип
//   paid   — оплаченная схема и коммерческая лицензия: всё открыто, логотип + адрес сайта + водяной знак
//   resale — лицензия на перепродажу: всё открыто, БЕЗ логотипа, адреса сайта и водяных знаков
//   etsy   — заказ с Etsy: всё открыто, логотип и название, но БЕЗ адреса сайта, водяного знака и призывов
//            покупать на сайте (правила Etsy запрещают уводить покупателей на другую площадку)
// Режим выбирает только сервер (req.clMode ставит _fulfill.js). Запрос из браузера его задать не может.
const fs = require('fs');
const path = require('path');
const { rgb, degrees } = require('pdf-lib');

const SITE = 'crochetlens.com';
const crypto = require('crypto');
const MODES = ['free', 'paid', 'resale', 'etsy'];

// Внутренний ключ: владелец (внутренние страницы internal.html / mosaic-internal.html) может выбрать любой режим.
// Ключ — переменная INTERNAL_KEY в Vercel. Без неё или с неверным ключом выбрать режим из браузера нельзя.
function internalOk(req) {
  const want = process.env.INTERNAL_KEY || '';
  const got = String((req && req.headers && req.headers['x-cl-internal']) || '');
  if (want.length < 8 || got.length !== want.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

// Если оплата ещё не включена (PAYWALL не 'on'), публичный адрес работает как раньше — выдаёт полный PDF.
// Когда включим оплату: в Vercel → Environment Variables → PAYWALL = on.
function modeFrom(req) {
  const m = req && req.clMode;
  if (MODES.includes(m)) return m;
  const asked = req && req.body && req.body.mode;
  if (MODES.includes(asked) && internalOk(req)) return asked;
  return process.env.PAYWALL === 'on' ? 'free' : 'paid';
}

function flags(mode) {
  return {
    locked: mode === 'free',          // закрыть всё, кроме первого элемента
    logo: mode !== 'resale',
    site: mode === 'paid',          // у etsy адреса сайта и водяного знака нет
    watermark: mode === 'paid',
    brandText: mode !== 'resale',
    personalOnlyNote: mode !== 'resale'
  };
}

const TXT = {
  ru: { sample: 'ОЗНАКОМИТЕЛЬНАЯ ВЕРСИЯ — открыт только первый элемент', locked: 'Подробная схема этой детали доступна в полной версии на crochetlens.com', lockedShort: 'Остальные листы и построчная запись — в полной версии на crochetlens.com' },
  en: { sample: 'PREVIEW VERSION — only the first element is unlocked', locked: 'The full pattern for this part is available in the full version at crochetlens.com', lockedShort: 'The remaining sheets and the row-by-row text are in the full version at crochetlens.com' },
  uk: { sample: 'ОЗНАЙОМЧА ВЕРСІЯ — відкрито лише перший елемент', locked: 'Детальна схема цієї деталі доступна в повній версії на crochetlens.com', lockedShort: 'Решта аркушів і порядковий запис — у повній версії на crochetlens.com' }
};
const t = (lang) => TXT[lang] || TXT.ru;

let logoBytes = null;
function loadLogo() {
  if (!logoBytes) logoBytes = fs.readFileSync(path.join(process.cwd(), 'api/brand/logo.png'));
  return logoBytes;
}

// Накладывает брендинг на готовый документ (вызывать перед save()).
async function applyBranding(pdfDoc, mode, { font }) {
  const F = flags(mode);
  const pages = pdfDoc.getPages();
  if (!F.logo && !F.site && !F.watermark) return;
  const logo = F.logo ? await pdfDoc.embedPng(loadLogo()) : null;
  const INK2 = rgb(0x8C / 255, 0x75 / 255, 0x61 / 255);
  const MUTE = rgb(0.55, 0.45, 0.36);

  for (const pg of pages) {
    const { width, height } = pg.getSize();
    if (F.watermark) {
      const size = 58, text = SITE;
      const w = font.widthOfTextAtSize(text, size);
      const a = Math.PI / 4;
      pg.drawText(text, {
        x: width / 2 - (w / 2) * Math.cos(a) + size * 0.3 * Math.sin(a),
        y: height / 2 - (w / 2) * Math.sin(a) - size * 0.3 * Math.cos(a),
        size, font, color: MUTE, opacity: 0.07, rotate: degrees(45)
      });
    }
    if (logo) {
      const lw = 86, lh = lw * logo.height / logo.width;
      pg.drawImage(logo, { x: width - 50 - lw, y: height - 26 - lh, width: lw, height: lh });
    }
    if (F.site) {
      const w = font.widthOfTextAtSize(SITE, 7.5);
      pg.drawText(SITE, { x: (width - w) / 2, y: 26, size: 7.5, font, color: INK2 });
    }
  }
}

function setMeta(pdfDoc, mode, title) {
  try {
    if (mode === 'resale') { pdfDoc.setProducer(''); pdfDoc.setCreator(''); pdfDoc.setAuthor(''); }
    else { pdfDoc.setProducer('CrochetLens'); pdfDoc.setCreator('CrochetLens'); pdfDoc.setAuthor('CrochetLens'); }
    if (title) pdfDoc.setTitle(String(title).slice(0, 120));
  } catch (e) { /* метаданные не критичны */ }
}

module.exports = { modeFrom, flags, t, applyBranding, setMeta, SITE };
