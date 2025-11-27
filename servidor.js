// servidor.js — Radar360 API (versão final e revisada)

// ====== IMPORTS BÁSICOS ======
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");

// ====== APP & MIDDLEWARES ======
const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

// ====== PASTA DE DADOS ======
const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function saveBody(prefix, body) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(DATA_DIR, `${prefix}-${ts}.json`);
  fs.writeFileSync(file, JSON.stringify(body, null, 2), "utf8");
  return file;
}

// ====== CONFIG DE EMAIL OPCIONAL ======
const EMAIL_ENABLED =
  !!process.env.SMTP_HOST &&
  !!process.env.SMTP_PORT &&
  !!process.env.SMTP_USER &&
  !!process.env.SMTP_PASS &&
  !!process.env.MAIL_FROM;

let transporter = null;

if (EMAIL_ENABLED) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

async function sendPlanEmail({ to, subject, html }) {
  if (!EMAIL_ENABLED || !transporter) {
    return { ok: false, reason: "email_not_configured" };
  }
  try {
    const info = await transporter.sendMail({
      from: process.env.MAIL_FROM,
      to,
      subject,
      html,
    });
    return { ok: true, id: info.messageId };
  } catch (e) {
    console.error("Email error:", e.message);
    return { ok: false, reason: e.message };
  }
}

// ====== FUNÇÃO PARA GARANTIR empresaID ======
function ensureEmpresaID(body = {}) {
  return {
    ...body,
    empresaID:
      body.empresaID ||
      process.env.EMPRESA_ID_PADRAO ||
      "empresa-demo-1",
  };
}

// =============================================================
// ======================= ROTAS BÁSICAS ========================
// =============================================================
app.get("/", (_req, res) => res.send("Radar360 API OK"));
app.get("/api/ping", (_req, res) => res.json({ ok: true, msg: "pong" }));

app.get("/api/debug-email", (_req, res) => {
  res.json({
    ok: true,
    configured: EMAIL_ENABLED,
    host: process.env.SMTP_HOST || null,
    port: process.env.SMTP_PORT || null,
    user: process.env.SMTP_USER || null,
    from: process.env.MAIL_FROM || null,
  });
});

// =============================================================
// ================= FORMULÁRIOS DO RADAR =======================
// =============================================================
app.post("/api/radar/ambiente", (req, res) => {
  const body = ensureEmpresaID(req.body);
  const file = saveBody("ambiente", body);
  res.json({ ok: true, stored: file, empresaID: body.empresaID });
});

app.post("/api/radar/psicossocial", (req, res) => {
  const body = ensureEmpresaID(req.body);
  const file = saveBody("psicossocial", body);
  res.json({ ok: true, stored: file, empresaID: body.empresaID });
});

app.post("/api/radar/lideranca", (req, res) => {
  const body = ensureEmpresaID(req.body);
  const file = saveBody("lideranca", body);
  res.json({ ok: true, stored: file, empresaID: body.empresaID });
});

app.post("/api/radar/rh", (req, res) => {
  const body = ensureEmpresaID(req.body);
  const file = saveBody("rh", body);
  res.json({ ok: true, stored: file, empresaID: body.empresaID });
});

// =============================================================
// ===================== RAIO-X DO RISCO ========================
// =============================================================
app.post("/api/radar/raiox", (req, res) => {
  const body = ensureEmpresaID(req.body);

  const registro = {
    empresaID: body.empresaID,
    criado_em: new Date().toISOString(),
    funcao: body.funcao || null,
    unidade: body.unidade || null,
    riscos: body.riscos || [],
    resumo: body.resumo || {},
  };

  const file = saveBody("raiox", registro);

  return res.json({
    ok: true,
    stored: file,
    empresaID: registro.empresaID
  });
});

// =============================================================
// =================== CRIAR PLANO DE AÇÃO =====================
// =============================================================
app.post("/api/planos", async (req, res) => {
  const body = ensureEmpresaID(req.body);

  const {
    empresaID,
    origem,
    secao,
    indicador,
    unidade,
    ref_mes,
    responsavel_nome,
    responsavel_email,
    prazo,
    prioridade,
    acao,
  } = body;

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const plano_id = `PA-${ts}-${Math.random().toString(16).slice(2, 8)}`;
  const token =
    Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2);

  const plano = {
    plano_id,
    token,
    criado_em: new Date().toISOString(),
    empresaID,
    origem: origem || null,
    secao: secao || null,
    indicador: indicador || null,
    unidade: unidade || null,
    ref_mes: ref_mes || null,
    responsavel_nome,
    responsavel_email,
    prazo,
    prioridade: prioridade || "Alta",
    acao,
    status: "ABERTO",
  };

  const file = saveBody("plano", plano);

  const baseFront =
    process.env.RADAR_FRONT_BASE ||
    "https://www.safetytechsc.com.br/radar360";

  const link = `${baseFront}/radar-acao.html?plano_id=${encodeURIComponent(
    plano_id
  )}&token=${encodeURIComponent(token)}`;

  let email_status = "skipped";
  if (responsavel_email) {
    const subject = `Plano de Ação • ${origem || "Radar 360"} • ${
      unidade || ""
    }`.trim();

    const html = `
      <div style="font-family:system-ui,Segoe UI,Roboto,Arial">
        <h2>Plano de Ação atribuído</h2>
        <p>
          <b>Empresa:</b> ${empresaID}<br/>
          <b>Origem:</b> ${origem || "-"}<br/>
          <b>Seção:</b> ${secao || "-"}<br/>
          <b>Indicador:</b> ${indicador || "-"}<br/>
          <b>Unidade:</b> ${unidade || "-"}<br/>
          ${ref_mes ? `<b>Referência:</b> ${ref_mes}<br/>` : ""}
        </p>
        <p>
          Clique para abrir o plano:<br/>
          <a href="${link}" target="_blank">${link}</a>
        </p>
      </div>
    `;

    const sent = await sendPlanEmail({ to: responsavel_email, subject, html });
    email_status = sent.ok ? "sent" : `failed:${sent.reason}`;
  }

  res.json({
    ok: true,
    type: "created",
    stored: file,
    plano_id,
    token,
    link,
    email_status,
    empresaID,
  });
});

// =============================================================
// ====================== SAFETY VOICE ==========================
// =============================================================
app.post("/api/radar/voice", (req, res) => {
  const body = ensureEmpresaID(req.body);
  const agora = new Date().toISOString();

  const registro = {
    empresaID: body.empresaID,
    criado_em: agora,
    meta: {
      unidade: body.meta?.unidade || body.unidade || null,
      ref_mes:
        body.meta?.ref_mes ||
        body.ref_mes ||
        agora.slice(0, 7),
    },
    tipo: body.tipo || "Nao informado",
    categoria: body.categoria || "Não classificado",
    descricao: body.descricao || null,
    elogio_para: body.elogio_para || null,
    origem: "Safety Voice",
    status: body.status || "ABERTO",
    virou_plano: !!body.virou_plano,
    plano_id: body.plano_id || null,
  };

  const file = saveBody("voice", registro);

  res.json({
    ok: true,
    stored: file,
    empresaID: registro.empresaID,
  });
});

// =============================================================
// ======================= LISTAGEM =============================
// =============================================================
function listByPrefix(prefix) {
  const files = fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.startsWith(prefix + "-") && f.endsWith(".json"))
    .sort();

  return files.map((name) => {
    const full = path.join(DATA_DIR, name);
    return { file: name, ...JSON.parse(fs.readFileSync(full, "utf8")) };
  });
}

app.get("/api/listar", (req, res) => {
  const { tipo, empresaID } = req.query;

  if (!tipo) {
    return res.status(400).json({
      ok: false,
      error: "tipo_required",
      hint: "use ?tipo=ambiente",
    });
  }

  let prefix = null;
  switch (tipo) {
    case "ambiente": prefix = "ambiente"; break;
    case "psicossocial": prefix = "psicossocial"; break;
    case "lideranca": prefix = "lideranca"; break;
    case "rh": prefix = "rh"; break;
    case "plano": prefix = "plano"; break;
    case "voice": prefix = "voice"; break;
    case "raiox": prefix = "raiox"; break; // <—— AQUI ESTÁ A INTEGRAÇÃO
    default:
      return res.status(400).json({
        ok: false,
        error: "tipo_invalid",
      });
  }

  try {
    const itens = listByPrefix(prefix);
    const filtrados = empresaID
      ? itens.filter((i) => i.empresaID === empresaID)
      : itens;

    return res.json({
      ok: true,
      tipo,
      empresaID: empresaID || null,
      total: filtrados.length,
      itens: filtrados,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "read_error",
      detail: e.message,
    });
  }
});

// =============================================================
// ==================== START DO SERVIDOR =======================
// =============================================================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () =>
  console.log(`Radar360 API rodando na porta ${PORT}`)
);
