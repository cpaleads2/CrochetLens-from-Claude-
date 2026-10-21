const { PDFDocument, rgb, pushGraphicsState, popGraphicsState, rectangle, clip, endPath } = require('pdf-lib');
const fontkit = require('@pdf-lib/fontkit');
const fs = require('fs');
const path = require('path');

const { computePart, PDF_TEXT } = require('./_engine');
const brand = require('./_brand');

const PAGE_W = 612, PAGE_H = 792;
const MARGIN = 50;
const CONTENT_W = PAGE_W - MARGIN * 2;

// Palette matching the CrochetLens website
const INK = rgb(0x3A / 255, 0x26 / 255, 0x18 / 255);
const INK2 = rgb(0x8C / 255, 0x75 / 255, 0x61 / 255);
const ACCENT = rgb(0xB9 / 255, 0x70 / 255, 0x2F / 255);
const ACCENT_DEEP = rgb(0x8F / 255, 0x4E / 255, 0x1E / 255);
const GOLD = rgb(0x9C / 255, 0x7A / 255, 0x34 / 255);
const GOLD_BG = rgb(0xF1 / 255, 0xE7 / 255, 0xCE / 255);
const LINE = rgb(0xEA / 255, 0xD9 / 255, 0xC0 / 255);
const CARD_BG = rgb(0xFD / 255, 0xF8 / 255, 0xF1 / 255);
const WHITE = rgb(1, 1, 1);
const DISCLAIMER_BG = rgb(0xFA / 255, 0xEE / 255, 0xDA / 255);
const DISCLAIMER_TEXT = rgb(0x85 / 255, 0x4F / 255, 0x0B / 255);

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
  if (!(await require('./_guard').allow(req, res, 'pdf', { max: 30, windowSec: 3600 }))) return;

  try {
    const { lang = 'ru', height = 15, stg = 16, rowg = 14, title = '', parts = [], decorations = [], photoBase64 = null, photoMediaType = '', images = [], personalizeText = '' } = req.body;
    const t = PDF_TEXT[lang] || PDF_TEXT.ru;
    const mode = brand.modeFrom(req);          // free | paid | resale — решает сервер
    const F = brand.flags(mode);
    const bt = brand.t(lang);

    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);

    const regularBytes = fs.readFileSync(path.join(process.cwd(), 'api/fonts/DejaVuSans.ttf'));
    const boldBytes = fs.readFileSync(path.join(process.cwd(), 'api/fonts/DejaVuSans-Bold.ttf'));
    const font = await pdfDoc.embedFont(regularBytes, { subset: true });
    const fontBold = await pdfDoc.embedFont(boldBytes, { subset: true });
    let fontScript = fontBold;
    try {
      const scriptBytes = fs.readFileSync(path.join(process.cwd(), 'api/fonts/Caveat-Bold.ttf'));
      fontScript = await pdfDoc.embedFont(scriptBytes, { subset: true });
    } catch (e) { /* falls back to fontBold if the script font is missing */ }

    // Embed every provided source photo once, reused for the cover and for per-part crops.
    const sourceImages = (images && images.length ? images : (photoBase64 ? [{ base64: photoBase64, mediaType: photoMediaType }] : []));
    const embeddedImages = [];
    for (const img of sourceImages) {
      try {
        const bytes = Buffer.from(img.base64, 'base64');
        const embedded = (img.mediaType || '').includes('png') ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
        embeddedImages.push(embedded);
      } catch (e) {
        embeddedImages.push(null);
      }
    }
    const embeddedPhoto = embeddedImages[0] || null;

    function drawCroppedThumb(pageRef, embeddedImg, bbox, boxX, boxTopY, boxW, boxH) {
      if (!embeddedImg || !bbox) return false;
      const imgW = embeddedImg.width, imgH = embeddedImg.height;
      const cropX = bbox.x * imgW, cropY = bbox.y * imgH;
      const cropW = Math.max(1, bbox.w * imgW), cropH = Math.max(1, bbox.h * imgH);
      const scale = Math.max(boxW / cropW, boxH / cropH);
      const drawW = imgW * scale, drawH = imgH * scale;
      const imgX = boxX - cropX * scale;
      const imgY = boxTopY - drawH + cropY * scale;
      const boxBottom = boxTopY - boxH;
      pageRef.pushOperators(pushGraphicsState());
      pageRef.pushOperators(rectangle(boxX, boxBottom, boxW, boxH), clip(), endPath());
      pageRef.drawImage(embeddedImg, { x: imgX, y: imgY, width: drawW, height: drawH });
      pageRef.pushOperators(popGraphicsState());
      return true;
    }

    let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    let y = PAGE_H - MARGIN;

    function newPage() {
      page = pdfDoc.addPage([PAGE_W, PAGE_H]);
      y = PAGE_H - MARGIN;
    }
    function ensureSpace(h) {
      if (y - h < MARGIN) newPage();
    }
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
    function spacer(h) { y -= h; }
    function centeredText(text, cy, { size = 10, useFont = fontBold, color = WHITE, cx = 0 } = {}) {
      const w = useFont.widthOfTextAtSize(text, size);
      page.drawText(text, { x: cx - w / 2, y: cy - size * 0.36, size, font: useFont, color });
    }

    // ---------- Простые векторные иконки ----------
    function iconYarn(cx, cy, r, color) {
      page.drawCircle({ x: cx, y: cy, size: r, color });
      page.drawCircle({ x: cx - r * 0.32, y: cy + r * 0.32, size: r * 0.34, color: WHITE, opacity: 0.35 });
      for (const dx of [-0.45, 0, 0.45]) {
        page.drawEllipse({ x: cx, y: cy, xScale: r * 0.9, yScale: r * (0.32 + Math.abs(dx) * 0.2), rotate: { angle: (dx * 70), type: 'degrees' }, borderColor: WHITE, borderWidth: 0.6, borderOpacity: 0.5 });
      }
    }
    function iconHook(cx, cy, s, color) {
      page.drawLine({ start: { x: cx - s * 0.6, y: cy - s * 0.6 }, end: { x: cx + s * 0.5, y: cy + s * 0.6 }, thickness: 1.6, color });
      page.drawCircle({ x: cx + s * 0.62, y: cy + s * 0.68, size: s * 0.22, borderColor: color, borderWidth: 1.4 });
    }
    function iconCloud(cx, cy, s, color) {
      page.drawCircle({ x: cx - s * 0.4, y: cy - s * 0.05, size: s * 0.42, color });
      page.drawCircle({ x: cx + s * 0.05, y: cy + s * 0.15, size: s * 0.5, color });
      page.drawCircle({ x: cx + s * 0.5, y: cy - s * 0.05, size: s * 0.38, color });
      page.drawRectangle({ x: cx - s * 0.75, y: cy - s * 0.35, width: s * 1.5, height: s * 0.35, color });
    }
    function iconEyes(cx, cy, s, color) {
      for (const dx of [-0.4, 0.4]) {
        page.drawCircle({ x: cx + s * dx, y: cy, size: s * 0.3, color });
        page.drawCircle({ x: cx + s * dx - s * 0.08, y: cy + s * 0.08, size: s * 0.08, color: WHITE });
      }
    }
    function iconRuler(cx, cy, s, color) {
      page.drawRectangle({ x: cx - s * 0.6, y: cy - s * 0.22, width: s * 1.2, height: s * 0.44, borderColor: color, borderWidth: 1.3 });
      for (let i = -2; i <= 2; i++) page.drawLine({ start: { x: cx + i * s * 0.2, y: cy + s * 0.22 }, end: { x: cx + i * s * 0.2, y: cy + s * 0.05 }, thickness: 1, color });
    }
    function iconGrid(cx, cy, s, color) {
      for (let i = 0; i <= 2; i++) {
        page.drawLine({ start: { x: cx - s * 0.5, y: cy - s * 0.5 + i * s * 0.5 }, end: { x: cx + s * 0.5, y: cy - s * 0.5 + i * s * 0.5 }, thickness: 1, color });
        page.drawLine({ start: { x: cx - s * 0.5 + i * s * 0.5, y: cy - s * 0.5 }, end: { x: cx - s * 0.5 + i * s * 0.5, y: cy + s * 0.5 }, thickness: 1, color });
      }
    }
    function iconList(cx, cy, s, color) {
      for (let i = -1; i <= 1; i++) {
        page.drawCircle({ x: cx - s * 0.45, y: cy + i * s * 0.35, size: s * 0.06, color });
        page.drawLine({ start: { x: cx - s * 0.28, y: cy + i * s * 0.35 }, end: { x: cx + s * 0.5, y: cy + i * s * 0.35 }, thickness: 1.3, color });
      }
    }

    // ---------- Титул ----------
    if (F.brandText) drawLine('CROCHETLENS', { size: 10, useFont: fontBold, color: ACCENT, gap: 8 });
    drawLine(title || '-', { size: 22, useFont: fontBold, color: INK, gap: 14 });
    if (F.locked) {
      page.drawRectangle({ x: MARGIN, y: y - 22, width: CONTENT_W, height: 22, color: DISCLAIMER_BG });
      page.drawText(bt.sample, { x: MARGIN + 10, y: y - 15, size: 8.5, font: fontBold, color: DISCLAIMER_TEXT });
      y -= 32;
    }

    // ---------- Фото ----------
    const coverPhotos = embeddedImages.filter(Boolean).slice(0, 2);
    if (coverPhotos.length === 1) {
      const photo = coverPhotos[0];
      const maxW = 190, maxH = 220;
      const scale = Math.min(maxW / photo.width, maxH / photo.height, 1);
      const w = photo.width * scale, h = photo.height * scale;
      ensureSpace(h + 18);
      const px = MARGIN + (CONTENT_W - w) / 2;
      page.drawRectangle({ x: px - 6, y: y - h - 6, width: w + 12, height: h + 12, color: CARD_BG, borderColor: LINE, borderWidth: 1 });
      page.drawImage(photo, { x: px, y: y - h, width: w, height: h });
      y -= h + 22;
    } else if (coverPhotos.length === 2) {
      const maxW = 150, maxH = 190, gapPhotos = 16;
      const sizes = coverPhotos.map(photo => {
        const scale = Math.min(maxW / photo.width, maxH / photo.height, 1);
        return { w: photo.width * scale, h: photo.height * scale };
      });
      const rowH = Math.max(sizes[0].h, sizes[1].h);
      ensureSpace(rowH + 18);
      const totalW = sizes[0].w + sizes[1].w + gapPhotos;
      let px = MARGIN + (CONTENT_W - totalW) / 2;
      const labels = [t.frontPhotoLabel, t.backPhotoLabel];
      coverPhotos.forEach((photo, i) => {
        const { w, h } = sizes[i];
        page.drawRectangle({ x: px - 6, y: y - rowH - 6, width: w + 12, height: rowH + 12, color: CARD_BG, borderColor: LINE, borderWidth: 1 });
        page.drawImage(photo, { x: px, y: y - rowH + (rowH - h), width: w, height: h });
        const labelW = font.widthOfTextAtSize(labels[i], 7.5);
        page.drawText(labels[i], { x: px + (w - labelW) / 2, y: y - rowH - 20, size: 7.5, font, color: INK2 });
        px += w + gapPhotos;
      });
      y -= rowH + 34;
    }

    // ---------- Инфо-карточки: размер / плотность / деталей ----------
    {
      const cardH = 54, gap = 12;
      const cardW = (CONTENT_W - gap * 2) / 3;
      ensureSpace(cardH + 16);
      const infoCards = [
        { icon: iconRuler, label: t.heightRow, value: `${height} cm` },
        { icon: iconGrid, label: t.gaugeRow, value: `${stg}/${rowg}` },
        { icon: iconList, label: t.partsHeader, value: String(parts.length) }
      ];
      infoCards.forEach((c, i) => {
        const cx0 = MARGIN + i * (cardW + gap);
        page.drawRectangle({ x: cx0, y: y - cardH, width: cardW, height: cardH, color: CARD_BG, borderColor: LINE, borderWidth: 1 });
        c.icon(cx0 + 22, y - cardH / 2, 15, ACCENT);
        const lx = cx0 + 40;
        page.drawText(c.label, { x: lx, y: y - 20, size: 7.5, font, color: INK2 });
        page.drawText(c.value, { x: lx, y: y - 34, size: 12.5, font: fontBold, color: INK });
      });
      y -= cardH + 20;
    }

    // ---------- Дисклеймер ----------
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

    // ---------- Материалы ----------
    drawLine(t.materialsHeader, { size: 14, useFont: fontBold, gap: 12 });
    {
      const matItems = [
        { icon: iconYarn, label: t.yarnRow, value: t.yarnVal },
        { icon: iconHook, label: t.hookRow, value: t.hookVal },
        { icon: iconCloud, label: t.stuffRow, value: t.stuffVal },
        { icon: iconEyes, label: t.extraRow, value: t.extraVal }
      ];
      const colW = (CONTENT_W - 14) / 2;
      let colX = [MARGIN, MARGIN + colW + 14];
      let colY = [y, y];
      matItems.forEach((m, i) => {
        const col = i % 2;
        const rowH = 46;
        if (colY[col] - rowH < MARGIN) { newPage(); colY[0] = y; colY[1] = y; }
        const bx = colX[col], by = colY[col];
        page.drawRectangle({ x: bx, y: by - rowH, width: colW, height: rowH, color: CARD_BG, borderColor: LINE, borderWidth: 1 });
        m.icon(bx + 22, by - rowH / 2, 15, ACCENT);
        const lines = wrapText(m.value, font, 8, colW - 52);
        page.drawText(m.label, { x: bx + 40, y: by - 16, size: 9, font: fontBold, color: INK });
        let ty = by - 28;
        for (const l of lines.slice(0, 2)) { page.drawText(l, { x: bx + 40, y: ty, size: 8, font, color: INK2 }); ty -= 10; }
        colY[col] -= rowH + 8;
      });
      y = Math.min(colY[0], colY[1]) + 8;
    }
    spacer(14);

    // ---------- Легенда ----------
    drawLine(t.legendHeader, { size: 14, useFont: fontBold, gap: 10 });
    ensureSpace(t.legend.length * 15 + 10);
    page.drawRectangle({ x: MARGIN, y: y - t.legend.length * 15 - 8, width: CONTENT_W, height: t.legend.length * 15 + 8, color: CARD_BG, borderColor: LINE, borderWidth: 1 });
    y -= 6;
    for (const [abbr, mean] of t.legend) {
      page.drawText(abbr, { x: MARGIN + 12, y: y - 9, size: 9, font: fontBold, color: ACCENT_DEEP });
      page.drawText(mean, { x: MARGIN + 120, y: y - 9, size: 9, font, color: INK });
      y -= 15;
    }
    y -= 4;

    // ---------- Детали ----------
    newPage();
    drawLine(t.partsHeader, { size: 20, useFont: fontBold, gap: 16 });

    let partIndex = 0;
    for (const p of parts) {
      partIndex++;
      const { rounds, maxSt } = computePart(p, stg, rowg, lang);
      // Картинки деталей в схеме отключены: автоматические вырезки из фото бывают неточными и могут ввести в заблуждение.
      // Вернём, когда появится точный вырез по контуру. Чтобы включить: PART_THUMBS = true.
      const PART_THUMBS = false;
      const hasThumb = PART_THUMBS && !!(p.bbox && embeddedImages[p.bbox.image]);
      const headerH = hasThumb ? 46 : 30;
      ensureSpace(headerH + 14);

      // Цветная шапка с номером
      page.drawRectangle({ x: MARGIN, y: y - headerH, width: CONTENT_W, height: headerH, color: GOLD_BG });
      page.drawCircle({ x: MARGIN + 18, y: y - headerH / 2, size: 12, color: GOLD });
      centeredText(String(partIndex), y - headerH / 2, { size: 11, color: WHITE, cx: MARGIN + 18 });
      page.drawText(p.name, { x: MARGIN + 38, y: y - (hasThumb ? 18 : 13), size: 11.5, font: fontBold, color: INK });
      const metaStr = `${t.typeLabels[p.type] || p.type}  ·  ${p.count} ${t.pc}  ·  ${t.maxSt}: ${maxSt}`;
      page.drawText(metaStr, { x: MARGIN + 38, y: y - (hasThumb ? 32 : 25), size: 8, font, color: INK2 });
      if (hasThumb) {
        const thumbSize = 36;
        const tx = MARGIN + CONTENT_W - thumbSize - 5;
        const ty = y - 5;
        page.drawRectangle({ x: tx - 1.5, y: ty - thumbSize - 1.5, width: thumbSize + 3, height: thumbSize + 3, color: WHITE, borderColor: LINE, borderWidth: 1 });
        drawCroppedThumb(page, embeddedImages[p.bbox.image], p.bbox, tx, ty, thumbSize, thumbSize);
      }
      y -= headerH + 10;

      if (F.locked && partIndex > 1) {
        const noteLines = wrapText(bt.locked, font, 9, CONTENT_W - 36);
        ensureSpace(noteLines.length * 13 + 14);
        page.drawRectangle({ x: MARGIN, y: y - noteLines.length * 13 - 8, width: CONTENT_W, height: noteLines.length * 13 + 8, color: CARD_BG, borderColor: LINE, borderWidth: 1, borderDashArray: [4, 4] });
        let ny = y - 4;
        for (const nl of noteLines) { page.drawText(nl, { x: MARGIN + 14, y: ny - 9, size: 9, font, color: INK2 }); ny -= 13; }
        y = ny - 12;
        spacer(12);
        continue;
      }

      for (const r of rounds) {
        const lines = wrapText(r.text, font, 9, CONTENT_W - 36);
        const rowH = Math.max(lines.length * 13, 15) + 3;
        ensureSpace(rowH);
        page.drawCircle({ x: MARGIN + 8, y: y - 8, size: 7.5, color: CARD_BG, borderColor: LINE, borderWidth: 0.8 });
        const numSize = String(r.n).length > 1 ? 6.5 : 7.5;
        centeredText(String(r.n), y - 8, { size: numSize, color: ACCENT_DEEP, cx: MARGIN + 8 });
        let ly = y;
        for (const line of lines) {
          page.drawText(line, { x: MARGIN + 26, y: ly - 9, size: 9, font, color: INK });
          ly -= 13;
        }
        y = ly - 3;
      }
      spacer(12);
    }

    // ---------- Декор ----------
    newPage();
    drawLine(t.decorHeader, { size: 14, useFont: fontBold, gap: 6 });
    drawWrapped(t.decorNote, { size: 8.5, color: INK2, gap: 12 });
    for (const d of decorations) {
      ensureSpace(24);
      page.drawCircle({ x: MARGIN + 4, y: y - 6, size: 3, color: ACCENT, rotate: { angle: 45, type: 'degrees' } });
      drawLine(d.name, { size: 10.5, useFont: fontBold, color: ACCENT_DEEP, x: MARGIN + 14, gap: 4 });
      if (F.locked) { y -= 6; continue; }
      drawWrapped(d.instruction, { size: 9, x: MARGIN + 14, maxWidth: CONTENT_W - 14, gap: 10 });
    }

    // ---------- Персонализация ----------
    if (!F.locked && personalizeText && personalizeText.trim()) {
      newPage();
      drawLine(t.personalizeHeader, { size: 14, useFont: fontBold, gap: 10 });
      drawWrapped(t.personalizeInstruction, { size: 9, color: INK2, gap: 20 });
      const text = personalizeText.trim().slice(0, 20);
      let stencilSize = 90;
      while (stencilSize > 24 && fontScript.widthOfTextAtSize(text, stencilSize) > CONTENT_W - 20) stencilSize -= 2;
      ensureSpace(stencilSize + 40);
      const textWidth = fontScript.widthOfTextAtSize(text, stencilSize);
      page.drawRectangle({ x: MARGIN, y: y - stencilSize - 30, width: CONTENT_W, height: stencilSize + 30, color: CARD_BG, borderColor: LINE, borderWidth: 1, borderDashArray: [4, 4] });
      page.drawText(text, { x: MARGIN + (CONTENT_W - textWidth) / 2, y: y - stencilSize + 8, size: stencilSize, font: fontScript, color: ACCENT_DEEP });
      y -= stencilSize + 46;
    }

    // ---------- Футер на последней странице ----------
    ensureSpace(30);
    page.drawLine({ start: { x: MARGIN, y: MARGIN + 20 }, end: { x: PAGE_W - MARGIN, y: MARGIN + 20 }, thickness: 0.6, color: LINE });
    if (F.personalOnlyNote) page.drawText(t.footer, { x: MARGIN, y: MARGIN + 8, size: 7.5, font, color: INK2 });
    if (F.brandText) page.drawText('CrochetLens', { x: PAGE_W - MARGIN - fontBold.widthOfTextAtSize('CrochetLens', 7.5), y: MARGIN + 8, size: 7.5, font: fontBold, color: ACCENT });

    await brand.applyBranding(pdfDoc, mode, { font });
    brand.setMeta(pdfDoc, mode, title);
    const pdfBytes = await pdfDoc.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="pattern.pdf"`);
    res.setHeader('X-CL-Mode', mode);
    res.status(200).send(Buffer.from(pdfBytes));
  } catch (err) {
    res.status(500).json({ error: 'PDF generation error: ' + err.message });
  }
};
