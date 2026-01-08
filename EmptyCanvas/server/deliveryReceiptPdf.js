const PDFDocument = require("pdfkit");
const path = require("path");

function moneyGBP(n) {
  const num = Number(n) || 0;
  return `£${num.toFixed(2)}`;
}

function formatDateTime(date) {
  try {
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) return String(date || "-");
    // Matches UI style like: 8 Jan 2026, 09:36
    return d.toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(date || "-");
  }
}

/**
 * Generate a nicer Delivery Receipt PDF and pipe it to a writable stream (e.g. Express res).
 *
 * @param {Object} params
 * @param {string} params.orderId
 * @param {Date} params.createdAt
 * @param {string} params.teamMember
 * @param {string} params.preparedBy
 * @param {Array<{component:string,reason:string,qty:number,unit:number,total:number}>} params.rows
 * @param {number} params.grandQty
 * @param {number} params.grandTotal
 * @param {import('stream').Writable} stream
 */
function pipeDeliveryReceiptPDF(
  { orderId, createdAt, teamMember, preparedBy, rows, grandQty, grandTotal },
  stream,
) {
  const doc = new PDFDocument({ size: "A4", margin: 36 });
  doc.pipe(stream);

  const COLORS = {
    border: "#E5E7EB",
    muted: "#6B7280",
    text: "#111827",
    headerBg: "#F3F4F6",
    zebra: "#FAFAFA",
  };

  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const mL = doc.page.margins.left;
  const mR = doc.page.margins.right;
  const mT = doc.page.margins.top;
  const mB = doc.page.margins.bottom;
  const contentW = pageW - mL - mR;

  const safeRows = Array.isArray(rows) ? rows : [];

  const logoPath = path.join(__dirname, "..", "public", "images", "Logo horizontal.png");

  function drawPageHeader({ compact = false } = {}) {
    const headerTop = mT;
    const headerH = compact ? 42 : 56;

    // Logo (top-right)
    try {
      const logoW = compact ? 140 : 170;
      const logoX = pageW - mR - logoW;
      const logoY = headerTop - 4;
      doc.image(logoPath, logoX, logoY, { width: logoW });
    } catch {
      // ignore logo errors (missing asset on env)
    }

    // Title (left)
    const titleX = mL;
    const titleY = headerTop + (compact ? 2 : 6);
    const titleW = contentW - (compact ? 150 : 180);
    doc
      .fillColor(COLORS.text)
      .font("Helvetica-Bold")
      .fontSize(compact ? 16 : 20)
      .text("Delivery Receipt", titleX, titleY, { width: Math.max(120, titleW), align: "left" });

    doc
      .fillColor(COLORS.muted)
      .font("Helvetica")
      .fontSize(10)
      .text("Operations Hub", titleX, titleY + (compact ? 18 : 24), {
        width: Math.max(120, titleW),
        align: "left",
      });

    // Divider line
    const lineY = headerTop + headerH;
    doc
      .moveTo(mL, lineY)
      .lineTo(pageW - mR, lineY)
      .lineWidth(1)
      .strokeColor(COLORS.border)
      .stroke();

    doc.y = lineY + 14;
  }

  function ensureSpace(neededHeight, { onNewPage } = {}) {
    const bottomY = pageH - mB;
    if (doc.y + neededHeight <= bottomY) return;
    doc.addPage();
    drawPageHeader({ compact: true });
    if (typeof onNewPage === "function") onNewPage();
  }

  // ======== Header (page 1) ========
  drawPageHeader({ compact: false });

  // ======== Meta small table ========
  const metaX = mL;
  const metaY = doc.y;
  const metaW = contentW;
  const metaRowH = 30;
  const metaH = metaRowH * 2;
  const metaColW = metaW / 2;

  doc.roundedRect(metaX, metaY, metaW, metaH, 8).lineWidth(1).strokeColor(COLORS.border).stroke();
  // inner lines
  doc.moveTo(metaX + metaColW, metaY).lineTo(metaX + metaColW, metaY + metaH).strokeColor(COLORS.border).stroke();
  doc.moveTo(metaX, metaY + metaRowH).lineTo(metaX + metaW, metaY + metaRowH).strokeColor(COLORS.border).stroke();

  function drawMetaCell(label, value, x, y, w) {
    const padX = 10;
    doc
      .fillColor(COLORS.muted)
      .font("Helvetica")
      .fontSize(9)
      .text(label, x + padX, y + 6, { width: w - padX * 2, align: "left" });
    doc
      .fillColor(COLORS.text)
      .font("Helvetica-Bold")
      .fontSize(11)
      .text(value || "—", x + padX, y + 16, { width: w - padX * 2, align: "left" });
  }

  drawMetaCell("Order ID", String(orderId || "—"), metaX, metaY, metaColW);
  drawMetaCell("Date", formatDateTime(createdAt), metaX + metaColW, metaY, metaColW);
  drawMetaCell("Team member", String(teamMember || "—"), metaX, metaY + metaRowH, metaColW);
  drawMetaCell("Prepared by (Operations)", String(preparedBy || "—"), metaX + metaColW, metaY + metaRowH, metaColW);

  doc.y = metaY + metaH + 18;

  // ======== Items table ========
  const tableX = mL;
  const tableW = contentW;
  const headerH = 26;
  const cellPadX = 8;

  // column widths (sum == tableW)
  const colWComponent = Math.round(tableW * 0.40);
  const colWReason = Math.round(tableW * 0.22);
  const colWQty = Math.round(tableW * 0.10);
  const colWUnit = Math.round(tableW * 0.14);
  const colWTotal = tableW - colWComponent - colWReason - colWQty - colWUnit;

  const columns = [
    { key: "component", label: "Component", width: colWComponent, align: "left" },
    { key: "reason", label: "Reason", width: colWReason, align: "left" },
    { key: "qty", label: "Qty", width: colWQty, align: "right" },
    { key: "unit", label: "Unit", width: colWUnit, align: "right" },
    { key: "total", label: "Total", width: colWTotal, align: "right" },
  ];

  let accX = tableX;
  columns.forEach((c) => {
    c.x = accX;
    accX += c.width;
  });

  function drawTableHeader() {
    const y = doc.y;
    // background
    doc.rect(tableX, y, tableW, headerH).fill(COLORS.headerBg);

    // outer border (top/left/right)
    doc
      .rect(tableX, y, tableW, headerH)
      .lineWidth(1)
      .strokeColor(COLORS.border)
      .stroke();

    // labels
    doc.fillColor(COLORS.text).font("Helvetica-Bold").fontSize(10);
    columns.forEach((c) => {
      doc.text(c.label, c.x + cellPadX, y + 8, {
        width: c.width - cellPadX * 2,
        align: c.align,
      });
    });

    // bottom line
    doc
      .moveTo(tableX, y + headerH)
      .lineTo(tableX + tableW, y + headerH)
      .lineWidth(1)
      .strokeColor(COLORS.border)
      .stroke();

    doc.y = y + headerH;
  }

  drawTableHeader();

  doc.font("Helvetica").fontSize(10).fillColor(COLORS.text);

  safeRows.forEach((r, idx) => {
    const rowData = {
      component: String(r.component || ""),
      reason: String(r.reason || ""),
      qty: String(Number(r.qty) || 0),
      unit: moneyGBP(r.unit),
      total: moneyGBP(r.total),
    };

    const hComponent = doc.heightOfString(rowData.component, { width: colWComponent - cellPadX * 2 });
    const hReason = doc.heightOfString(rowData.reason, { width: colWReason - cellPadX * 2 });
    const rowH = Math.max(20, hComponent, hReason) + 8;

    ensureSpace(rowH + 6, {
      onNewPage: () => {
        drawTableHeader();
      },
    });

    const y = doc.y;

    // zebra background
    if (idx % 2 === 0) {
      doc.rect(tableX, y, tableW, rowH).fill(COLORS.zebra);
      doc.fillColor(COLORS.text);
    }

    // vertical lines
    doc.lineWidth(0.6).strokeColor(COLORS.border);
    // left / right borders
    doc.moveTo(tableX, y).lineTo(tableX, y + rowH).stroke();
    doc.moveTo(tableX + tableW, y).lineTo(tableX + tableW, y + rowH).stroke();
    for (let i = 1; i < columns.length; i++) {
      doc.moveTo(columns[i].x, y).lineTo(columns[i].x, y + rowH).stroke();
    }
    // row bottom line
    doc.moveTo(tableX, y + rowH).lineTo(tableX + tableW, y + rowH).stroke();

    // text
    doc.fillColor(COLORS.text).font("Helvetica").fontSize(10);
    columns.forEach((c) => {
      doc.text(rowData[c.key], c.x + cellPadX, y + 6, {
        width: c.width - cellPadX * 2,
        align: c.align,
      });
    });

    doc.y = y + rowH;
  });

  // ======== Totals summary ========
  ensureSpace(90);
  doc.y += 14;

  const sumW = 220;
  const sumH = 54;
  const sumX = mL + contentW - sumW;
  const sumY = doc.y;

  doc.roundedRect(sumX, sumY, sumW, sumH, 10).lineWidth(1).strokeColor(COLORS.border).stroke();

  doc.fillColor(COLORS.muted).font("Helvetica").fontSize(9);
  doc.text("Total quantity", sumX + 12, sumY + 10, { width: sumW - 24, align: "left" });
  doc.text("Grand total", sumX + 12, sumY + 30, { width: sumW - 24, align: "left" });

  doc.fillColor(COLORS.text).font("Helvetica-Bold").fontSize(11);
  doc.text(String(Number(grandQty) || 0), sumX + 12, sumY + 8, { width: sumW - 24, align: "right" });
  doc.text(moneyGBP(grandTotal), sumX + 12, sumY + 28, { width: sumW - 24, align: "right" });

  doc.y = sumY + sumH + 24;

  // ======== Signatures (fixed layout) ========
  const sigTitleH = 22;
  const sigBoxesH = 120;
  const sigBlockH = sigTitleH + 14 + 6 + sigBoxesH + 10;

  // If we don't have enough room, move signatures to a new page (with a compact header)
  // then push them near the bottom of that page.
  ensureSpace(sigBlockH);

  // If there is a lot of empty space, push signatures down so they sit near the bottom
  // (but still within margins).
  const bottomY = pageH - mB;
  const desiredStart = bottomY - sigBlockH;
  if (doc.y < desiredStart) doc.y = desiredStart;

  doc.fillColor(COLORS.text).font("Helvetica-Bold").fontSize(12);
  doc.text("Handover confirmation", mL, doc.y, { width: contentW, align: "left" });
  doc.y += 14;

  const gap = 16;
  const boxW = (contentW - gap) / 2;
  const boxH = sigBoxesH;
  const boxY = doc.y + 6;
  const leftX = mL;
  const rightX = mL + boxW + gap;

  function drawSignatureBox(title, x, y) {
    doc.roundedRect(x, y, boxW, boxH, 10).lineWidth(1).strokeColor(COLORS.border).stroke();
    doc.fillColor(COLORS.text).font("Helvetica-Bold").fontSize(10);
    doc.text(title, x + 12, y + 10, { width: boxW - 24, align: "left" });

    const lineStartX = x + 12;
    const lineEndX = x + boxW - 12;

    doc.fillColor(COLORS.muted).font("Helvetica").fontSize(9);
    doc.text("Name", lineStartX, y + 34);
    doc
      .moveTo(lineStartX + 40, y + 45)
      .lineTo(lineEndX, y + 45)
      .lineWidth(1)
      .strokeColor(COLORS.border)
      .stroke();

    doc.text("Signature", lineStartX, y + 58);
    doc
      .moveTo(lineStartX + 55, y + 69)
      .lineTo(lineEndX, y + 69)
      .lineWidth(1)
      .strokeColor(COLORS.border)
      .stroke();

    doc.text("Date", lineStartX, y + 82);
    doc
      .moveTo(lineStartX + 30, y + 93)
      .lineTo(lineStartX + 95, y + 93)
      .lineWidth(1)
      .strokeColor(COLORS.border)
      .stroke();
    doc.fillColor(COLORS.muted).font("Helvetica").fontSize(9).text("/", lineStartX + 102, y + 84);
    doc
      .moveTo(lineStartX + 110, y + 93)
      .lineTo(lineStartX + 175, y + 93)
      .lineWidth(1)
      .strokeColor(COLORS.border)
      .stroke();
    doc.fillColor(COLORS.muted).font("Helvetica").fontSize(9).text("/", lineStartX + 182, y + 84);
    doc
      .moveTo(lineStartX + 190, y + 93)
      .lineTo(lineEndX, y + 93)
      .lineWidth(1)
      .strokeColor(COLORS.border)
      .stroke();
  }

  drawSignatureBox("Delivered to", leftX, boxY);
  drawSignatureBox("Operations", rightX, boxY);

  doc.y = boxY + boxH + 10;

  doc.end();
}

module.exports = {
  pipeDeliveryReceiptPDF,
};
