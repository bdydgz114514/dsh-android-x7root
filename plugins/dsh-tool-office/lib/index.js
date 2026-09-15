/**
 * dsh-tool-office — 内置纯 JS Office 文档引擎（不依赖任何外部 App）。
 *
 * 依赖随 APK 打包：mammoth / docx / exceljs / pptxgenjs / pdf-lib / pdfjs-dist / jszip / fast-xml-parser。
 * 支持读取：.docx .xlsx .xlsm .csv .pptx .pdf .odt .ods .odp .md .txt .html .json
 * 支持创建：.docx .xlsx .csv .pptx .pdf .md .txt .html .json
 * 支持编辑：.xlsx/.csv 单元格与行、.pdf 追加页/标题、.docx 纯文本替换
 *
 * 注意：DSH 工具输出 schema 为 additionalProperties:false，execute 返回的每个字段都必须声明。
 */
import { defineTool } from "@deepseek-ai/dsh-tools";
import { promises as fsp } from "node:fs";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
import { createRequire } from "node:module";

import mammoth from "mammoth";
import {
  Document, Packer, Paragraph, HeadingLevel,
  Table, TableRow, TableCell, WidthType
} from "docx";
import ExcelJS from "exceljs";
import pptxgen from "pptxgenjs";
import { PDFDocument, StandardFonts } from "pdf-lib";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

const name = "tool-office";
const inject = ["tools"];

const require = createRequire(import.meta.url);
const workspace = () => process.env.DSH_WORKSPACE || process.cwd();

function absPath(p) {
  if (typeof p !== "string" || p.trim() === "") throw new Error("path 必填");
  const t = p.trim();
  return isAbsolute(t) ? t : resolve(workspace(), t);
}
function extOf(p) {
  const i = p.lastIndexOf(".");
  return i < 0 ? "" : p.slice(i).toLowerCase();
}
async function readBuf(p) { return await fsp.readFile(absPath(p)); }
async function writeBuf(p, buf) {
  const f = absPath(p);
  await fsp.mkdir(dirname(f), { recursive: true });
  await fsp.writeFile(f, buf);
  return f;
}
function clip(s, max) {
  const t = typeof s === "string" ? s : String(s == null ? "" : s);
  if (!max || t.length <= max) return { text: t, truncated: false };
  return { text: t.slice(0, max), truncated: true };
}

/* ---------------- readers ---------------- */

async function readDocx(buf) {
  try {
    const md = await mammoth.convertToMarkdown({ buffer: buf });
    if (md && typeof md.value === "string" && md.value.trim() !== "") return md.value;
  } catch (e) { /* fall through */ }
  const raw = await mammoth.extractRawText({ buffer: buf });
  return raw && raw.value ? raw.value : "";
}

function cellText(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    if (v instanceof Date) return v.toISOString();
    if (Array.isArray(v.richText)) return v.richText.map((r) => (r && r.text) || "").join("");
    if (v.formula !== undefined) return "=" + String(v.formula);
    if (v.result !== undefined) return String(v.result);
    if (v.text !== undefined) return String(v.text);
    if (v.hyperlink !== undefined) return String(v.text || v.hyperlink);
    try { return JSON.stringify(v); } catch (e) { return String(v); }
  }
  return String(v);
}

async function readXlsx(buf, onlySheet) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const out = [];
  wb.eachSheet((ws) => {
    if (onlySheet && ws.name !== onlySheet) return;
    out.push("## Sheet: " + ws.name + " (" + ws.rowCount + " 行 x " + ws.columnCount + " 列)");
    ws.eachRow({ includeEmpty: false }, (row, rowNo) => {
      const cells = [];
      row.eachCell({ includeEmpty: true }, (cell) => { cells.push(cellText(cell.value)); });
      out.push(rowNo + ": " + cells.join(" | "));
    });
  });
  return out.join("\n");
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQ = false;
  const s = String(text == null ? "" : text);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else { inQ = false; }
      } else { field += c; }
      continue;
    }
    if (c === '"') { inQ = true; continue; }
    if (c === ",") { row.push(field); field = ""; continue; }
    if (c === "\r") continue;
    if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    field += c;
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}
function csvCell(v) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.split('"').join('""') + '"' : s;
}
function toCsv(rows) {
  return rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}

function collectText(node, out) {
  if (node === null || node === undefined) return;
  if (typeof node === "string") { const t = node.trim(); if (t !== "") out.push(t); return; }
  if (Array.isArray(node)) { for (const x of node) collectText(x, out); return; }
  if (typeof node === "object") {
    for (const k of Object.keys(node)) {
      if (k === "a:t" || k === "t" || k === "#text" || k === "text:p" || k === "text:span") collectText(node[k], out);
      else collectText(node[k], out);
    }
  }
}
function slideNo(n) { const m = /slide(\d+)\.xml$/.exec(n); return m ? Number(m[1]) : 0; }

async function readZipXmlText(buf, entry, filter) {
  const zip = await JSZip.loadAsync(buf);
  const parser = new XMLParser({ ignoreAttributes: false, textNodeName: "#text" });
  let names = Object.keys(zip.files).filter((n) => (filter ? filter(n) : n === entry));
  if (entry && names.length === 0 && zip.file(entry)) names = [entry];
  if (entry && filter === undefined) names = [entry];
  names.sort((a, b) => slideNo(a) - slideNo(b));
  const out = [];
  for (const n of names) {
    const f = zip.file(n);
    if (!f) continue;
    const xml = await f.async("string");
    const doc = parser.parse(xml);
    const texts = [];
    collectText(doc, texts);
    if (names.length > 1) out.push("## " + n);
    out.push(texts.join("\n"));
  }
  return out.join("\n");
}

async function readPdf(buf) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  let standardFontDataUrl;
  try {
    const pkg = require.resolve("pdfjs-dist/package.json");
    standardFontDataUrl = join(dirname(pkg), "standard_fonts") + "/";
  } catch (e) { /* optional */ }
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true, standardFontDataUrl }).promise;
  const parts = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    parts.push("## Page " + i);
    parts.push(tc.items.map((it) => (it && it.str) || "").join(" "));
  }
  return parts.join("\n");
}

function kindOf(ext) {
  if (ext === ".docx") return "docx";
  if (ext === ".xlsx" || ext === ".xlsm") return "xlsx";
  if (ext === ".csv") return "csv";
  if (ext === ".pptx") return "pptx";
  if (ext === ".pdf") return "pdf";
  if (ext === ".odt" || ext === ".ods" || ext === ".odp") return "odf";
  if (ext === ".md" || ext === ".markdown") return "markdown";
  if (ext === ".html" || ext === ".htm") return "html";
  if (ext === ".json") return "json";
  if (ext === ".doc" || ext === ".xls" || ext === ".ppt") return "legacy-office";
  return "text";
}

async function readAny(path) {
  const f = absPath(path);
  const ext = extOf(f);
  const kind = kindOf(ext);
  const buf = await readBuf(f);
  if (kind === "docx") return { kind, text: await readDocx(buf) };
  if (kind === "xlsx") return { kind, text: await readXlsx(buf) };
  if (kind === "csv") return { kind, text: await readXlsxCsvFallback(buf) };
  if (kind === "pptx") return { kind, text: await readZipXmlText(buf, undefined, (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)) };
  if (kind === "pdf") return { kind, text: await readPdf(buf) };
  if (kind === "odf") return { kind, text: await readZipXmlText(buf, "content.xml") };
  return { kind, text: clip(buf.toString("utf8"), 2000000).text };
}
async function readXlsxCsvFallback(buf) { return parseCsv(buf.toString("utf8")).map((r, i) => (i + 1) + ": " + r.join(" | ")).join("\n"); }

/* ---------------- writers ---------------- */

function docxChildren(args) {
  const children = [];
  if (args.title) children.push(new Paragraph({ text: String(args.title), heading: HeadingLevel.TITLE }));
  const blocks = Array.isArray(args.blocks) ? args.blocks : [];
  if (blocks.length === 0 && typeof args.text === "string" && args.text !== "") {
    for (const line of args.text.split("\n")) {
      if (line.trim() === "") { children.push(new Paragraph({ text: "" })); continue; }
      if (line.indexOf("# ") === 0) children.push(new Paragraph({ text: line.slice(2), heading: HeadingLevel.HEADING_1 }));
      else if (line.indexOf("## ") === 0) children.push(new Paragraph({ text: line.slice(3), heading: HeadingLevel.HEADING_2 }));
      else if (line.indexOf("- ") === 0) children.push(new Paragraph({ text: line.slice(2), bullet: { level: 0 } }));
      else children.push(new Paragraph({ text: line }));
    }
  }
  for (const b of blocks) {
    if (!b || typeof b !== "object") continue;
    const t = String(b.type || "paragraph");
    if (t === "heading") {
      const lvl = Number(b.level || 1);
      const h = lvl <= 1 ? HeadingLevel.HEADING_1 : (lvl === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3);
      children.push(new Paragraph({ text: String(b.text || ""), heading: h }));
    } else if (t === "bullet") {
      children.push(new Paragraph({ text: String(b.text || ""), bullet: { level: 0 } }));
    } else if (t === "table") {
      const rows = Array.isArray(b.rows) ? b.rows : [];
      const trs = rows.map((r) => new TableRow({
        children: (Array.isArray(r) ? r : [r]).map((c) => new TableCell({
          children: [new Paragraph({ text: c === null || c === undefined ? "" : String(c) })]
        }))
      }));
      if (trs.length > 0) children.push(new Table({ rows: trs, width: { size: 100, type: WidthType.PERCENTAGE } }));
    } else {
      children.push(new Paragraph({ text: String(b.text || "") }));
    }
  }
  if (children.length === 0) children.push(new Paragraph({ text: "" }));
  return children;
}
async function writeDocx(path, args) {
  const doc = new Document({ sections: [{ children: docxChildren(args) }] });
  const buf = await Packer.toBuffer(doc);
  return await writeBuf(path, buf);
}
async function writeXlsx(path, args) {
  const wb = new ExcelJS.Workbook();
  let sheets = Array.isArray(args.sheets) ? args.sheets : [];
  if (sheets.length === 0) sheets = [{ name: "Sheet1", rows: parseCsv(typeof args.text === "string" ? args.text : "") }];
  for (const s of sheets) {
    const ws = wb.addWorksheet(String((s && s.name) || ("Sheet" + (wb.worksheets.length + 1))));
    const rows = Array.isArray(s && s.rows) ? s.rows : [];
    for (const r of rows) {
      const arr = Array.isArray(r) ? r : [r];
      ws.addRow(arr.map((c) => (c && typeof c === "object" && typeof c.f === "string" ? { formula: c.f, result: c.r } : c)));
    }
    if (s && Array.isArray(s.widths)) s.widths.forEach((w, i) => { ws.getColumn(i + 1).width = Number(w) || 12; });
  }
  return await writeBuf(path, Buffer.from(await wb.xlsx.writeBuffer()));
}
async function writeCsv(path, args) {
  let rows = null;
  if (Array.isArray(args.sheets) && args.sheets.length > 0 && Array.isArray(args.sheets[0].rows)) rows = args.sheets[0].rows;
  if (rows === null && typeof args.text === "string") rows = parseCsv(args.text);
  const text = toCsv(Array.isArray(rows) ? rows : []);
  return await writeBuf(path, Buffer.from(text, "utf8"));
}
async function writePptx(path, args) {
  const pptx = new pptxgen();
  pptx.layout = "LAYOUT_WIDE";
  let slides = Array.isArray(args.slides) ? args.slides : [];
  if (slides.length === 0) {
    const lines = typeof args.text === "string" ? args.text.split("\n") : [];
    slides = [];
    for (let i = 0; i < lines.length; i += 8) slides.push({ title: (args.title || "Slide " + (slides.length + 1)), bullets: lines.slice(i, i + 8) });
  }
  if (slides.length === 0) slides = [{ title: String(args.title || "Slide 1"), bullets: [] }];
  if (args.title && slides.length > 0 && !slides[0].title) slides[0].title = String(args.title);
  for (const s of slides) {
    const slide = pptx.addSlide();
    const title = String((s && s.title) || "");
    if (title) slide.addText(title, { x: 0.5, y: 0.4, w: 12.3, h: 0.9, fontSize: 28, bold: true, color: "1B2A41" });
    const bullets = Array.isArray(s && s.bullets) ? s.bullets : [];
    if (bullets.length > 0) {
      slide.addText(bullets.map((b) => ({ text: String(b), options: { bullet: true, breakLine: true } })), { x: 0.7, y: 1.5, w: 12.0, h: 5.3, fontSize: 16, color: "333333" });
    }
    if (s && s.notes) slide.addNotes(String(s.notes));
  }
  const f = absPath(path);
  await fsp.mkdir(dirname(f), { recursive: true });
  await pptx.writeFile({ fileName: f });
  return f;
}
async function writePdf(path, args) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  let pages = Array.isArray(args.pages) ? args.pages : null;
  if (pages === null) {
    const lines = typeof args.text === "string" ? args.text.split("\n") : [];
    pages = [];
    for (let i = 0; i < lines.length; i += 46) pages.push({ lines: lines.slice(i, i + 46) });
    if (pages.length === 0) pages = [{ lines: [String(args.title || "")] }];
  }
  for (const p of pages) {
    const page = doc.addPage([595, 842]);
    const lines = Array.isArray(p && p.lines) ? p.lines : String((p && p.text) || "").split("\n");
    let y = 842 - 56;
    for (const raw of lines) {
      let rest = String(raw === null || raw === undefined ? "" : raw);
      while (rest.length > 0 && y > 56) {
        const chunk = rest.slice(0, 88);
        rest = rest.slice(88);
        try { page.drawText(chunk, { x: 52, y, size: 11, font }); } catch (e) { /* 非 Latin-1 字符无法用内置字体 */ }
        y -= 16;
      }
      if (y <= 56) break;
    }
  }
  return await writeBuf(path, Buffer.from(await doc.save()));
}
async function writeText(path, args) {
  let text = typeof args.text === "string" ? args.text : "";
  if (text === "" && args.blocks) text = JSON.stringify(args.blocks, null, 2);
  if (text === "" && args.sheets) text = toCsv(Array.isArray(args.sheets) && args.sheets[0] && Array.isArray(args.sheets[0].rows) ? args.sheets[0].rows : []);
  return await writeBuf(path, Buffer.from(text, "utf8"));
}

/* ---------------- edits ---------------- */

async function editXlsx(path, ops) {
  const f = absPath(path);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await fsp.readFile(f));
  let applied = 0;
  for (const op of ops) {
    if (!op || typeof op !== "object") continue;
    const ws = op.sheet !== undefined ? wb.getWorksheet(String(op.sheet)) : wb.worksheets[0];
    if (op.op === "addSheet") { wb.addWorksheet(String(op.name || "Sheet")); applied++; }
    else if (op.op === "deleteSheet") { const t = wb.getWorksheet(String(op.name)); if (t) { wb.removeWorksheet(t.id); applied++; } }
    else if (op.op === "set") { if (!ws) throw new Error("找不到工作表"); ws.getCell(String(op.cell)).value = op.value; applied++; }
    else if (op.op === "addRow") { if (!ws) throw new Error("找不到工作表"); ws.addRow(Array.isArray(op.row) ? op.row : [op.row]); applied++; }
    else if (op.op === "renameSheet") { if (ws) { ws.name = String(op.name || ws.name); applied++; } }
    else throw new Error("xlsx 不支持的 op: " + String(op.op));
  }
  await writeBuf(f, Buffer.from(await wb.xlsx.writeBuffer()));
  return applied;
}
async function editCsv(path, ops) {
  const f = absPath(path);
  let rows = parseCsv((await fsp.readFile(f)).toString("utf8"));
  let applied = 0;
  for (const op of ops) {
    if (!op || typeof op !== "object") continue;
    if (op.op === "set") {
      const m = /^([A-Za-z]+)(\d+)$/.exec(String(op.cell || ""));
      if (!m) throw new Error("cell 需形如 B3");
      const col = m[1].toUpperCase().split("").reduce((a, ch) => a * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
      const r = Number(m[2]) - 1;
      while (rows.length <= r) rows.push([]);
      while (rows[r].length <= col) rows[r].push("");
      rows[r][col] = op.value === null || op.value === undefined ? "" : op.value;
      applied++;
    } else if (op.op === "addRow") { rows.push(Array.isArray(op.row) ? op.row : [op.row]); applied++; }
    else throw new Error("csv 不支持的 op: " + String(op.op));
  }
  await writeBuf(f, Buffer.from(toCsv(rows), "utf8"));
  return applied;
}
async function editDocx(path, ops) {
  const f = absPath(path);
  const zip = await JSZip.loadAsync(await fsp.readFile(f));
  const doc = zip.file("word/document.xml");
  if (!doc) throw new Error("docx 缺少 word/document.xml");
  let xml = await doc.async("string");
  let applied = 0;
  for (const op of ops) {
    if (!op || op.op !== "replace") throw new Error("docx 仅支持 replace（结构性修改请用 office_write 重写）");
    const find = String(op.find || "");
    if (find === "") continue;
    const repl = op.replace === null || op.replace === undefined ? "" : String(op.replace);
    if (xml.indexOf(find) < 0) continue;
    xml = xml.split(find).join(repl);
    applied++;
  }
  zip.file("word/document.xml", xml);
  await writeBuf(f, await zip.generateAsync({ type: "nodebuffer" }));
  return applied;
}
async function editPdf(path, ops) {
  const f = absPath(path);
  const doc = await PDFDocument.load(await fsp.readFile(f));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  let applied = 0;
  for (const op of ops) {
    if (!op || typeof op !== "object") continue;
    if (op.op === "addPage") {
      const page = doc.addPage([595, 842]);
      const lines = Array.isArray(op.lines) ? op.lines : String(op.text || "").split("\n");
      let y = 842 - 56;
      for (const l of lines) {
        try { page.drawText(String(l === null || l === undefined ? "" : l).slice(0, 88), { x: 52, y, size: 11, font }); } catch (e) { /* 忽略非 Latin-1 */ }
        y -= 16;
        if (y < 56) break;
      }
      applied++;
    } else if (op.op === "setTitle") { doc.setTitle(String(op.value || "")); applied++; }
    else throw new Error("pdf 不支持的 op: " + String(op.op));
  }
  await writeBuf(f, Buffer.from(await doc.save()));
  return applied;
}

/* ---------------- tool plumbing ---------------- */

function freshSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      ok: { type: "boolean", required: true },
      error: { type: "string" },
      path: { type: "string" },
      kind: { type: "string" },
      text: { type: "string" },
      truncated: { type: "boolean" },
      bytes: { type: "number" },
      applied: { type: "number" },
      info: { type: "string" },
      note: { type: "string" }
    }
  };
}
function fmt(v) {
  if (!v || v.ok !== true) return "错误：" + ((v && v.error) || "unknown");
  if (typeof v.text === "string" && v.text !== "") return v.text + (v.truncated ? "\n…(已截断)" : "");
  const bits = [];
  if (v.path) bits.push("文件：" + v.path);
  if (v.kind) bits.push("类型：" + v.kind);
  if (typeof v.bytes === "number") bits.push("字节：" + v.bytes);
  if (typeof v.applied === "number") bits.push("已应用操作：" + v.applied);
  if (v.info) bits.push(v.info);
  if (v.note) bits.push(v.note);
  return bits.length > 0 ? bits.join("；") : "完成";
}
function out() { return { schema: freshSchema(), render: (_a, v) => [{ type: "text", text: fmt(v) }] }; }

function apply(ctx) {
  ctx.tools.register(defineTool({
    name: "office_read",
    description:
      "读取文档内容（纯本地解析，不调用任何外部 App）。支持 .docx（含表格，转 Markdown）、.xlsx/.xlsm（逐表逐行）、" +
      ".csv、.pptx（逐页文本）、.pdf（逐页文本）、.odt/.ods/.odp、.md/.txt/.html/.json。返回文本内容供你阅读与改写。",
    parameters: {
      path: { type: "string", required: true, description: "文件路径（相对 AI 工作区或绝对路径）" },
      maxChars: { type: "number", description: "最多返回字符数（默认 200000）" }
    },
    output: out(),
    async execute(args) {
      try {
        const r = await readAny(args.path);
        const c = clip(r.text, typeof args.maxChars === "number" && args.maxChars > 0 ? args.maxChars : 200000);
        return { ok: true, kind: r.kind, path: absPath(args.path), text: c.text, truncated: c.truncated };
      } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
    }
  }));

  ctx.tools.register(defineTool({
    name: "office_write",
    description:
      "创建/覆盖写文档（纯本地生成，不调用外部 App）。按扩展名选择引擎：.docx（blocks/text）、.xlsx（sheets）、" +
      ".csv（sheets[0].rows 或 text）、.pptx（slides）、.pdf（pages/text；内置字体仅支持拉丁字符）、" +
      ".md/.txt/.html/.json（text）。blocks 示例：[{type:'heading',level:1,text:'标题'},{type:'paragraph',text:'正文'}," +
      "{type:'bullet',text:'条目'},{type:'table',rows:[['a','b'],['c','d']]}]；sheets 示例：[{name:'Sheet1',rows:[['姓名','分数'],['甲',90]]}]；" +
      "slides 示例：[{title:'标题',bullets:['要点1','要点2'],notes:'备注'}]。",
    parameters: {
      path: { type: "string", required: true, description: "输出文件路径（按扩展名决定格式）" },
      title: { type: "string", description: "文档标题" },
      text: { type: "string", description: "纯文本内容（docx 时按行转段落/标题/列表；csv 时按 CSV 解析；pdf 时分页）" },
      blocks: { type: "json", description: "docx 结构化内容" },
      sheets: { type: "json", description: "xlsx/csv 工作表数据" },
      slides: { type: "json", description: "pptx 幻灯片数据" },
      pages: { type: "json", description: "pdf 页数据 [{lines:[...]}]" }
    },
    output: out(),
    async execute(args) {
      try {
        const f = absPath(args.path);
        const ext = extOf(f);
        let written;
        if (ext === ".docx") written = await writeDocx(f, args);
        else if (ext === ".xlsx" || ext === ".xlsm") written = await writeXlsx(f, args);
        else if (ext === ".csv") written = await writeCsv(f, args);
        else if (ext === ".pptx") written = await writePptx(f, args);
        else if (ext === ".pdf") written = await writePdf(f, args);
        else written = await writeText(f, args);
        const st = await fsp.stat(written);
        return { ok: true, path: written, kind: kindOf(ext), bytes: st.size };
      } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
    }
  }));

  ctx.tools.register(defineTool({
    name: "office_edit",
    description:
      "就地编辑已有文档（保留其它内容）。xlsx/csv 支持 op：{op:'set',sheet?,cell:'B3',value}、{op:'addRow',sheet?,row:[...]}、" +
      "{op:'addSheet',name}、{op:'deleteSheet',name}、{op:'renameSheet',sheet,name}；pdf 支持 {op:'addPage',lines:[...]}、{op:'setTitle',value}；" +
      "docx 支持 {op:'replace',find,replace}（同一文本片段内替换；结构性修改请用 office_read + office_write 重写）。",
    parameters: {
      path: { type: "string", required: true, description: "要编辑的文件路径" },
      ops: { type: "json", required: true, description: "操作数组" }
    },
    output: out(),
    async execute(args) {
      try {
        const f = absPath(args.path);
        const ext = extOf(f);
        const ops = Array.isArray(args.ops) ? args.ops : [];
        if (ops.length === 0) return { ok: false, error: "ops 不能为空" };
        let applied;
        if (ext === ".xlsx" || ext === ".xlsm") applied = await editXlsx(f, ops);
        else if (ext === ".csv") applied = await editCsv(f, ops);
        else if (ext === ".docx") applied = await editDocx(f, ops);
        else if (ext === ".pdf") applied = await editPdf(f, ops);
        else return { ok: false, error: "该格式不支持 office_edit：" + ext };
        const st = await fsp.stat(f);
        return { ok: true, path: f, kind: kindOf(ext), bytes: st.size, applied };
      } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
    }
  }));

  ctx.tools.register(defineTool({
    name: "office_info",
    description: "查看文档基本信息：类型、大小、以及（xlsx 的工作表 / pdf 的页数 / pptx 的页数）。",
    parameters: { path: { type: "string", required: true, description: "文件路径" } },
    output: out(),
    async execute(args) {
      try {
        const f = absPath(args.path);
        const ext = extOf(f);
        const kind = kindOf(ext);
        const st = await fsp.stat(f);
        let info = "";
        if (kind === "xlsx") {
          const wb = new ExcelJS.Workbook();
          await wb.xlsx.load(await fsp.readFile(f));
          info = "工作表：" + wb.worksheets.map((w) => w.name + "(" + w.rowCount + "x" + w.columnCount + ")").join(", ");
        } else if (kind === "pptx" || kind === "odf") {
          const zip = await JSZip.loadAsync(await fsp.readFile(f));
          const n = Object.keys(zip.files).filter((x) => /^ppt\/slides\/slide\d+\.xml$/.test(x)).length;
          info = n > 0 ? "幻灯片：" + n + " 页" : "";
        } else if (kind === "pdf") {
          const { PDFDocument: P } = await import("pdf-lib");
          const d = await P.load(await fsp.readFile(f));
          info = "页数：" + d.getPageCount();
        }
        return { ok: true, path: f, kind, bytes: st.size, info };
      } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
    }
  }));

  ctx.tools.register(defineTool({
    name: "office_convert",
    description:
      "格式转换：docx→md/html/txt、xlsx↔csv、pptx/pdf→txt、md/txt→docx/xlsx/pdf。用 to 指定目标扩展名（如 'md'、'xlsx'）。" +
      "out 省略时输出到同目录同名新扩展名文件。",
    parameters: {
      path: { type: "string", required: true, description: "源文件路径" },
      to: { type: "string", required: true, description: "目标扩展名，如 docx/xlsx/csv/md/html/txt/pdf/pptx" },
      out: { type: "string", description: "输出路径（可选）" }
    },
    output: out(),
    async execute(args) {
      try {
        const src = absPath(args.path);
        const to = String(args.to || "").replace(/^\./, "").toLowerCase();
        const outPath = args.out ? absPath(args.out) : src.replace(/\.[^./\\]+$/, "") + "." + to;
        const srcExt = extOf(src);
        if (srcExt === ".docx" && to === "html") {
          const buf = await readBuf(src);
          const r = await mammoth.convertToHtml({ buffer: buf });
          await writeBuf(outPath, Buffer.from(r.value || "", "utf8"));
          return { ok: true, path: outPath, kind: "html", bytes: (await fsp.stat(outPath)).size };
        }
        if (srcExt === ".xlsx" && to === "csv") {
          const wb = new ExcelJS.Workbook();
          await wb.xlsx.load(await readBuf(src));
          const ws = wb.worksheets[0];
          const rows = [];
          if (ws) ws.eachRow({ includeEmpty: false }, (row) => { const cells = []; row.eachCell({ includeEmpty: true }, (c) => cells.push(cellText(c.value))); rows.push(cells); });
          await writeBuf(outPath, Buffer.from(toCsv(rows), "utf8"));
          return { ok: true, path: outPath, kind: "csv", bytes: (await fsp.stat(outPath)).size };
        }
        const r = await readAny(src);
        const ext = "." + to;
        let written;
        if (ext === ".docx") written = await writeDocx(outPath, { title: "", text: r.text });
        else if (ext === ".xlsx") written = await writeXlsx(outPath, { sheets: [{ name: "Sheet1", rows: parseCsv(r.text.indexOf("|") >= 0 ? r.text.split("\n").map((l) => l.replace(/^\d+:\s*/, "").split(" | ").join(",")).join("\n") : r.text) }] });
        else if (ext === ".csv") written = await writeCsv(outPath, { text: r.text });
        else if (ext === ".pdf") written = await writePdf(outPath, { text: r.text });
        else if (ext === ".pptx") written = await writePptx(outPath, { title: "", text: r.text });
        else written = await writeText(outPath, { text: r.text });
        return { ok: true, path: written, kind: kindOf(ext), bytes: (await fsp.stat(written)).size };
      } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
    }
  }));
}

export { apply, inject, name };
