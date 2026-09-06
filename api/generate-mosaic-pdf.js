const { PDFDocument, rgb, pushGraphicsState, popGraphicsState, rectangle, clip, endPath } = require('pdf-lib');
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
const DISCLAIMER_BG = rgb(0xFA / 255, 0xEE / 255, 0xDA / 255);
const DISCLAIMER_TEXT = rgb(0x85 / 255, 0x4F / 255, 0x0B / 255);

const TEXT = {
  ru: {
    brand: 'CROCHETLENS', header: 'Схема мозаичного вязания',
    sizeLabel: 'Размер', gaugeLabel: 'Плотность', colorsLabel: 'Цветов пряжи', stitchesLabel: 'Столбиков всего',
    disclaimer: 'Это черновая схема, собранная автоматически по фото. Перед вязанием обязательно свяжите контрольный образец 10×10 см и сверьте свою плотность с указанной ниже — размер сетки рассчитан именно под неё.',
    legendHeader: 'Цвета пряжи', legendNote: 'Подберите ближайшую по цвету пряжу к каждому образцу ниже. Порядок — по убыванию количества столбиков этого цвета в схеме.',
    chartHeader: 'Схема', chartNote: 'Каждая клетка — один столбик без накида своего цвета. Вяжется прямыми рядами (можно и по кругу — тогда чётные ряды читайте в зеркальном порядке).',
    pagePart: (i, n) => `Часть ${i} из ${n}`,
    instructionsHeader: 'Как вязать по схеме',
    instructions: [
      'Вяжите обычным столбиком без накида, ряд за рядом, снизу вверх — первый (нижний) ряд схемы соответствует ряду начальной цепочки.',
      'Каждая клетка схемы — один столбик того же цвета. Меняйте нить в последнем провязывании столбика перед сменой цвета, чтобы переход был аккуратным.',
      'Нечётные ряды (снизу) читайте слева направо, чётные — справа налево — это соответствует направлению вязания рядами туда-обратно.',
      'Для мелких цветовых пятен (несколько клеток подряд) удобнее не обрывать нить, а протягивать её по изнанке — так меньше концов для прятки.',
      'В конце спрячьте все хвостики нити с изнаночной стороны иглой.'
    ],
    footer: 'Сгенерировано автоматически - для личного использования'
  },
  en: {
    brand: 'CROCHETLENS', header: 'Mosaic Crochet Chart',
    sizeLabel: 'Size', gaugeLabel: 'Gauge', colorsLabel: 'Yarn colors', stitchesLabel: 'Total stitches',
    disclaimer: 'This is a draft chart generated automatically from a photo. Before crocheting, make a 10x10 cm gauge swatch and compare your gauge with the one below - the grid size is calculated for this exact gauge.',
    legendHeader: 'Yarn colors', legendNote: 'Match each swatch below to the closest yarn you have. Ordered by how much of the chart uses that color.',
    chartHeader: 'Chart', chartNote: 'Each cell is one single crochet in that color. Worked in straight rows (or in the round - mirror even rows in that case).',
    pagePart: (i, n) => `Part ${i} of ${n}`,
    instructionsHeader: 'How to follow this chart',
    instructions: [
      'Work in single crochet, row by row, bottom to top - the first (bottom) row of the chart corresponds to your starting chain row.',
      'Each cell is one stitch in that color. Change yarn on the last pull-through of the stitch before the color change for a clean transition.',
      'Read odd rows (from the bottom) left to right, even rows right to left - this matches turning your work at the end of each row.',
      'For small color patches (a few cells), it is often easier to carry the unused yarn behind your stitches rather than cutting it - fewer ends to weave in.',
      'Weave in all loose ends on the wrong side when finished.'
    ],
    footer: 'Generated automatically - for personal use'
  }
};

function wrapText(text, font, size, maxWidth) {
  const words = text.split(' ');
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

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      lang = 'ru', title = '', widthCm = 30, heightCm = 30, stg = 18, rowg = 20,
      gridW = 30, gridH = 30, palette = [], paletteNames = [], chartImageBase64 = null,
      personalizeBandRows = 0, photoBase64 = null, photoMediaType = ''
    } = req.body;
    const t = TEXT[lang] || TEXT.ru;

    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);

    const regularBytes = fs.readFileSync(path.join(process.cwd(), 'api/fonts/DejaVuSans.ttf'));
    const boldBytes = fs.readFileSync(path.join(process.cwd(), 'api/fonts/DejaVuSans-Bold.ttf'));
    const font = await pdfDoc.embedFont(regularBytes, { subset: true });
    const fontBold = await pdfDoc.embedFont(boldBytes, { subset: true });

    let embeddedPhoto = null;
    if (photoBase64) {
      try {
        const bytes = Buffer.from(photoBase64, 'base64');
        embeddedPhoto = (photoMediaType || '').includes('png') ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
      } catch (e) { embeddedPhoto = null; }
    }

    let embeddedChart = null;
    if (chartImageBase64) {
      try {
        embeddedChart = await pdfDoc.embedPng(Buffer.from(chartImageBase64, 'base64'));
      } catch (e) { embeddedChart = null; }
    }

    let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    let y = PAGE_H - MARGIN;

    function newPage() { page = pdfDoc.addPage([PAGE_W, PAGE_H]); y = PAGE_H - MARGIN; }
    function ensureSpace(h) { if (y - h < MARGIN) newPage(); }
    function drawLine(text, { size = 10, useFont = font, color = INK, x = MARGIN, gap = 4 } = {}) {
      ensureSpace(size + gap);
      page.drawText(text, { x, y: y - size, size, font: useFont, color });
      y -= size + gap;
    }
    function drawWrapped(text, { size = 9.5, useFont = font, color = INK, x = MARGIN, maxWidth = CONTENT_W, gap = 3, lineGap = 13 } = {}) {
      const lines = wrapText(text, useFont, size, maxWidth);
      for (const line of lines) {
        ensureSpace(lineGap);
        page.drawText(line, { x, y: y - size, size, font: useFont, color });
        y -= lineGap;
      }
      y -= gap;
    }

    // ---------- Титул ----------
    drawLine(t.brand, { size: 10, useFont: fontBold, color: ACCENT, gap: 8 });
    drawLine(title || t.header, { size: 22, useFont: fontBold, color: INK, gap: 14 });

    if (embeddedPhoto) {
      const maxW = 170, maxH = 200;
      const scale = Math.min(maxW / embeddedPhoto.width, maxH / embeddedPhoto.height, 1);
      const w = embeddedPhoto.width * scale, h = embeddedPhoto.height * scale;
      ensureSpace(h + 18);
      const px = MARGIN + (CONTENT_W - w) / 2;
      page.drawRectangle({ x: px - 6, y: y - h - 6, width: w + 12, height: h + 12, color: CARD_BG, borderColor: LINE, borderWidth: 1 });
      page.drawImage(embeddedPhoto, { x: px, y: y - h, width: w, height: h });
      y -= h + 22;
    }

    {
      const cardH = 54, gap = 12;
      const cardW = (CONTENT_W - gap * 3) / 4;
      ensureSpace(cardH + 16);
      const cards = [
        { label: t.sizeLabel, value: `${widthCm}×${heightCm} cm` },
        { label: t.gaugeLabel, value: `${stg}/${rowg}` },
        { label: t.colorsLabel, value: String(palette.length) },
        { label: t.stitchesLabel, value: (gridW * gridH).toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US') }
      ];
      cards.forEach((c, i) => {
        const cx0 = MARGIN + i * (cardW + gap);
        page.drawRectangle({ x: cx0, y: y - cardH, width: cardW, height: cardH, color: CARD_BG, borderColor: LINE, borderWidth: 1 });
        page.drawText(c.label, { x: cx0 + 10, y: y - 20, size: 7, font, color: INK2 });
        page.drawText(c.value, { x: cx0 + 10, y: y - 36, size: 11.5, font: fontBold, color: INK });
      });
      y -= cardH + 20;
    }

    const discLines = wrapText(t.disclaimer, font, 9, CONTENT_W - 30);
    const discHeight = discLines.length * 13 + 16;
    ensureSpace(discHeight + 16);
    page.drawRectangle({ x: MARGIN, y: y - discHeight, width: CONTENT_W, height: discHeight, color: DISCLAIMER_BG });
    page.drawRectangle({ x: MARGIN, y: y - discHeight, width: 4, height: discHeight, color: ACCENT_DEEP });
    let dy = y - 14;
    for (const line of discLines) {
      page.drawText(line, { x: MARGIN + 16, y: dy - 9, size: 9, font, color: DISCLAIMER_TEXT });
      dy -= 13;
    }
    y -= discHeight + 22;

    // ---------- Легенда цветов ----------
    newPage();
    drawLine(t.legendHeader, { size: 16, useFont: fontBold, gap: 8 });
    drawWrapped(t.legendNote, { size: 9, color: INK2, gap: 14 });
    {
      const swSize = 26, rowH = 36, colW = CONTENT_W / 2;
      let col = 0, rowY = y;
      palette.forEach((hex, i) => {
        if (rowY - rowH < MARGIN) { newPage(); rowY = y; col = 0; }
        const cx = MARGIN + col * colW;
        const hexClean = hex.replace('#', '');
        const r = parseInt(hexClean.substr(0, 2), 16) / 255;
        const g = parseInt(hexClean.substr(2, 2), 16) / 255;
        const b = parseInt(hexClean.substr(4, 2), 16) / 255;
        page.drawRectangle({ x: cx, y: rowY - swSize, width: swSize, height: swSize, color: rgb(r, g, b), borderColor: LINE, borderWidth: 1 });
        const name = paletteNames[i] || '';
        page.drawText(`${i + 1}. ${name}`, { x: cx + swSize + 10, y: rowY - swSize / 2 + 2, size: 10, font: fontBold, color: INK });
        page.drawText(hex, { x: cx + swSize + 10, y: rowY - swSize / 2 - 10, size: 8, font, color: INK2 });
        col++;
        if (col === 2) { col = 0; rowY -= rowH; }
      });
      y = rowY - rowH;
    }

    // ---------- Схема (постранично) ----------
    if (embeddedChart) {
      newPage();
      drawLine(t.chartHeader, { size: 16, useFont: fontBold, gap: 8 });
      drawWrapped(t.chartNote, { size: 9, color: INK2, gap: 12 });

      let cellPt = CONTENT_W / gridW;
      if (cellPt > 13) cellPt = 13;
      if (cellPt < 3) cellPt = 3;
      const chartDrawW = gridW * cellPt;

      // Резервируем место под подпись "Часть X из Y" ЗАРАНЕЕ на каждой странице (даже если в
      // итоге окажется одна часть и подпись не понадобится) — иначе расчёт того, сколько рядов
      // влезает, разойдётся с тем, сколько реально останется места после отрисовки этой подписи.
      const LABEL_RESERVE = 22;
      const availableFirstPage = y - MARGIN - LABEL_RESERVE;
      const availableFullPage = (PAGE_H - MARGIN * 2) - 60 - LABEL_RESERVE;
      const rowsFirstPage = Math.max(1, Math.floor(availableFirstPage / cellPt));
      const rowsPerPage = Math.max(1, Math.floor(availableFullPage / cellPt));

      // Разбиваем на страницы, стараясь не резать полосу с именем/текстом посередине букв —
      // если естественная граница страницы попадает внутрь неё, переносим её целиком на следующую.
      const bandStart = personalizeBandRows > 0 ? (gridH - personalizeBandRows) : -1;
      const pageRowCounts = [];
      let remaining = gridH, rowsDoneCalc = 0, first = true;
      while (remaining > 0) {
        let take = Math.min(first ? rowsFirstPage : rowsPerPage, remaining);
        const splitRow = rowsDoneCalc + take;
        if (bandStart > 0 && splitRow > bandStart && splitRow < gridH && rowsDoneCalc < bandStart) {
          take = bandStart - rowsDoneCalc; // заканчиваем страницу ровно перед полосой с текстом
        }
        if (take <= 0) take = Math.min(first ? rowsFirstPage : rowsPerPage, remaining); // защита от зацикливания
        pageRowCounts.push(take);
        remaining -= take;
        rowsDoneCalc += take;
        first = false;
      }
      const totalParts = pageRowCounts.length;

      let rowsDone = 0;
      pageRowCounts.forEach((rowsThisPage, partIdx) => {
        if (partIdx > 0) newPage();
        if (totalParts > 1) {
          drawLine(t.pagePart(partIdx + 1, totalParts), { size: 10, useFont: fontBold, color: ACCENT_DEEP, gap: 10 });
        }
        const bandH = rowsThisPage * cellPt;
        ensureSpace(bandH + 10);

        const bboxY = rowsDone / gridH;
        const bboxH = rowsThisPage / gridH;
        const boxX = MARGIN + (CONTENT_W - chartDrawW) / 2;
        const boxTopY = y;

        const imgW = embeddedChart.width, imgH = embeddedChart.height;
        const cropX = 0, cropY = bboxY * imgH;
        const cropW = imgW, cropH = bboxH * imgH;
        const scale = Math.max(chartDrawW / cropW, bandH / cropH);
        const drawW = imgW * scale, drawH = imgH * scale;
        const imgX = boxX - cropX * scale;
        const imgY = boxTopY - drawH + cropY * scale;
        const boxBottom = boxTopY - bandH;

        page.pushOperators(pushGraphicsState());
        page.pushOperators(rectangle(boxX, boxBottom, chartDrawW, bandH), clip(), endPath());
        page.drawImage(embeddedChart, { x: imgX, y: imgY, width: drawW, height: drawH });
        page.pushOperators(popGraphicsState());
        page.drawRectangle({ x: boxX, y: boxBottom, width: chartDrawW, height: bandH, borderColor: LINE, borderWidth: 1 });

        y -= bandH + 10;
        rowsDone += rowsThisPage;
      });
    }

    // ---------- Инструкция ----------
    newPage();
    drawLine(t.instructionsHeader, { size: 16, useFont: fontBold, gap: 12 });
    t.instructions.forEach((line, i) => {
      ensureSpace(22);
      page.drawCircle({ x: MARGIN + 7, y: y - 8, size: 9, color: ACCENT_DEEP });
      page.drawText(String(i + 1), { x: MARGIN + (i + 1 >= 10 ? 3.5 : 4.5), y: y - 11, size: 8.5, font: fontBold, color: WHITE });
      const lines = wrapText(line, font, 9.5, CONTENT_W - 26);
      let ly = y;
      lines.forEach((l) => {
        page.drawText(l, { x: MARGIN + 22, y: ly - 9, size: 9.5, font, color: INK });
        ly -= 13;
      });
      y = ly - 8;
    });

    ensureSpace(30);
    page.drawLine({ start: { x: MARGIN, y: MARGIN + 20 }, end: { x: PAGE_W - MARGIN, y: MARGIN + 20 }, thickness: 0.6, color: LINE });
    page.drawText(t.footer, { x: MARGIN, y: MARGIN + 8, size: 7.5, font, color: INK2 });
    page.drawText('CrochetLens', { x: PAGE_W - MARGIN - fontBold.widthOfTextAtSize('CrochetLens', 7.5), y: MARGIN + 8, size: 7.5, font: fontBold, color: ACCENT });

    const pdfBytes = await pdfDoc.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="mosaic-pattern.pdf"`);
    res.status(200).send(Buffer.from(pdfBytes));
  } catch (err) {
    res.status(500).json({ error: 'PDF generation error: ' + err.message });
  }
};
