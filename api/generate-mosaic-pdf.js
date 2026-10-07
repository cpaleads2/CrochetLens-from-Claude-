const { PDFDocument, rgb } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const fs = require('fs');
const path = require('path');

const PAGE_W = 612, PAGE_H = 792;
const MARGIN = 50;
const CONTENT_W = PAGE_W - MARGIN * 2;

const INK = rgb(0x3A / 255, 0x26 / 255, 0x18 / 255);
const INK2 = rgb(0x8C / 255, 0x75 / 255, 0x61 / 255);
const ACCENT = rgb(0xB9 / 255, 0x70 / 255, 0x2F / 255);
const ACCENT_DEEP = rgb(0x8F / 255, 0x4E / 255, 0x1E / 255);
const LINE = rgb(0xEA / 255, 0xD9 / 255, 0xC0 / 255);
const CARD_BG = rgb(0xFD / 255, 0xF8 / 255, 0xF1 / 255);
const WHITE = rgb(1, 1, 1);
const WARN_BG = rgb(0xFA / 255, 0xEE / 255, 0xDA / 255);
const WARN_TEXT = rgb(0x85 / 255, 0x4F / 255, 0x0B / 255);
const GRID_THIN = rgb(0.74, 0.74, 0.74);

function wrapText(text, font, size, maxWidth) {
  const words = String(text).split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function hexToRgb(hex) {
  const h = String(hex).replace('#', '');
  return rgb(parseInt(h.substr(0, 2), 16) / 255, parseInt(h.substr(2, 2), 16) / 255, parseInt(h.substr(4, 2), 16) / 255);
}

function fmt(n) { return Number(n).toLocaleString('ru-RU'); }
function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      title = '', widthCm = 30, heightCm = 30, stg = 18, rowg = 20,
      gridW = 0, gridH = 0, cells: cellsStr = '', palette = [], paletteNames = [],
      itemType = 'custom', photoBase64 = null, photoMediaType = ''
    } = req.body;

    if (!(gridW > 0 && gridH > 0) || typeof cellsStr !== 'string' || cellsStr.length !== gridW * gridH || !palette.length) {
      return res.status(400).json({ error: 'Некорректные данные схемы — соберите схему заново.' });
    }

    // cells: строка из символов base36, по одному на клетку, построчно сверху вниз, слева направо
    const cells = new Uint8Array(gridW * gridH);
    for (let i = 0; i < cells.length; i++) {
      const v = parseInt(cellsStr[i], 36);
      cells[i] = (v >= 0 && v < palette.length) ? v : 0;
    }
    const rgbs = palette.map(hexToRgb);

    // ----- Статистика по схеме (считаем здесь, по самим клеткам) -----
    const counts = new Array(palette.length).fill(0);
    for (let i = 0; i < cells.length; i++) counts[cells[i]]++;
    const total = gridW * gridH;
    const stW = plural(gridW, 'столбик', 'столбика', 'столбиков');
    const rowsW = plural(gridH, 'ряд', 'ряда', 'рядов');
    const chainN = gridW + 1;
    const chainNom = plural(chainN, 'воздушная петля', 'воздушные петли', 'воздушных петель');
    const chainGen = (chainN % 10 === 1 && chainN % 100 !== 11) ? 'воздушной петли' : 'воздушных петель';
    let colorChanges = 0;
    for (let y = 0; y < gridH; y++) {
      for (let x = 1; x < gridW; x++) {
        if (cells[y * gridW + x] !== cells[y * gridW + x - 1]) colorChanges++;
      }
    }
    // фон = самый частый цвет по периметру
    const borderCounts = new Array(palette.length).fill(0);
    for (let x = 0; x < gridW; x++) { borderCounts[cells[x]]++; borderCounts[cells[(gridH - 1) * gridW + x]]++; }
    for (let y = 0; y < gridH; y++) { borderCounts[cells[y * gridW]]++; borderCounts[cells[y * gridW + gridW - 1]]++; }
    let bgIdx = 0;
    for (let i = 1; i < borderCounts.length; i++) if (borderCounts[i] > borderCounts[bgIdx]) bgIdx = i;

    const hoursBase = total / 450 + colorChanges * 20 / 3600;
    const hLow = Math.max(1, Math.round(hoursBase * 0.8));
    const hHigh = Math.max(hLow + 1, Math.round(hoursBase * 1.6));

    // ----- Документ и шрифты -----
    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);
    const font = await pdfDoc.embedFont(fs.readFileSync(path.join(process.cwd(), 'api/fonts/DejaVuSans.ttf')), { subset: true });
    const fontBold = await pdfDoc.embedFont(fs.readFileSync(path.join(process.cwd(), 'api/fonts/DejaVuSans-Bold.ttf')), { subset: true });

    let embeddedPhoto = null;
    if (photoBase64) {
      try {
        const bytes = Buffer.from(photoBase64, 'base64');
        embeddedPhoto = (photoMediaType || '').includes('png') ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
      } catch (e) { embeddedPhoto = null; }
    }

    let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    let y = PAGE_H - MARGIN;
    const FOOTER_SPACE = 30;

    function newPage() { page = pdfDoc.addPage([PAGE_W, PAGE_H]); y = PAGE_H - MARGIN; }
    function ensureSpace(h) { if (y - h < MARGIN + FOOTER_SPACE) newPage(); }
    function drawLine(text, { size = 10, useFont = font, color = INK, x = MARGIN, gap = 4 } = {}) {
      ensureSpace(size + gap);
      page.drawText(text, { x, y: y - size, size, font: useFont, color });
      y -= size + gap;
    }
    function drawWrapped(text, { size = 9.5, useFont = font, color = INK, x = MARGIN, maxWidth = CONTENT_W, gap = 3, lineGap = 13.5 } = {}) {
      const lines = wrapText(text, useFont, size, maxWidth);
      for (const line of lines) {
        ensureSpace(lineGap);
        page.drawText(line, { x, y: y - size, size, font: useFont, color });
        y -= lineGap;
      }
      y -= gap;
    }
    function section(text) { ensureSpace(34); y -= 4; drawLine(text, { size: 15, useFont: fontBold, gap: 8 }); }
    function callout(text, { bg = WARN_BG, fg = WARN_TEXT, bar = ACCENT_DEEP } = {}) {
      const lines = wrapText(text, font, 9, CONTENT_W - 30);
      const h = lines.length * 13 + 16;
      ensureSpace(h + 12);
      page.drawRectangle({ x: MARGIN, y: y - h, width: CONTENT_W, height: h, color: bg });
      page.drawRectangle({ x: MARGIN, y: y - h, width: 4, height: h, color: bar });
      let dy = y - 14;
      for (const l of lines) { page.drawText(l, { x: MARGIN + 16, y: dy - 9, size: 9, font, color: fg }); dy -= 13; }
      y -= h + 12;
    }
    function numbered(n, text) {
      const lines = wrapText(text, font, 9.5, CONTENT_W - 28);
      ensureSpace(lines.length * 13.5 + 10);
      page.drawCircle({ x: MARGIN + 8, y: y - 8, size: 9, color: ACCENT_DEEP });
      const label = String(n);
      page.drawText(label, { x: MARGIN + 8 - fontBold.widthOfTextAtSize(label, 8.5) / 2, y: y - 11, size: 8.5, font: fontBold, color: WHITE });
      let ly = y;
      for (const l of lines) { page.drawText(l, { x: MARGIN + 24, y: ly - 9.5, size: 9.5, font, color: INK }); ly -= 13.5; }
      y = ly - 6;
    }
    function kv(label, value, { hl = false } = {}) {
      ensureSpace(20);
      page.drawText(label, { x: MARGIN, y: y - 10, size: 9.5, font, color: INK2 });
      const vLines = wrapText(value, hl ? fontBold : font, 10, CONTENT_W - 220);
      let vy = y;
      for (const l of vLines) { page.drawText(l, { x: MARGIN + 215, y: vy - 10, size: 10, font: hl ? fontBold : font, color: INK }); vy -= 13.5; }
      y = Math.min(y - 17, vy - 3);
      page.drawLine({ start: { x: MARGIN, y: y + 4 }, end: { x: PAGE_W - MARGIN, y: y + 4 }, thickness: 0.4, color: LINE });
    }

    // ================= 1. ТИТУЛ =================
    drawLine('CROCHETLENS', { size: 10, useFont: fontBold, color: ACCENT, gap: 8 });
    drawLine(title || 'Схема мозаичного вязания', { size: 22, useFont: fontBold, color: INK, gap: 14 });

    if (embeddedPhoto) {
      const maxW = 170, maxH = 200;
      const scale = Math.min(maxW / embeddedPhoto.width, maxH / embeddedPhoto.height, 1);
      const w = embeddedPhoto.width * scale, h = embeddedPhoto.height * scale;
      const px = MARGIN + (CONTENT_W - w) / 2;
      page.drawRectangle({ x: px - 6, y: y - h - 6, width: w + 12, height: h + 12, color: CARD_BG, borderColor: LINE, borderWidth: 1 });
      page.drawImage(embeddedPhoto, { x: px, y: y - h, width: w, height: h });
      y -= h + 24;
    }
    {
      const cardH = 54, gap = 12, cardW = (CONTENT_W - gap * 3) / 4;
      const cards = [
        { label: 'Размер', value: `${widthCm}×${heightCm} см` },
        { label: 'Плотность (п/р на 10 см)', value: `${stg}/${rowg}` },
        { label: 'Цветов пряжи', value: String(palette.length) },
        { label: 'Столбиков всего', value: fmt(total) }
      ];
      cards.forEach((c, i) => {
        const cx0 = MARGIN + i * (cardW + gap);
        page.drawRectangle({ x: cx0, y: y - cardH, width: cardW, height: cardH, color: CARD_BG, borderColor: LINE, borderWidth: 1 });
        page.drawText(c.label, { x: cx0 + 10, y: y - 20, size: 7, font, color: INK2 });
        page.drawText(c.value, { x: cx0 + 10, y: y - 38, size: 12, font: fontBold, color: INK });
      });
      y -= cardH + 20;
    }
    callout('Это схема, собранная автоматически по фото. Перед вязанием обязательно свяжите контрольный образец 10×10 см и сверьте свою плотность с указанной — размер сетки рассчитан именно под неё. Цвета на экране и в печати приблизительны.');

    // ================= 2. СВОДКА ПРОЕКТА =================
    newPage();
    section('Сводка проекта');
    kv('Начальная цепочка', `${chainN} ${chainNom}`, { hl: true });
    kv('Столбиков в ряду', String(gridW));
    kv('Рядов в схеме', String(gridH));
    kv('Всего столбиков', fmt(total));
    kv('Смен цвета внутри рядов', fmt(colorChanges));
    kv('Фон (цвет № ' + (bgIdx + 1) + ')', `${paletteNames[bgIdx] || ''} — вяжется так же, как остальные клетки`);
    kv('Ориентировочное время', `≈ ${hLow}–${hHigh} ч чистой работы`);
    y -= 6;
    if (total > 10000 || palette.length > 10) {
      callout('Это крупный и трудоёмкий проект. Оценка времени очень приблизительна и зависит от опыта и пряжи; новичкам для первого изделия лучше выбрать размер поменьше и 4–8 цветов.');
    }
    section('Какую технику выбрать');
    const n = palette.length;
    if (n <= 3) {
      drawWrapped('Цветов мало: неработающую нить удобно протягивать по изнанке на 2–4 клетки. На больших участках одного цвета нить лучше оборвать или взять отдельный клубок.');
    } else if (n <= 8) {
      drawWrapped('Цветов умеренно много: протягивайте нить по изнанке только на короткие участки (до 4–5 клеток). Для крупных цветовых пятен берите отдельный клубок или бобину на каждую область и не тяните нить через длинные участки — иначе полотно стянется.');
    } else {
      drawWrapped('Цветов много: протягивать все нити нельзя. Вяжите техникой интарсии — отдельный клубок или бобина на каждую цветовую область; на стыке цветов нити скрещивайте, чтобы не появлялись дыры. Это медленно и требует опыта.');
    }
    section('Проверьте образец');
    drawWrapped(`Свяжите образец столбиками без накида: на 10 см у вас должно получиться ${stg} ${plural(Math.round(stg), 'петля', 'петли', 'петель')} и ${rowg} ${plural(Math.round(rowg), 'ряд', 'ряда', 'рядов')}. Если петель на 10 см у вас больше или меньше, изделие выйдет меньше или больше: ширина изделия ≈ ${gridW} ÷ (ваши петли на 10 см) × 10 см, высота ≈ ${gridH} ÷ (ваши ряды на 10 см) × 10 см.`);

    // ================= 3. ЦВЕТА ПРЯЖИ =================
    newPage();
    section('Цвета пряжи');
    drawWrapped('Названия и коды цветов — ориентир: реальная пряжа отличается, подбирайте цвет по образцам в магазине. Порядок — по убыванию числа столбиков.', { size: 9, color: INK2, gap: 10 });
    {
      const sw = 20, rowH = 28;
      ensureSpace(24);
      const hx = [MARGIN, MARGIN + 34, MARGIN + 250, MARGIN + 335, MARGIN + 415];
      page.drawText('№  Цвет', { x: hx[1], y: y - 9, size: 8, font: fontBold, color: INK2 });
      page.drawText('Код', { x: hx[2], y: y - 9, size: 8, font: fontBold, color: INK2 });
      page.drawText('Столбиков', { x: hx[3], y: y - 9, size: 8, font: fontBold, color: INK2 });
      page.drawText('Доля', { x: hx[4], y: y - 9, size: 8, font: fontBold, color: INK2 });
      y -= 18;
      palette.forEach((hex, i) => {
        ensureSpace(rowH + 2);
        page.drawRectangle({ x: MARGIN, y: y - sw - 2, width: sw, height: sw, color: rgbs[i], borderColor: INK2, borderWidth: 0.6 });
        const nm = `${i + 1}. ${paletteNames[i] || ''}${i === bgIdx ? ' (фон)' : ''}`;
        page.drawText(nm, { x: hx[1], y: y - 14, size: 9.5, font: fontBold, color: INK });
        page.drawText(hex, { x: hx[2], y: y - 14, size: 9, font, color: INK2 });
        page.drawText(fmt(counts[i]), { x: hx[3], y: y - 14, size: 9.5, font, color: INK });
        page.drawText((counts[i] * 100 / total).toFixed(1).replace('.', ',') + ' %', { x: hx[4], y: y - 14, size: 9, font, color: INK2 });
        y -= rowH;
      });
    }
    y -= 6;
    section('Сколько пряжи купить');
    const sampleSt = Math.round(stg * rowg);
    const exGrams = Math.round(1000 * 5 / sampleSt * 1.15);
    drawWrapped(`Свяжите образец 10×10 см той же пряжей и крючком, что и изделие (${stg} ${plural(Math.round(stg), 'петля', 'петли', 'петель')} × ${rowg} ${plural(Math.round(rowg), 'ряд', 'ряда', 'рядов')} = ${sampleSt} ${plural(sampleSt, 'столбик', 'столбика', 'столбиков')}) и взвесьте его. Тогда для каждого цвета:`, { gap: 4 });
    drawWrapped(`граммы цвета = столбики цвета × вес образца ÷ ${sampleSt} × 1,15`, { useFont: fontBold, gap: 4 });
    drawWrapped(`(1,15 — запас 15% на пробные ряды, концы и перерасход при смене цвета). Пример: образец весит 5 г, цвет из 1 000 столбиков → 1 000 × 5 ÷ ${sampleSt} × 1,15 ≈ ${exGrams} г. Если пряжа одного цвета продаётся только целыми мотками — округляйте вверх; при интарсии берите запас больше.`, { gap: 6 });

    // ================= 4. КАК ВЯЗАТЬ =================
    newPage();
    section('Как вязать по схеме');
    numbered(1, `Свяжите цепочку из ${chainN} ${chainGen}.`);
    numbered(2, `Ряд 1 (самый нижний ряд схемы): 1 столбик без накида во 2-ю петлю от крючка и по 1 столбику в каждую петлю цепочки — всего ${gridW} ${stW}.`);
    numbered(3, `Каждый следующий ряд: 1 воздушная петля подъёма (она не считается столбиком), поворот работы, ${gridW} ${stW}. Считайте петли в конце ряда — их всегда должно быть ${gridW}.`);
    numbered(4, `Направление чтения (для правшей). Колонки на схеме пронумерованы справа налево, ряды — снизу вверх. Нечётные ряды (1, 3, 5…) читайте справа налево — от колонки 1 к колонке ${gridW}. Чётные ряды (2, 4, 6…) читайте слева направо — от колонки ${gridW} к колонке 1. Левши вяжут в зеркальном направлении: нечётные ряды слева направо, чётные — справа налево.`);
    numbered(5, 'Смена цвета: новую нить вводите на последнем протягивании петли последнего столбика прежнего цвета — тогда граница чистая. Не затягивайте переносимую нить, иначе полотно стянется.');
    numbered(6, 'Жирная линия на схеме проходит после каждых 10 клеток (от правого края — по колонкам, от нижнего — по рядам), цифры подписаны через 5. Это помогает не сбиться: сверяйтесь с ними в конце каждого ряда и держите рядом линейку или закладку.');
    numbered(7, 'Если схема разбита на листы, ряд читается через несколько листов: нумерация колонок и рядов сквозная. Сначала вяжите колонки с листа, где они начинаются (правый), затем продолжайте на соседнем листе слева; на обратном ряду — наоборот.');
    numbered(8, 'Спрячьте все концы нитей иглой с изнаночной стороны. Для ровного полотна после вязания можно выполнить влажную обработку и просушить его в расправленном виде.');

    // ================= 5. ЛИСТЫ СХЕМЫ =================
    const CELL_TARGET_MIN = 7;
    const GUT = 24;                       // поле под цифры слева/справа
    const availW = CONTENT_W - GUT * 2;
    const maxCols = Math.floor(availW / CELL_TARGET_MIN);
    const nTilesC = Math.ceil(gridW / maxCols);
    const colsPerTile = Math.ceil(gridW / nTilesC);
    const cellPt = Math.min(11, availW / colsPerTile);
    const TOP_BLOCK = 64;                 // заголовок листа + цифры колонок сверху
    const BOTTOM_BLOCK = 16;
    const availH = PAGE_H - MARGIN * 2 - FOOTER_SPACE - TOP_BLOCK - BOTTOM_BLOCK;
    const maxRows = Math.floor(availH / cellPt);
    const nTilesR = Math.ceil(gridH / maxRows);
    const rowsPerTile = Math.ceil(gridH / nTilesR);
    const totalSheets = nTilesC * nTilesR;

    const sheets = [];
    for (let b = 0; b < nTilesR; b++) {
      for (let t = 0; t < nTilesC; t++) {
        const r0 = b * rowsPerTile + 1, r1 = Math.min((b + 1) * rowsPerTile, gridH);
        const c0 = t * colsPerTile + 1, c1 = Math.min((t + 1) * colsPerTile, gridW);
        sheets.push({ r0, r1, c0, c1, xStart: gridW - c1, xEnd: gridW - c0 + 1, yStart: gridH - r1, yEnd: gridH - r0 + 1 });
      }
    }

    function drawCells(pg, x0, x1, y0, y1, originX, topY, cell, overlap) {
      for (let yy = y0; yy < y1; yy++) {
        let xx = x0;
        while (xx < x1) {
          const ci = cells[yy * gridW + xx];
          let xe = xx + 1;
          while (xe < x1 && cells[yy * gridW + xe] === ci) xe++;
          pg.drawRectangle({
            x: originX + (xx - x0) * cell,
            y: topY - (yy - y0 + 1) * cell - overlap,
            width: (xe - xx) * cell + overlap,
            height: cell + overlap,
            color: rgbs[ci]
          });
          xx = xe;
        }
      }
    }

    // --- обзорная карта, если листов больше одного ---
    if (totalSheets > 1) {
      newPage();
      section('Карта листов');
      drawWrapped(`Схема разбита на ${totalSheets} ${plural(totalSheets, 'лист', 'листа', 'листов')} (${nTilesC} по ширине × ${nTilesR} по высоте). Вяжите снизу вверх: сначала нижний ряд листов (справа налево), затем следующий.`, { size: 9, color: INK2, gap: 10 });
      const mapAvailW = CONTENT_W, mapAvailH = y - MARGIN - FOOTER_SPACE - 10;
      const cellOv = Math.min(mapAvailW / gridW, mapAvailH / gridH);
      const mw = gridW * cellOv, mh = gridH * cellOv;
      const ox = MARGIN + (CONTENT_W - mw) / 2, oy = y;
      drawCells(page, 0, gridW, 0, gridH, ox, oy, cellOv, 0.2);
      page.drawRectangle({ x: ox, y: oy - mh, width: mw, height: mh, borderColor: INK, borderWidth: 1 });
      sheets.forEach((s, i) => {
        const sx = ox + s.xStart * cellOv, sw2 = (s.xEnd - s.xStart) * cellOv;
        const sy = oy - s.yEnd * cellOv, sh2 = (s.yEnd - s.yStart) * cellOv;
        page.drawRectangle({ x: sx, y: sy, width: sw2, height: sh2, borderColor: ACCENT_DEEP, borderWidth: 1.4 });
        const cx = sx + sw2 / 2, cy = sy + sh2 / 2;
        page.drawCircle({ x: cx, y: cy, size: 11, color: WHITE, borderColor: ACCENT_DEEP, borderWidth: 1 });
        const lab = String(i + 1);
        page.drawText(lab, { x: cx - fontBold.widthOfTextAtSize(lab, 10) / 2, y: cy - 3.6, size: 10, font: fontBold, color: ACCENT_DEEP });
      });
    }

    // --- сами листы ---
    sheets.forEach((s, idx) => {
      newPage();
      const ncols = s.c1 - s.c0 + 1, nrows = s.r1 - s.r0 + 1;
      drawLine(`Лист ${idx + 1} из ${totalSheets}`, { size: 13, useFont: fontBold, gap: 3 });
      drawLine(`Ряды ${s.r0}–${s.r1} (снизу вверх)  ·  Колонки ${s.c0}–${s.c1} (справа налево)`, { size: 9, color: INK2, gap: 4 });
      const chartW = ncols * cellPt, chartH = nrows * cellPt;
      const originX = MARGIN + GUT + (availW - chartW) / 2;
      const topY = y - 20;

      drawCells(page, s.xStart, s.xEnd, s.yStart, s.yEnd, originX, topY, cellPt, 0.25);

      // тонкая сетка по каждой клетке
      for (let vx = 0; vx <= ncols; vx++) {
        page.drawLine({ start: { x: originX + vx * cellPt, y: topY }, end: { x: originX + vx * cellPt, y: topY - chartH }, thickness: 0.25, color: GRID_THIN });
      }
      for (let vy = 0; vy <= nrows; vy++) {
        page.drawLine({ start: { x: originX, y: topY - vy * cellPt }, end: { x: originX + chartW, y: topY - vy * cellPt }, thickness: 0.25, color: GRID_THIN });
      }
      // жирные линии после каждых 10 клеток (колонки — от правого края, ряды — от нижнего)
      for (let c = s.c0; c <= s.c1; c++) {
        if (c % 10 === 0) {
          const vx = (gridW - c) - s.xStart;        // левая граница колонки c
          page.drawLine({ start: { x: originX + vx * cellPt, y: topY }, end: { x: originX + vx * cellPt, y: topY - chartH }, thickness: 1.0, color: INK });
        }
      }
      for (let r = s.r0; r <= s.r1; r++) {
        if (r % 10 === 0) {
          const vy = (gridH - r) - s.yStart;        // верхняя граница ряда r
          page.drawLine({ start: { x: originX, y: topY - vy * cellPt }, end: { x: originX + chartW, y: topY - vy * cellPt }, thickness: 1.0, color: INK });
        }
      }
      page.drawRectangle({ x: originX, y: topY - chartH, width: chartW, height: chartH, borderColor: INK, borderWidth: 1 });

      // цифры колонок сверху и снизу (через 5), рядов слева и справа (через 5)
      const numSize = 6.5;
      for (let c = s.c0; c <= s.c1; c++) {
        if (c % 5 === 0 || c === 1) {
          const vx = (gridW - c) - s.xStart;
          const label = String(c);
          const cx = originX + (vx + 0.5) * cellPt - font.widthOfTextAtSize(label, numSize) / 2;
          page.drawText(label, { x: cx, y: topY + 3, size: numSize, font, color: INK });
          page.drawText(label, { x: cx, y: topY - chartH - 9, size: numSize, font, color: INK });
        }
      }
      for (let r = s.r0; r <= s.r1; r++) {
        if (r % 5 === 0 || r === 1) {
          const vy = (gridH - r) - s.yStart;
          const label = String(r);
          const cy = topY - (vy + 0.5) * cellPt - 2.3;
          page.drawText(label, { x: originX - 4 - font.widthOfTextAtSize(label, numSize), y: cy, size: numSize, font, color: INK });
          page.drawText(label, { x: originX + chartW + 4, y: cy, size: numSize, font, color: INK });
        }
      }
    });

    // ================= 6. ЗАВЕРШЕНИЕ =================
    newPage();
    section('Завершение изделия');
    const bgName = paletteNames[bgIdx] || `цвет №${bgIdx + 1}`;
    drawWrapped(`Схема описывает лицевую панель целиком, включая фон: ${gridW} ${stW} × ${gridH} ${rowsW} ≈ ${widthCm}×${heightCm} см. Всё остальное ниже — рекомендации и в схему не входит.`, { gap: 8 });
    if (itemType === 'pillow') {
      numbered(1, `Заднюю панель свяжите того же размера (${gridW} ${stW} × ${gridH} ${rowsW}) одним цветом — например, цветом фона (${bgName}) — или повторите эту схему.`);
      numbered(2, 'Сложите панели изнанками внутрь и сшейте три стороны иглой или соединительными столбиками.');
      numbered(3, 'Вложите подушку-вкладыш чуть больше панели (на 2–3 см по каждой стороне) и зашейте четвёртую сторону.');
      numbered(4, 'Обе панели вяжите одной пряжей и с одинаковой плотностью, иначе углы не совпадут.');
    } else if (itemType === 'panel') {
      numbered(1, `Для ровного края обвяжите панно 1–3 круговыми рядами столбиков цветом фона (${bgName}); кайма в схему не входит и добавит 1–3 см с каждой стороны.`);
      numbered(2, 'Чтобы спрятать концы нитей и придать панно форму, пришейте с изнанки подкладку из плотной ткани чуть меньше полотна.');
      numbered(3, 'Для подвеса пришейте к верхнему краю петли из пряжи или ленты и вденьте в них деревянную палку или рейку; панно можно повесить и в раме.');
      numbered(4, 'После вязания выполните влажную обработку и просушите панно в расправленном виде.');
    } else if (itemType === 'blanket') {
      numbered(1, `Края прямых рядов склонны волноваться. Для ровного края свяжите кайму: 2–4 круговых ряда столбиков вокруг всего полотна цветом фона (${bgName}). Кайма в схему не входит и добавит примерно 1–3 см с каждой стороны.`);
      numbered(2, 'После вязания выполните влажную обработку и просушите плед в расправленном виде — полотно выровняется.');
      numbered(3, 'Посчитайте пряжу по формуле на странице «Цвета пряжи» и возьмите запас: крупные изделия легко «съедают» больше, чем кажется.');
    } else if (itemType === 'scarf') {
      numbered(1, `Рисунок расположен в центральной области длинного полотна, остальное — фон (${bgName}). Фон вяжется так же, как остальные клетки.`);
      numbered(2, 'Края шарфа можно обвязать одним рядом столбиков вокруг (по желанию, в схему не входит).');
      numbered(3, 'После вязания выполните влажную обработку и просушите шарф в расправленном виде.');
    } else {
      numbered(1, `Края можно обвязать 1–3 круговыми рядами столбиков цветом фона (${bgName}) — по желанию, в схему не входит.`);
      numbered(2, 'После вязания выполните влажную обработку и просушите изделие в расправленном виде.');
    }
    callout('Перед началом работы по большому проекту рекомендуем связать небольшой пробный фрагмент схемы (например, 20×20 клеток), чтобы потренировать смену цвета и убедиться, что плотность и направление чтения вам подходят.', { bg: CARD_BG, fg: INK, bar: ACCENT });

    // ----- Колонтитулы на всех страницах -----
    const pages = pdfDoc.getPages();
    pages.forEach((pg, i) => {
      pg.drawLine({ start: { x: MARGIN, y: MARGIN + 20 }, end: { x: PAGE_W - MARGIN, y: MARGIN + 20 }, thickness: 0.6, color: LINE });
      pg.drawText('Сгенерировано автоматически — для личного использования', { x: MARGIN, y: MARGIN + 8, size: 7.5, font, color: INK2 });
      const right = `CrochetLens · стр. ${i + 1} из ${pages.length}`;
      pg.drawText(right, { x: PAGE_W - MARGIN - font.widthOfTextAtSize(right, 7.5), y: MARGIN + 8, size: 7.5, font, color: ACCENT });
    });

    const pdfBytes = await pdfDoc.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="mosaic-pattern.pdf"');
    res.status(200).send(Buffer.from(pdfBytes));
  } catch (err) {
    res.status(500).json({ error: 'PDF generation error: ' + err.message });
  }
};
