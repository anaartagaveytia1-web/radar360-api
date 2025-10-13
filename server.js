import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import url from "url";

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

// ===== Diretório para salvar os dados =====
const DATA_DIR = "./data";
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

// ===== Função para salvar respostas =====
function saveBody(route, body) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(DATA_DIR, `${route}-${ts}.json`);
  fs.writeFileSync(file, JSON.stringify(body, null, 2), "utf8");
  return file;
}

// ====== ENDPOINTS BÁSICOS ======
app.get("/", (req, res) => res.send("Radar360 API OK"));

app.post("/api/radar/ambiente", (req, res) => {
  const file = saveBody("ambiente", req.body);
  res.json({ ok: true, stored: file });
});

app.post("/api/radar/psicossocial", (req, res) => {
  const file = saveBody("psicossocial", req.body);
  res.json({ ok: true, stored: file });
});

app.post("/api/radar/lideranca", (req, res) => {
  const file = saveBody("lideranca", req.body);
  res.json({ ok: true, stored: file });
});

app.post("/api/planos", (req, res) => {
  const file = saveBody("plano", req.body);
  res.json({ ok: true, stored: file });
});

// ===== Funções utilitárias para leitura =====
function listJson(prefix) {
  const files = fs.existsSync(DATA_DIR) ? fs.readdirSync(DATA_DIR) : [];
  return files
    .filter(f => f.startsWith(prefix) && f.endsWith(".json"))
    .map(f => path.join(DATA_DIR, f));
}

function readJsonFiles(filepaths, limit = 200) {
  const arr = [];
  const ordered = filepaths.sort().reverse(); // mais recentes primeiro
  for (const fp of ordered.slice(0, limit)) {
    try {
      arr.push(JSON.parse(fs.readFileSync(fp, "utf8")));
    } catch {}
  }
  return arr;
}

// ====== ENDPOINTS DE LEITURA ======

// Obter respostas por formulário (ambiente / psicossocial / liderança)
app.get("/api/respostas", (req, res) => {
  const form = String(req.query.form || "").toLowerCase();
  const map = { ambiente: "ambiente", psicossocial: "psicossocial", lideranca: "lideranca" };
  if (!map[form]) return res.status(400).json({ ok: false, error: "param 'form' inválido" });

  const files = listJson(map[form]);
  const data = readJsonFiles(files, Number(req.query.limit || 200));
  res.json({ ok: true, count: data.length, data });
});

// Obter todos os planos de ação
app.get("/api/planos", (req, res) => {
  const files = listJson("plano");
  const data = readJsonFiles(files, Number(req.query.limit || 500));
  res.json({ ok: true, count: data.length, data });
});

// Resumo consolidado para dashboard
app.get("/api/summary", (req, res) => {
  const a = readJsonFiles(listJson("ambiente"), 500);
  const p = readJsonFiles(listJson("psicossocial"), 500);
  const l = readJsonFiles(listJson("lideranca"), 500);
  const planos = readJsonFiles(listJson("plano"), 1000);

  const totalFormularios = a.length + p.length + l.length;

  // Abertos x Fechados por mês (YYYY-MM)
  const byMonth = {};
  planos.forEach(pl => {
    const ym = (pl.reference_month || (pl.created_from?.date || "")).slice(0, 7) || new Date().toISOString().slice(0, 7);
    byMonth[ym] = byMonth[ym] || { open: 0, closed: 0 };
    (pl.status || "OPEN") === "CLOSED" ? byMonth[ym].closed++ : byMonth[ym].open++;
  });

  // Score médio por origem (se existir)
  function avgScore(arr, getter) {
    const vals = arr.map(getter).filter(v => typeof v === "number");
    if (!vals.length) return null;
    return Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 100);
  }

  const scoreAmb = avgScore(a, x => x?.score_geral?.ratio);
  const scorePsi = avgScore(p, x => x?.score_geral?.ratio);
  const scoreLid = avgScore(l, x => x?.score_geral?.ratio);

  res.json({
    ok: true,
    totals: {
      formularios: totalFormularios,
      ambiente: a.length,
      psicossocial: p.length,
      lideranca: l.length,
      planos: planos.length,
      planos_abertos: planos.filter(x => (x.status || "OPEN") !== "CLOSED").length,
      planos_fechados: planos.filter(x => (x.status || "OPEN") === "CLOSED").length
    },
    scores: { ambiente: scoreAmb, psicossocial: scorePsi, lideranca: scoreLid },
    byMonth
  });
});
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import nodemailer from "nodemailer";

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const DATA_DIR = "./data";
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const INDEX_FILE = path.join(DATA_DIR, "planos_index.json");
if (!fs.existsSync(INDEX_FILE)) fs.writeFileSync(INDEX_FILE, "[]", "utf8");

// ---------- helpers ----------
function ts() { return new Date().toISOString().replace(/[:.]/g, "-"); }
function loadIndex() { try { return JSON.parse(fs.readFileSync(INDEX_FILE, "utf8")); } catch { return []; } }
function saveIndex(idx) { fs.writeFileSync(INDEX_FILE, JSON.stringify(idx, null, 2), "utf8"); }
function genId() { return "PA-" + ts() + "-" + crypto.randomBytes(3).toString("hex"); }
function genToken() { return crypto.randomBytes(16).toString("hex"); }
function saveBody(prefix, body) {
  const file = path.join(DATA_DIR, `${prefix}-${ts()}.json`);
  fs.writeFileSync(file, JSON.stringify(body, null, 2), "utf8");
  return file;
}

// ---------- e-mail (Nodemailer) ----------
// Configure via variáveis de ambiente no Render (Dashboard > Environment):
// SMTP_HOST, SMTP_PORT, SMTP_SECURE (true/false), SMTP_USER, SMTP_PASS, MAIL_FROM
const mailFrom = process.env.MAIL_FROM || "noreply@safetytechsc.com.br";
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: Number(process.env.SMTP_PORT || 587),
  secure: String(process.env.SMTP_SECURE || "false") === "true",
  auth: process.env.SMTP_USER ? {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  } : undefined,
});

async function sendPlanEmail({ to, responsavel, link, origem, secao, indicador, unidade, ref_mes }) {
  if (!to) return;
  const subj = `Plano de Ação atribuído — Radar 360°`;
  const html = `
    <div style="font-family:system-ui,Segoe UI,Roboto,Arial;color:#111">
      <h2>Plano de Ação — Radar 360°</h2>
      <p>Olá <b>${responsavel || ""}</b>,</p>
      <p>Você recebeu um plano de ação.</p>
      <ul>
        ${origem ? `<li><b>Origem:</b> ${origem}</li>` : ""}
        ${secao ? `<li><b>Seção:</b> ${secao}</li>` : ""}
        ${indicador ? `<li><b>Indicador/Pergunta:</b> ${indicador}</li>` : ""}
        ${unidade ? `<li><b>Unidade:</b> ${unidade}</li>` : ""}
        ${ref_mes ? `<li><b>Mês ref.:</b> ${ref_mes}</li>` : ""}
      </ul>
      <p>➡️ Acesse o link abaixo para ver os detalhes e <b>encerrar com evidência</b> quando concluir:</p>
      <p><a href="${link}" style="background:#2563eb;color:#fff;padding:10px 14px;border-radius:8px;text-decoration:none">Abrir Plano</a></p>
      <p style="font-size:12px;color:#666">Se o botão não abrir, copie e cole no navegador:<br/>${link}</p>
      <hr/>
      <p style="font-size:12px;color:#666">E-mail automático • Radar 360° SafetyTech SC</p>
    </div>
  `;
  await transporter.sendMail({ from: mailFrom, to, subject: subj, html });
}

// ---------- rotas ----------
app.get("/", (req, res) => res.send("Radar360 API OK"));

// cria registros dos 3 formulários do radar
app.post("/api/radar/ambiente", (req, res) => {
  const file = saveBody("ambiente", req.body);
  res.json({ ok: true, stored: file });
});
app.post("/api/radar/psicossocial", (req, res) => {
  const file = saveBody("psicossocial", req.body);
  res.json({ ok: true, stored: file });
});
app.post("/api/radar/lideranca", (req, res) => {
  const file = saveBody("lideranca", req.body);
  res.json({ ok: true, stored: file });
});
app.post("/api/radar/rh", (req, res) => {
  const file = saveBody("rh", req.body);
  res.json({ ok: true, stored: file });
});

// criação/encerramento de planos (mesmo endpoint, decide por status)
app.post("/api/planos", async (req, res) => {
  try {
    const body = req.body || {};
    // Se vier status Concluído + tipo_evento: encerrar → apenas registrar
    if (String(body.status).toLowerCase() === "concluído" || String(body.status).toLowerCase() === "concluido") {
      const file = saveBody("plano-close", body);
      return res.json({ ok: true, type: "closed", stored: file });
    }

    // Criação
    const plano_id = body.plano_id || genId();
    const token = genToken();

    const index = loadIndex();
    index.push({
      plano_id,
      token,
      criado_em: new Date().toISOString(),
      origem: body.origem || body.contexto?.origem || null,
      secao: body.secao || body.contexto?.secao || null,
      indicador: body.pergunta_txt || body.indicador || body.contexto?.indicador || null,
      unidade: body.unidade || body.contexto?.unidade || null,
      ref_mes: body.ref_mes || body.contexto?.ref_mes || null,
      responsavel_nome: body.responsavel_nome || null,
      responsavel_email: body.responsavel_email || null,
      status: "Aberto",
    });
    saveIndex(index);

    // salva payload bruto tb
    const saved = { ...body, plano_id, token, status: "Aberto" };
    const file = saveBody("plano", saved);

    // monta link público para o responsável
    const publicBase = process.env.PUBLIC_BASE_URL || "https://www.safetytechsc.com.br";
    const link =
      `${publicBase}/radar360/radar-acao.html?` +
      `plano_id=${encodeURIComponent(plano_id)}` +
      `&token=${encodeURIComponent(token)}` +
      (saved.origem ? `&origem=${encodeURIComponent(saved.origem)}` : "") +
      (saved.secao ? `&secao=${encodeURIComponent(saved.secao)}` : "") +
      (saved.pergunta_txt || saved.indicador
        ? `&indicador=${encodeURIComponent(saved.pergunta_txt || saved.indicador)}`
        : "") +
      (saved.unidade ? `&unidade=${encodeURIComponent(saved.unidade)}` : "") +
      (saved.ref_mes ? `&ref=${encodeURIComponent(saved.ref_mes)}` : "");

    // e-mail automático (se houver e-mail)
    if (saved.responsavel_email) {
      await sendPlanEmail({
        to: saved.responsavel_email,
        responsavel: saved.responsavel_nome,
        link,
        origem: saved.origem || saved.contexto?.origem,
        secao: saved.secao || saved.contexto?.secao,
        indicador: saved.pergunta_txt || saved.indicador || saved.contexto?.indicador,
        unidade: saved.unidade || saved.contexto?.unidade,
        ref_mes: saved.ref_mes || saved.contexto?.ref_mes,
      });
    }

    res.json({ ok: true, type: "created", plano_id, token, stored: file, link });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// consulta simples para o encerramento: /api/planos/:id?token=...
app.get("/api/planos/:id", (req, res) => {
  const { id } = req.params;
  const { token } = req.query;
  const index = loadIndex();
  const item = index.find(p => p.plano_id === id);
  if (!item) return res.status(404).json({ ok: false, error: "Plano não encontrado" });
  if (token && token !== item.token) return res.status(403).json({ ok: false, error: "Token inválido" });
  res.json({ ok: true, plano: item });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API on http://localhost:${PORT}`));

// ===== Inicialização =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API on http://localhost:${PORT}`));
