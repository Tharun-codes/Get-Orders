// Change line 2 from require to import:
import express from 'express';
import cors from "cors";
import { Pool } from "pg";
import dotenv from "dotenv";
import PDFDocument from "pdfkit";
import dayjs from "dayjs";
import { fileURLToPath } from "node:url";

dotenv.config();

const PUBLIC_DIR = fileURLToPath(new URL("./public/", import.meta.url));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(PUBLIC_DIR));
app.get(["/", "/generate_bill.html"], (req, res) => {
  res.sendFile("generate_bill.html", { root: PUBLIC_DIR });
});

const PORT = process.env.PORT || 3000;

/* helper: safeNumber */
function safeNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/* ============================================================
   GENERATE BILL
============================================================ */
app.post("/api/generate-bill", async (req, res) => {
  const { name, phone, alt_phone, address, rent_start, rent_end, items } = req.body || {};
  if (!name || !phone || !address) {
    return res.status(400).json({ success: false, error: "Missing required fields (name, phone, address)" });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ success: false, error: "No product items found" });
  }

  const billItems = items.map((item) => ({
    product: String(item.product || "").trim(),
    price: safeNumber(item.price),
    quantity: safeNumber(item.quantity),
  }));
  if (billItems.some((item) => !item.product || item.price <= 0 || !Number.isInteger(item.quantity) || item.quantity <= 0)) {
    return res.status(400).json({ success: false, error: "Each item needs a product, positive price, and positive whole-number quantity" });
  }

  const start = rent_start ? dayjs(rent_start) : null;
  const end = rent_end ? dayjs(rent_end) : null;
  if ((start && !start.isValid()) || (end && !end.isValid())) {
    return res.status(400).json({ success: false, error: "Invalid rent date" });
  }
  const daysCount = start && end ? Math.max(1, end.diff(start, "day") + 1) : 1;
  const perDayTotal = billItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const grandTotal = perDayTotal * daysCount;
  const safeName = String(name).trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, "").replace(/[. ]+$/g, "") || "customer";
  const fallbackName = safeName.replace(/[^\x20-\x7E]/g, "_");
  const encodedName = encodeURIComponent(safeName).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

  const doc = new PDFDocument({ size: "A4", margin: 40 });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${fallbackName}.pdf"; filename*=UTF-8''${encodedName}.pdf`);
  doc.on("error", (err) => {
    console.error("PDF GENERATION ERROR:", err);
    if (!res.headersSent) res.status(500).end("PDF Error");
    else res.destroy(err);
  });
  doc.pipe(res);

  const teal = "#006666";
  const pageWidth = doc.page.width - 80;
  doc.fontSize(12).fillColor(teal).text("9916067960, 8073024022", 40, 30);
  doc.fontSize(26).fillColor(teal).text("SUBRAMANI ENTERPRISES", 0, 60, { align: "center" });
  doc.moveTo(40, 95).lineTo(550, 95).lineWidth(2).strokeColor(teal).stroke();

  doc.font("Helvetica").fontSize(12).fillColor("#000");
  let y = 125;
  doc.text(`DATE: ${dayjs().format("DD/MM/YYYY")}`, 40, y, { width: pageWidth, align: "center" });
  y += 24;
  doc.font("Helvetica-Bold");
  doc.text(`CUSTOMER NAME: ${name}`, 40, y, { width: pageWidth, align: "center" });
  doc.font("Helvetica");
  y += 24;
  doc.text(`PHONE: ${phone}${alt_phone ? ` / ${alt_phone}` : ""}`, 40, y, { width: pageWidth, align: "center" });
  y += 24;
  doc.text(`ADDRESS: ${address}`, 40, y, { width: pageWidth, align: "center" });
  y = doc.y + 16;
  const rentStart = start ? start.format("DD/MM/YYYY") : "-";
  const rentEnd = end ? end.format("DD/MM/YYYY") : "-";
  doc.font("Helvetica-Bold");
  doc.text(`RENT: ${rentStart} - ${rentEnd} (${daysCount} day${daysCount === 1 ? "" : "s"})`, 40, y, { width: pageWidth, align: "center" });
  doc.font("Helvetica");

  y = doc.y + 30;
  const drawTableHeader = (top) => {
    doc.font("Helvetica-Bold").fontSize(11).fillColor(teal);
    doc.text("DESCRIPTION", 40, top);
    doc.text("PRICE", 260, top);
    doc.text("QTY", 340, top);
    doc.text("RATE/DAY", 390, top);
    doc.text("AMOUNT", 465, top);
    doc.moveTo(40, top + 16).lineTo(550, top + 16).strokeColor(teal).stroke();
    doc.font("Helvetica").fontSize(10).fillColor("#000");
  };
  drawTableHeader(y);
  y += 28;

  for (const item of billItems) {
    if (y + 45 > doc.page.height - 60) {
      doc.addPage();
      y = 40;
      drawTableHeader(y);
      y += 28;
    }
    const amount = item.price * item.quantity * daysCount;
    doc.text(item.product.toUpperCase(), 40, y, { width: 200 });
    doc.text(item.price.toFixed(2), 260, y);
    doc.text(String(item.quantity), 340, y);
    doc.text(`${(item.price * item.quantity).toFixed(2)} x ${daysCount}`, 390, y, { width: 65 });
    doc.text(`Rs. ${amount.toFixed(2)}`, 465, y);
    y += 28;
    doc.moveTo(40, y).lineTo(550, y).strokeColor("#ddd").stroke();
    y += 10;
  }

  if (y + 95 > doc.page.height - 60) {
    doc.addPage();
    y = 50;
  }
  y += 15;
  doc.font("Helvetica-Bold").fontSize(11).fillColor(teal).text("PRICE CALCULATION SUMMARY", 40, y);
  y += 20;
  doc.font("Helvetica").fontSize(10).fillColor("#000");
  doc.text(`Products total per day: Rs. ${perDayTotal.toFixed(2)}`, 40, y);
  y += 16;
  doc.text(`Number of days: ${daysCount}`, 40, y);
  y += 20;
  doc.font("Helvetica-Bold").fontSize(14).fillColor(teal).text(`TOTAL: Rs. ${grandTotal.toFixed(2)}`, 40, y);
  doc.moveDown(3);
  doc.font("Helvetica").fontSize(9).fillColor(teal).text(
    "5TH CROSS, CHANNEL RIGHT SIDE, VENKATESHA NAGAR, SHIMOGA | 577202 | PHONE: 6363499137",
    { align: "center" }
  );
  doc.moveDown(1);
  doc.font("Helvetica-Bold").fontSize(11).fillColor(teal).text("THANK YOU FOR YOUR BUSINESS!", { align: "center" });
  doc.end();
});

/* ============================================================
   3) SEARCH CUSTOMERS
   ============================================================ */
app.get("/api/customers", async (req, res) => {
  try {
    const { q } = req.query;
    let sql = `SELECT id, name, phone, alt_phone, address, rent_status FROM customers`;
    const params = [];
    if (q) {
      sql += ` WHERE name ILIKE $1 OR phone ILIKE $1 OR alt_phone ILIKE $1`;
      params.push(`%${q}%`);
    }
    sql += ` ORDER BY id DESC`;
    const r = await pool.query(sql, params);
    res.json({ success: true, rows: r.rows });
  } catch (err) {
    console.error("SEARCH CUSTOMERS ERROR:", err);
    res.status(503).json({ success: false, error: "Customer search is unavailable. Enter the customer details manually." });
  }
});

/* ============================================================
   PDF invoice endpoint
============================================================ */
app.get("/api/invoice/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;
    const orderQ = await pool.query(
      `SELECT o.*, c.name AS cname, c.phone AS cphone, c.address AS caddress
       FROM orders o JOIN customers c ON o.customer_id = c.id
       WHERE o.id=$1 LIMIT 1`,
      [orderId]
    );
    if (!orderQ.rows.length) return res.status(404).send("Order not found");
    const order = orderQ.rows[0];

    const itemsQ = await pool.query(
      `SELECT * FROM order_items WHERE order_id=$1 ORDER BY id ASC`,
      [orderId]
    );

    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const filename = `invoice-${order.invoice_no || orderId}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    doc.pipe(res);

    const teal = "#006666";

    // Header text (phones, title)
    doc.fontSize(12).fillColor(teal).text("9916067960, 8073024022", 40, 30);

    // Title with underline (centered)
    doc.fontSize(26).fillColor(teal).text("SUBRAMANI ENTERPRISES", 0, 60, {
      align: "center",
    });

    // Draw underline under title (across the page)
    doc
      .moveTo(40, 95)
      .lineTo(550, 95)
      .lineWidth(2)
      .strokeColor(teal)
      .stroke();

    // Customer / order info
    let cy = 130;
    doc.font("Helvetica").fontSize(12).fillColor("#000");
    doc.text(
      `DATE: ${dayjs(order.order_date).format("DD/MM/YYYY")}`,
      0,
      cy,
      { align: "center" }
    );
    cy += 25;
    doc.font("Helvetica-Bold");
    doc.text(`CUSTOMER NAME: ${order.cname}`, 0, cy, { align: "center" });
    doc.font("Helvetica");
    cy += 25;
    doc.text(`PHONE: ${order.cphone}`, 0, cy, { align: "center" });
    cy += 25;
    doc.text(`ADDRESS: ${order.caddress}`, 0, cy, { align: "center" });
    cy += 25;

    // NEW: Rent Start - End line (centered)
    const rentStartStr = order.rent_start
      ? dayjs(order.rent_start).format("DD/MM/YYYY")
      : "-";
    const rentEndStr = order.rent_end
      ? dayjs(order.rent_end).format("DD/MM/YYYY")
      : "-";
    // Calculate number of days
    let daysCount = 1;
    if (order.rent_start && order.rent_end) {
      const start = dayjs(order.rent_start);
      const end = dayjs(order.rent_end);
      const diff = end.diff(start, "day") + 1;
      daysCount = diff > 0 ? diff : 1;
    }

    // Show Rent + Days
    doc.font("Helvetica-Bold");
    doc.text(
      `RENT: ${rentStartStr} - ${rentEndStr} (${daysCount} Day${daysCount > 1 ? "s" : ""})`,
      0,
      cy,
      { align: "center" }
    );
    doc.font("Helvetica");


    // Table header
    let tableTop = doc.y + 30;
    doc.font("Helvetica-Bold").fontSize(11).fillColor(teal);
    doc.text("DESCRIPTION", 40, tableTop);
    doc.text("PRICE", 260, tableTop);
    doc.text("QTY", 340, tableTop);
    doc.text("RATE/DAY", 390, tableTop);
    doc.text("AMOUNT", 465, tableTop);
    doc
      .moveTo(40, tableTop + 15)
      .lineTo(550, tableTop + 15)
      .strokeColor(teal)
      .stroke();

    // Table rows
    doc.font("Helvetica").fontSize(10).fillColor("#000");
    let y = tableTop + 25;
    let grand = 0;
    for (const it of itemsQ.rows) {
      const price = safeNumber(it.price);
      const qty = safeNumber(it.quantity);
      const perDayAmount = safeNumber(it.line_total) || (price * qty);
      const amount = perDayAmount * daysCount;

      // If next row exceeds current page space, start new page & redraw header
      if (y + 50 > doc.page.height - 60) {
        doc.addPage();

        // reset y position
        y = 40;

        // redraw table headers on new page
        doc.font("Helvetica-Bold").fontSize(11).fillColor(teal);
        doc.text("DESCRIPTION", 40, y);
        doc.text("PRICE", 260, y);
        doc.text("QTY", 340, y);
        doc.text("RATE/DAY", 390, y);
        doc.text("AMOUNT", 465, y);

        doc
          .moveTo(40, y + 15)
          .lineTo(550, y + 15)
          .strokeColor(teal)
          .stroke();

        y += 25;
        doc.font("Helvetica").fontSize(10).fillColor("#000");
      }

      // print row
      doc.text(String(it.product).toUpperCase(), 40, y, { width: 200 });
      doc.text(price.toFixed(2), 260, y);
      doc.text(String(qty), 340, y);
      doc.text(`${perDayAmount.toFixed(2)} x ${daysCount}`, 390, y, { width: 65 });
      doc.text(amount.toFixed(2), 465, y);

      // breakdown
      doc.fontSize(8).fillColor("#555")
        .text(`(${price} × ${qty} × ${daysCount})`, 465, y + 10);

      doc.fontSize(10).fillColor("#000");

      grand += amount;
      y += 22;

      // row bottom line
      doc
        .moveTo(40, y)
        .lineTo(550, y)
        .strokeColor("#ddd")
        .stroke();

      y += 8;

      // Summary breakdown section
      // After loop ends, before drawing total box
      y += 20;
      doc.font("Helvetica-Bold").fontSize(11).fillColor(teal)
        .text("PRICE CALCULATION SUMMARY", 40, y);
      y += 18;

      doc.font("Helvetica").fontSize(10).fillColor("#000")
      doc.text(`Products Total (Per-day): ₹ ${(price * qty).toFixed(2)}`, 40, y);
      y += 16;

      doc.text(`Number of days: ${daysCount}`, 40, y);
      y += 16;

      doc.text(`Final Total: ₹ ${amount.toFixed(2)}`, 40, y);

      y += 30;

      // reset
      doc.fontSize(10).fillColor("#000");


      doc
        .moveTo(40, y)
        .lineTo(550, y)
        .strokeColor("#ddd")
        .stroke();
    }

    // Total box
    y += 30;
    doc.strokeColor(teal).rect(350, y, 200, 50).stroke();
    doc
      .font("Helvetica-Bold")
      .fontSize(13)
      .fillColor(teal)
      .text("TOTAL", 360, y + 8);
    doc
      .fontSize(16)
      .fillColor(teal)
      .text(`₹ ${grand.toFixed(2)}`, 360, y + 28);

    // Footer
    doc.moveDown(4);
    doc
      .font("Helvetica")
      .fontSize(10)
      .fillColor(teal)
      .text(
        "5TH CROSS, CHANNEL RIGHT SIDE, VENKATESHA NAGAR, SHIMOGA | 577202 | PHONE: 6363499137",
        { align: "center" }
      );
    doc.moveDown(1);
    doc
      .font("Helvetica-Bold")
      .fontSize(11)
      .fillColor(teal)
      .text("THANK YOU FOR YOUR BUSINESS!", { align: "center" });
    doc.end();
  } catch (err) {
    console.error("🔥 PDF ERROR:", err);
    if (!res.headersSent) res.status(500).send("PDF Error");
  }
});
/* ============================================================
   START SERVER
============================================================ */
app.listen(PORT, "0.0.0.0", () => {
  console.clear();
  console.log("======================================");
  console.log("🚀 SERVER IS RUNNING");
  console.log(`➡️  http://localhost:${PORT}`);
  console.log("======================================");
});