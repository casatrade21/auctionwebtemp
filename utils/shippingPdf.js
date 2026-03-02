/**
 * shippingPdf.js — 송장 라벨 PDF 생성기 (pdf-lib)
 *
 * 100mm×150mm 라벨: 발신/수신 정보, QR(송장번호), 지역 배지(제주/도서/산간).
 * generateShippingLabelsA4: A4에 2×3 배치(6장/페이지).
 */
const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");
const fs = require("fs");
const path = require("path");
const fontkit = require("@pdf-lib/fontkit");
const QRCode = require("qrcode");

// 송장 PDF 사이즈 (100mm x 150mm → pt 변환, 1mm ≈ 2.835pt)
const LABEL_WIDTH = 283.5; // 100mm
const LABEL_HEIGHT = 425.2; // 150mm

// A4 사이즈
const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;

/**
 * 한글 폰트 로드
 */
async function loadKoreanFont(pdfDoc) {
  pdfDoc.registerFontkit(fontkit);
  const fontPaths = [
    path.join(__dirname, "../public/fonts/NotoSansKR-Bold.ttf"),
    path.join(__dirname, "../public/fonts/NotoSansKR-Regular.ttf"),
    path.join(__dirname, "../public/fonts/NotoSansKR-Medium.ttf"),
  ];
  for (const fp of fontPaths) {
    if (fs.existsSync(fp)) {
      const fontBytes = fs.readFileSync(fp);
      return await pdfDoc.embedFont(fontBytes);
    }
  }
  // 폴백: 기본 폰트
  return await pdfDoc.embedFont(StandardFonts.Helvetica);
}

/**
 * 바코드용 QR 코드 생성 (송장번호 → QR → PNG buffer)
 */
async function generateQRBuffer(text) {
  return await QRCode.toBuffer(text, {
    type: "png",
    width: 120,
    margin: 1,
    errorCorrectionLevel: "M",
  });
}

/**
 * 텍스트 줄바꿈 헬퍼
 */
function wrapText(text, font, fontSize, maxWidth) {
  const words = text.split("");
  const lines = [];
  let currentLine = "";

  for (const char of words) {
    const testLine = currentLine + char;
    const width = font.widthOfTextAtSize(testLine, fontSize);
    if (width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = char;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

/**
 * 송장 라벨 PDF 생성 (100mm x 150mm)
 *
 * @param {Object} shipment - shipments 테이블 row
 * @returns {Buffer} PDF buffer
 */
async function generateShippingLabel(shipment) {
  const pdfDoc = await PDFDocument.create();
  const font = await loadKoreanFont(pdfDoc);
  const page = pdfDoc.addPage([LABEL_WIDTH, LABEL_HEIGHT]);

  const black = rgb(0, 0, 0);
  const gray = rgb(0.5, 0.5, 0.5);
  const lightGray = rgb(0.85, 0.85, 0.85);

  const margin = 12;
  const lineHeight = 14;
  let y = LABEL_HEIGHT - margin;

  // ── 상단: 택배사명 ──
  page.drawText("LOGEN 로젠택배", {
    x: margin,
    y: y - 2,
    size: 14,
    font,
    color: black,
  });
  y -= 22;

  // 구분선
  page.drawLine({
    start: { x: margin, y },
    end: { x: LABEL_WIDTH - margin, y },
    thickness: 1.5,
    color: black,
  });
  y -= 4;

  // ── 보내는 분 ──
  y -= lineHeight;
  page.drawText("보내는 분", { x: margin, y, size: 7, font, color: gray });
  y -= lineHeight;
  const senderName = shipment.sender_name || "카사스트레이드";
  page.drawText(senderName, { x: margin, y, size: 9, font, color: black });
  y -= lineHeight;
  const senderPhone = shipment.sender_phone || "";
  if (senderPhone) {
    page.drawText(senderPhone, { x: margin, y, size: 8, font, color: black });
    y -= lineHeight;
  }
  const senderAddr = shipment.sender_address || "";
  if (senderAddr) {
    const lines = wrapText(senderAddr, font, 7, LABEL_WIDTH - margin * 2);
    for (const line of lines) {
      page.drawText(line, { x: margin, y, size: 7, font, color: black });
      y -= lineHeight - 2;
    }
  }

  y -= 4;
  page.drawLine({
    start: { x: margin, y },
    end: { x: LABEL_WIDTH - margin, y },
    thickness: 0.5,
    color: lightGray,
  });
  y -= 4;

  // ── 받는 분 ──
  y -= lineHeight;
  page.drawText("받는 분", { x: margin, y, size: 7, font, color: gray });
  y -= lineHeight + 2;
  page.drawText(shipment.receiver_name || "", {
    x: margin,
    y,
    size: 12,
    font,
    color: black,
  });
  y -= lineHeight + 2;

  const rcvPhone = shipment.receiver_phone || "";
  const rcvCell = shipment.receiver_cell_phone || "";
  const phoneDisplay = [rcvPhone, rcvCell].filter(Boolean).join(" / ");
  if (phoneDisplay) {
    page.drawText(phoneDisplay, { x: margin, y, size: 9, font, color: black });
    y -= lineHeight + 2;
  }

  // 주소 (큰 글씨)
  const fullAddr = [shipment.receiver_address, shipment.receiver_address_detail]
    .filter(Boolean)
    .join(" ");
  const addrLines = wrapText(fullAddr, font, 10, LABEL_WIDTH - margin * 2);
  for (const line of addrLines) {
    page.drawText(line, { x: margin, y, size: 10, font, color: black });
    y -= lineHeight + 1;
  }

  y -= 4;
  page.drawLine({
    start: { x: margin, y },
    end: { x: LABEL_WIDTH - margin, y },
    thickness: 0.5,
    color: lightGray,
  });
  y -= 4;

  // ── 상품명 ──
  y -= lineHeight;
  page.drawText("상품명", { x: margin, y, size: 7, font, color: gray });
  y -= lineHeight;
  const goodsName = shipment.item_name || "-";
  const goodsLines = wrapText(goodsName, font, 9, LABEL_WIDTH - margin * 2);
  for (const line of goodsLines.slice(0, 2)) {
    page.drawText(line, { x: margin, y, size: 9, font, color: black });
    y -= lineHeight;
  }

  // ── 운임 정보 ──
  y -= 4;
  const fareText = `운임: ${(shipment.total_fare || 0).toLocaleString()}원`;
  page.drawText(fareText, { x: margin, y, size: 8, font, color: gray });
  y -= lineHeight;

  // ── 송장번호 (크게) ──
  y -= 8;
  page.drawLine({
    start: { x: margin, y: y + 4 },
    end: { x: LABEL_WIDTH - margin, y: y + 4 },
    thickness: 1,
    color: black,
  });

  const slipNo = shipment.logen_slip_no || shipment.tracking_number || "-";
  // 송장번호 포맷 (XXX-XXXX-XXXX)
  const formatted =
    slipNo.length === 11
      ? `${slipNo.slice(0, 3)}-${slipNo.slice(3, 7)}-${slipNo.slice(7)}`
      : slipNo;

  y -= 4;
  page.drawText("송장번호", { x: margin, y, size: 7, font, color: gray });
  y -= 18;
  page.drawText(formatted, { x: margin, y, size: 16, font, color: black });

  // ── QR코드 (송장번호) ──
  if (slipNo !== "-") {
    try {
      const qrBuffer = await generateQRBuffer(slipNo);
      const qrImage = await pdfDoc.embedPng(qrBuffer);
      const qrSize = 60;
      page.drawImage(qrImage, {
        x: LABEL_WIDTH - margin - qrSize,
        y: y - qrSize + 18,
        width: qrSize,
        height: qrSize,
      });
    } catch (e) {
      // QR 생성 실패 무시
    }
  }

  // ── 하단: 주문번호 / 날짜 ──
  const bottomY = margin + 8;
  const orderNo = shipment.logen_order_no || "";
  page.drawText(orderNo, {
    x: margin,
    y: bottomY + lineHeight,
    size: 6,
    font,
    color: gray,
  });
  const dateStr = shipment.created_at
    ? new Date(shipment.created_at).toISOString().slice(0, 10)
    : "";
  page.drawText(dateStr, { x: margin, y: bottomY, size: 6, font, color: gray });

  // 지역 배지
  const badges = [];
  if (shipment.is_jeju) badges.push("제주");
  if (shipment.is_island) badges.push("도서");
  if (shipment.is_mountain) badges.push("산간");
  if (badges.length > 0) {
    page.drawText(badges.join(" / "), {
      x: LABEL_WIDTH - margin - 60,
      y: bottomY,
      size: 8,
      font,
      color: rgb(0.8, 0.1, 0.1),
    });
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

/**
 * 복수 송장 라벨을 A4에 배치 (2열 x 3행 = 6장/페이지)
 */
async function generateShippingLabelsA4(shipments) {
  const pdfDoc = await PDFDocument.create();

  const cols = 2;
  const rows = 3;
  const perPage = cols * rows;
  const cellW = A4_WIDTH / cols;
  const cellH = A4_HEIGHT / rows;

  for (let i = 0; i < shipments.length; i += perPage) {
    const page = pdfDoc.addPage([A4_WIDTH, A4_HEIGHT]);
    const batch = shipments.slice(i, i + perPage);

    for (let j = 0; j < batch.length; j++) {
      const col = j % cols;
      const row = Math.floor(j / cols);
      const x = col * cellW;
      const y = A4_HEIGHT - (row + 1) * cellH;

      // 각 라벨을 개별 PDF로 만들어 embed
      const labelBuffer = await generateShippingLabel(batch[j]);
      const labelDoc = await PDFDocument.load(labelBuffer);
      const [labelPage] = await pdfDoc.embedPages(labelDoc.getPages());

      const scaleX = (cellW - 10) / LABEL_WIDTH;
      const scaleY = (cellH - 10) / LABEL_HEIGHT;
      const scale = Math.min(scaleX, scaleY);

      page.drawPage(labelPage, {
        x: x + 5,
        y: y + 5,
        xScale: scale,
        yScale: scale,
      });

      // 절취선
      page.drawRectangle({
        x: x,
        y: y,
        width: cellW,
        height: cellH,
        borderColor: rgb(0.8, 0.8, 0.8),
        borderWidth: 0.5,
      });
    }
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

module.exports = {
  generateShippingLabel,
  generateShippingLabelsA4,
};
