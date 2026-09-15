/**
 * dsh-tool-knowledge — 本地知识库：把「遇到的问题 + 解决办法」沉淀下来，越用越强。
 *
 * - 存储：$DSH_HOME/knowledge/kb.sqlite（SQLite，FTS5 trigram 全文检索，支持中文子串）+ entries/<id>.md
 * - 工具：kb_search / kb_get / kb_add / kb_list / kb_stats / kb_delete / kb_digest
 * - 自动整理：监听 session/event 的 turn/end，在后台用当前模型把本轮会话整理成一条知识条目
 *   （纯闲聊/无复用价值时由模型返回 useful:false，不入库）。
 *
 * 注意：DSH 工具输出 schema 为 additionalProperties:false，execute 返回的每个字段都必须声明。
 */
import { defineTool } from "@deepseek-ai/dsh-tools";
import { BlockAssembler, createUserMessage } from "@deepseek-ai/dsh-llm";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { promises as fsp } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import z from "@deepseek-ai/schemastery";

const name = "tool-knowledge";
const inject = ["tools"];

const Config = z.object({
  enabled: z.boolean().default(true),
  autoDistill: z.boolean().default(true),
  delayMs: z.number().default(4000),
  minTurnGapMs: z.number().default(15000),
  maxHistoryChars: z.number().default(24000),
  maxTokens: z.number().default(1200)
});

const DEFAULTS = { enabled: true, autoDistill: true, delayMs: 4000, minTurnGapMs: 15000, maxHistoryChars: 24000, maxTokens: 1200 };

function kbRoot() {
  // App 传入的外部共享目录优先（覆盖安装/重装不丢）；否则回退 DSH_HOME/knowledge
  const dir = process.env.DSH_KNOWLEDGE_DIR;
  if (dir && dir.trim() !== "") return join(dir);
  const home = process.env.DSH_HOME && process.env.DSH_HOME.trim() !== "" ? process.env.DSH_HOME : join(homedir(), ".dsh");
  return join(home, "knowledge");
}
function makeId(title, problem) {
  return createHash("sha256").update(String(title) + "\n" + String(problem || "")).digest("hex").slice(0, 12);
}
/** 追加一行 JSON 诊断日志到 $DSH_HOME/knowledge/distill.log（失败静默）。 */
async function appendLog(obj) {
  try {
    const root = kbRoot();
    await fsp.mkdir(root, { recursive: true });
    await fsp.appendFile(join(root, "distill.log"), JSON.stringify(Object.assign({ ts: new Date().toISOString() }, obj)) + "\n", "utf8");
  } catch (e) { /* ignore */ }
}

/* ---------------- store ---------------- */

const store = {
  db: null,
  fts: false,
  async open() {
    if (this.db) return this.db;
    const root = kbRoot();
    await fsp.mkdir(join(root, "entries"), { recursive: true });
    const db = new DatabaseSync(join(root, "kb.sqlite"));
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("CREATE TABLE IF NOT EXISTS entries (id TEXT PRIMARY KEY, title TEXT NOT NULL, problem TEXT, solution TEXT, tags TEXT, source TEXT, created_at INTEGER, updated_at INTEGER)");
    try {
      db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(id UNINDEXED, title, problem, solution, tags, tokenize='trigram')");
      this.fts = true;
    } catch (e) {
      this.fts = false;
    }
    this.db = db;
    return db;
  },
  async add(entry) {
    const db = await this.open();
    const now = Date.now();
    let id = entry.id || makeId(entry.title, entry.problem);
    // v1.7.5-x7root.4：同标题（去空格/大小写归一）视为同一条，覆盖更新而非新增，
    // 避免自动整理时问题描述被改写导致「同名不同 hash」的重复条目。
    if (!entry.id && !db.prepare("SELECT id FROM entries WHERE id = ?").get(id)) {
      const nt = String(entry.title || "").trim().toLowerCase().replace(/\s+/g, " ");
      for (const r of db.prepare("SELECT id, title FROM entries").all()) {
        if (String(r.title || "").trim().toLowerCase().replace(/\s+/g, " ") === nt) { id = r.id; break; }
      }
    }
    const tags = Array.isArray(entry.tags) ? entry.tags.join(",") : String(entry.tags || "");
    const existing = db.prepare("SELECT id FROM entries WHERE id = ?").get(id);
    if (existing) {
      db.prepare("UPDATE entries SET title=?, problem=?, solution=?, tags=?, source=?, updated_at=? WHERE id=?").run(entry.title, entry.problem || "", entry.solution || "", tags, entry.source || "", now, id);
    } else {
      db.prepare("INSERT INTO entries (id,title,problem,solution,tags,source,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").run(id, entry.title, entry.problem || "", entry.solution || "", tags, entry.source || "", now, now);
    }
    if (this.fts) {
      try {
        db.prepare("DELETE FROM fts WHERE id = ?").run(id);
        db.prepare("INSERT INTO fts (id,title,problem,solution,tags) VALUES (?,?,?,?,?)").run(id, entry.title, entry.problem || "", entry.solution || "", tags);
      } catch (e) { /* fts 同步失败不影响主表 */ }
    }
    await fsp.mkdir(join(kbRoot(), "entries"), { recursive: true });
    await fsp.writeFile(join(kbRoot(), "entries", id + ".md"), renderMarkdown(id, entry, now), "utf8");
    return id;
  },
  async search(query, limit) {
    const db = await this.open();
    const q = String(query || "").trim();
    const lim = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 50) : 8;
    if (q === "") return [];
    if (this.fts && q.length >= 3) {
      try {
        return db.prepare("SELECT id, title, tags, substr(problem,1,240) AS snippet, updated_at FROM fts WHERE fts MATCH ? ORDER BY rank LIMIT ?").all('"' + q.split('"').join('""') + '"', lim);
      } catch (e) { /* 退回 LIKE */ }
    }
    const like = "%" + q + "%";
    return db.prepare("SELECT id, title, tags, substr(problem,1,240) AS snippet, updated_at FROM entries WHERE title LIKE ? OR problem LIKE ? OR solution LIKE ? OR tags LIKE ? ORDER BY updated_at DESC LIMIT ?").all(like, like, like, like, lim);
  },
  async get(id) {
    const db = await this.open();
    return db.prepare("SELECT * FROM entries WHERE id = ?").get(String(id || ""));
  },
  async list(limit) {
    const db = await this.open();
    const lim = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 20;
    return db.prepare("SELECT id, title, tags, updated_at FROM entries ORDER BY updated_at DESC LIMIT ?").all(lim);
  },
  async remove(id) {
    const db = await this.open();
    const r = db.prepare("DELETE FROM entries WHERE id = ?").run(String(id || ""));
    if (this.fts) { try { db.prepare("DELETE FROM fts WHERE id = ?").run(String(id || "")); } catch (e) {} }
    try { await fsp.unlink(join(kbRoot(), "entries", String(id) + ".md")); } catch (e) {}
    return r && typeof r.changes === "number" ? r.changes : 0;
  },
  async stats() {
    const db = await this.open();
    const row = db.prepare("SELECT COUNT(*) AS n, MAX(updated_at) AS last FROM entries").get();
    return { count: row && row.n ? Number(row.n) : 0, lastUpdated: row && row.last ? Number(row.last) : 0, root: kbRoot(), fts: this.fts };
  }
};

function renderMarkdown(id, entry, ts) {
  const tags = Array.isArray(entry.tags) ? entry.tags : String(entry.tags || "").split(",").filter((x) => x !== "");
  return [
    "# " + String(entry.title || ""),
    "",
    "- id: " + id,
    "- tags: " + tags.join(", "),
    "- updated: " + new Date(ts).toISOString(),
    entry.source ? "- source: " + entry.source : "",
    "",
    "## 问题现象",
    "",
    String(entry.problem || ""),
    "",
    "## 解决办法",
    "",
    String(entry.solution || ""),
    ""
  ].filter((x) => x !== "").join("\n");
}

/* ---------------- auto distillation ---------------- */

const DISTILL_PROMPT = [
  "你是知识库整理器。阅读下面的会话记录，抽取其中「遇到的具体问题」与「最终验证有效的解决办法」。",
  "只有在确实包含可长期复用的排错/解决经验时才值得入库；单纯的闲聊、简单问答、无结论的尝试，一律视为无价值。",
  "只输出严格 JSON，不要代码块标记，不要任何额外文字：",
  '无价值时：{"useful": false}',
  '有价值时：{"useful": true, "title": "不超过30字的标题", "problem": "问题现象（含报错原文要点）", "solution": "解决办法（可执行的命令/代码/步骤）", "tags": ["标签1","标签2"]}'
].join("\n");

function textOfBlocks(msg) {
  if (!msg || !Array.isArray(msg.content)) return "";
  const parts = [];
  for (const b of msg.content) {
    if (b && b.type === "text" && typeof b.text === "string") parts.push(b.text);
    else if (b && b.type === "tool-call") parts.push("[调用工具 " + String(b.name || "") + " " + JSON.stringify(b.arguments || {}).slice(0, 400) + "]");
    else if (b && b.type === "tool-result") parts.push("[工具结果] " + JSON.stringify(b.content === undefined ? b : b.content).slice(0, 800));
  }
  return parts.join("\n");
}
function renderHistory(messages, budget) {
  const out = [];
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i];
    const t = textOfBlocks(m);
    if (t === "") continue;
    out.unshift(String(m.role || "?") + ": " + t.slice(0, 4000));
  }
  let s = out.join("\n\n");
  if (s.length > budget) s = s.slice(s.length - budget);
  return s;
}
function extractJson(text) {
  const s = String(text || "");
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch (e) { return null; }
}

let busy = false;
let lastAt = 0;
const timers = new Map();

function log(ctx, msg) {
  try { if (ctx.logger && typeof ctx.logger.info === "function") ctx.logger.info(msg); } catch (e) {}
}

async function distill(ctx, session, cfg) {
  const sid0 = String((session && session.id) || "");
  const llm = ctx.get("llm");
  if (!llm || typeof llm.stream !== "function") {
    await appendLog({ phase: "skip", reason: "llm-unavailable", session: sid0, hasLlm: !!llm });
    return { ok: false, error: "llm 服务不可用" };
  }
  let provider;
  let model;
  let headerShape = "";
  try {
    const header = typeof session.requestHeader === "function" ? session.requestHeader() : undefined;
    const c = header && header.config ? header.config : undefined;
    if (c) { provider = c.provider; model = c.model; }
    headerShape = header ? Object.keys(header).join(",") : "no-header";
  } catch (e) { headerShape = "err:" + String((e && e.message) || e); }
  await appendLog({ phase: "model", session: sid0, provider: provider || null, model: model || null, header: headerShape });
  if (!provider || !model) return { ok: false, error: "无法确定当前模型，跳过整理" };
  const messages = typeof session.deriveMessages === "function" ? session.deriveMessages() : [];
  const history = renderHistory(messages, cfg.maxHistoryChars);
  await appendLog({ phase: "history", session: sid0, messages: Array.isArray(messages) ? messages.length : 0, chars: history.length });
  if (history.length < 40) return { ok: false, error: "会话内容过少，跳过" };
  const assembler = new BlockAssembler();
  const options = {
    provider,
    model,
    maxTokens: cfg.maxTokens,
    messages: [createUserMessage({
      content: [{ type: "text", text: DISTILL_PROMPT + "\n\n--- 会话记录 ---\n" + history }],
      source: { kind: "plugin", plugin: "tool-knowledge" }
    })],
    signal: AbortSignal.timeout(120000)
  };
  for await (const chunk of llm.stream(options)) assembler.push(chunk);
  const finish = assembler.finish;
  if (finish && (finish.kind === "error" || finish.kind === "aborted")) {
    const eMsg = "整理调用失败：" + String((finish.failure && finish.failure.message) || finish.kind);
    await appendLog({ phase: "error", session: sid0, error: eMsg, finish: finish.kind });
    return { ok: false, error: eMsg };
  }
  const text = assembler.blocks().filter((b) => b && b.type === "text").map((b) => b.text).join("\n");
  const parsed = extractJson(text);
  if (!parsed) {
    await appendLog({ phase: "error", session: sid0, error: "not-json", raw: String(text).slice(0, 300) });
    return { ok: false, error: "整理结果不是合法 JSON" };
  }
  if (parsed.useful !== true) {
    await appendLog({ phase: "not-useful", session: sid0 });
    return { ok: true, stored: false };
  }
  const title = String(parsed.title || "").trim();
  const problem = String(parsed.problem || "").trim();
  const solution = String(parsed.solution || "").trim();
  if (title === "" || solution === "") return { ok: false, error: "整理结果缺少 title/solution" };
  const id = await store.add({ title, problem, solution, tags: Array.isArray(parsed.tags) ? parsed.tags : [], source: "auto:" + sid0 });
  await appendLog({ phase: "stored", session: sid0, id, title });
  return { ok: true, stored: true, id };
}

function schedule(ctx, session, cfg) {
  const sid = session && session.id ? String(session.id) : "";
  if (sid === "") return;
  const now = Date.now();
  if (now - lastAt < cfg.minTurnGapMs) return;
  if (timers.has(sid)) clearTimeout(timers.get(sid));
  const t = setTimeout(async () => {
    timers.delete(sid);
    if (busy) return;
    busy = true;
    try {
      const r = await distill(ctx, session, cfg);
      if (r && r.ok && r.stored) log(ctx, "knowledge: 已整理入库 " + r.id);
      else if (r && !r.ok) log(ctx, "knowledge: 跳过（" + r.error + "）");
      lastAt = Date.now();
    } catch (e) {
      log(ctx, "knowledge: 整理异常 " + String((e && e.message) || e));
    } finally { busy = false; }
  }, cfg.delayMs);
  timers.set(sid, t);
}

/* ---------------- tools ---------------- */

function freshSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      ok: { type: "boolean", required: true },
      error: { type: "string" },
      text: { type: "string" },
      id: { type: "string" },
      stored: { type: "boolean" },
      count: { type: "number" },
      info: { type: "string" }
    }
  };
}
function fmt(v) {
  if (!v || v.ok !== true) return "错误：" + ((v && v.error) || "unknown");
  if (typeof v.text === "string") return v.text;
  const bits = [];
  if (v.id) bits.push("条目：" + v.id);
  if (typeof v.stored === "boolean") bits.push(v.stored ? "已入库" : "未入库");
  if (typeof v.count === "number") bits.push("数量：" + v.count);
  if (v.info) bits.push(v.info);
  return bits.length > 0 ? bits.join("；") : "完成";
}
function out() { return { schema: freshSchema(), render: (_a, v) => [{ type: "text", text: fmt(v) }] }; }

function apply(ctx, config) {
  const cfg = Object.assign({}, DEFAULTS, config || {});
  const ready = store.open().catch(() => null);

  ctx.inject(["systemPrompt"], (pctx) => {
    pctx.systemPrompt.section({
      name: "tool-knowledge:instructions",
      order: 950,
      text: [
        "## 本地知识库（越用越强）",
        "遇到报错、踩坑、或需要排障时，**先调用 kb_search 检索历史经验**；命中时优先按记录的办法处理，避免重复试错。",
        "把问题解决并验证有效后，用 kb_add 记录：title（≤30字）、problem（现象/报错原文）、solution（可执行的命令或代码）、tags。",
        "本轮对话结束时系统会自动整理一次并入库，因此你只需在解决关键问题时主动补充 kb_add 即可。"
      ].join("\n")
    });
  });

  if (cfg.autoDistill) {
    ctx.on("session/event", (session, event) => {
      try {
        if (!cfg.enabled || !event || event.type !== "turn/end") return;
        const reason = event.data && event.data.reason;
        if (reason === "aborted" || (reason && reason.aborted)) return;
        appendLog({ phase: "hook", session: String((session && session.id) || ""), reason: typeof reason === "string" ? reason : "obj" });
        schedule(ctx, session, cfg);
      } catch (e) { /* 事件回调不得抛出 */ }
    });
  }

  ctx.tools.register(defineTool({
    name: "kb_search",
    description: "检索本地知识库（历史遇到的问题与解决办法）。排障前先调用它。返回条目 id、标题、标签与问题摘要；用 kb_get 取全文。",
    parameters: {
      query: { type: "string", required: true, description: "检索词（支持中文子串）" },
      limit: { type: "number", description: "最多返回条数（默认 8）" }
    },
    output: out(),
    async execute(args) {
      try {
        await ready;
        const rows = await store.search(args.query, args.limit);
        if (rows.length === 0) return { ok: true, count: 0, text: "知识库中没有匹配「" + String(args.query) + "」的记录。" };
        const lines = rows.map((r) => "- [" + r.id + "] " + r.title + (r.tags ? "  #" + String(r.tags).split(",").join(" #") : "") + "\n  " + String(r.snippet || "").replace(/\s+/g, " ").slice(0, 200));
        return { ok: true, count: rows.length, text: lines.join("\n") };
      } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
    }
  }));

  ctx.tools.register(defineTool({
    name: "kb_get",
    description: "按 id 读取知识库条目全文（问题现象 + 解决办法）。",
    parameters: { id: { type: "string", required: true, description: "条目 id（来自 kb_search/kb_list）" } },
    output: out(),
    async execute(args) {
      try {
        await ready;
        const row = await store.get(args.id);
        if (!row) return { ok: false, error: "未找到条目 " + String(args.id) };
        return { ok: true, id: row.id, text: "# " + row.title + "\n\n## 问题现象\n" + (row.problem || "") + "\n\n## 解决办法\n" + (row.solution || "") + "\n\ntags: " + (row.tags || "") };
      } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
    }
  }));

  ctx.tools.register(defineTool({
    name: "kb_add",
    description: "把一条「问题 + 解决办法」写入本地知识库（同标题+问题会覆盖更新）。解决关键问题后调用。",
    parameters: {
      title: { type: "string", required: true, description: "标题（≤30字）" },
      problem: { type: "string", description: "问题现象/报错原文" },
      solution: { type: "string", required: true, description: "解决办法（命令/代码/步骤）" },
      tags: { type: "json", description: "标签数组，如 ['android','flock']" },
      source: { type: "string", description: "来源说明（可选）" }
    },
    output: out(),
    async execute(args) {
      try {
        await ready;
        const id = await store.add({ title: String(args.title), problem: String(args.problem || ""), solution: String(args.solution), tags: Array.isArray(args.tags) ? args.tags : [], source: String(args.source || "manual") });
        return { ok: true, id, stored: true, info: "已写入知识库" };
      } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
    }
  }));

  ctx.tools.register(defineTool({
    name: "kb_list",
    description: "列出知识库最近的条目（id/标题/标签）。",
    parameters: { limit: { type: "number", description: "最多返回条数（默认 20）" } },
    output: out(),
    async execute(args) {
      try {
        await ready;
        const rows = await store.list(args.limit);
        const lines = rows.map((r) => "- [" + r.id + "] " + r.title + (r.tags ? "  #" + String(r.tags).split(",").join(" #") : ""));
        return { ok: true, count: rows.length, text: lines.length ? lines.join("\n") : "知识库为空。" };
      } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
    }
  }));

  ctx.tools.register(defineTool({
    name: "kb_stats",
    description: "知识库统计：条目数、最近更新时间、存储位置。",
    parameters: {},
    output: out(),
    async execute() {
      try {
        await ready;
        const s = await store.stats();
        return { ok: true, count: s.count, info: "最近更新：" + (s.lastUpdated ? new Date(s.lastUpdated).toISOString() : "无") + "；位置：" + s.root + "；全文检索：" + (s.fts ? "FTS5" : "LIKE") };
      } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
    }
  }));

  ctx.tools.register(defineTool({
    name: "kb_delete",
    description: "按 id 删除知识库条目。",
    parameters: { id: { type: "string", required: true, description: "条目 id" } },
    output: out(),
    async execute(args) {
      try {
        await ready;
        const n = await store.remove(args.id);
        return { ok: true, count: n, info: n > 0 ? "已删除" : "未找到该条目" };
      } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
    }
  }));

  ctx.tools.register(defineTool({
    name: "kb_digest",
    description: "立即把当前会话整理成一条知识条目并入库（平时每轮结束会自动执行；此工具用于手动触发）。",
    parameters: {},
    output: out(),
    async execute(args, exec) {
      try {
        await ready;
        const session = exec && exec.agent ? exec.agent.session : undefined;
        if (!session) return { ok: false, error: "无法获取当前会话" };
        const r = await distill(ctx, session, cfg);
        if (!r.ok) return { ok: false, error: r.error };
        return { ok: true, stored: r.stored === true, ...(r.id ? { id: r.id } : {}), info: r.stored ? "已整理入库" : "本轮没有值得入库的经验" };
      } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
    }
  }));
}

export { apply, inject, name, Config };
