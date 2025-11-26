// servidor.js  (versão CommonJS, compatível com Render)

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

// ====== EMAIL (SMTP) OPCIONAL ======
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
    secure: Number(process.env.SMTP_PORT) === 465, // 465 = SSL
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
      from: process.env.MAIL_FROM, // ex.: "SafetyTech Radar <no-reply@safetytechsc.com.br>"
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

// ====== FUNÇÃO AUXILIAR PARA empresaID ======
function ensureEmpresaID(body = {}) {
  const normalized =
    body.empresaID ||
    process.env.EMPRESA_ID_PADRAO || // se quiser, pode setar no Render
    "empresa-demo-1";                // fallback para testes

  return {
    ...body,
    empresaID: normalized,
  };
}

// ====== ROTAS BÁSICAS ======

// health-check simples
app.get("/", (_req, res) => {
  res.send("Radar360 API OK");
});

// ping para teste rápido
app.get("/api/ping", (_req, res) => {
  res.json({ ok: true, msg: "pong" });
});

// debug de configuração de e-mail (sem mostrar senha)
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

// ====== ENDPOINTS DOS FORMULÁRIOS (AMB, PSICO, LIDERANÇA, RH) ======

app.post("/api/radar/ambiente", (req, res) => {
  const body = ensureEmpresaID(req.body || {});
  const file = saveBody("ambiente", body);
  res.json({ ok: true, stored: file, empresaID: body.empresaID });
});

app.post("/api/radar/psicossocial", (req, res) => {
  const body = ensureEmpresaID(req.body || {});
  const file = saveBody("psicossocial", body);
  res.json({ ok: true, stored: file, empresaID: body.empresaID });
});

app.post("/api/radar/lideranca", (req, res) => {
  const body = ensureEmpresaID(req.body || {});
  const file = saveBody("lideranca", body);
  res.json({ ok: true, stored: file, empresaID: body.empresaID });
});

app.post("/api/radar/rh", (req, res) => {
  const body = ensureEmpresaID(req.body || {});
  const file = saveBody("rh", body);
  res.json({ ok: true, stored: file, empresaID: body.empresaID });
});

// ====== CRIAÇÃO DE PLANO DE AÇÃO ======

app.post("/api/planos", async (req, res) => {
  const baseBody = req.body || {};
  const body = ensureEmpresaID(baseBody); // garante empresaID também nos planos

  const {
    empresaID,
    origem,          // "Ambiente" | "Psicossocial" | "Liderança & Gestão" | "RH"
    secao,           // ex.: "Comunicação & Liderança"
    indicador,       // texto da pergunta
    unidade,         // ex.: "Planta SC"
    ref_mes,         // "YYYY-MM" (opcional)
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
    empresaID: empresaID || null,
    origem: origem || null,
    secao: secao || null,
    indicador: indicador || null,
    unidade: unidade || null,
    ref_mes: ref_mes || null,
    responsavel_nome: responsavel_nome || null,
    responsavel_email: responsavel_email || null,
    prazo: prazo || null,
    prioridade: prioridade || "Alta",
    acao: acao || null,
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
        <p><b>Empresa:</b> ${empresaID || "-"}<br/>
           <b>Origem:</b> ${origem || "-"}<br/>
           <b>Seção:</b> ${secao || "-"}<br/>
           <b>Indicador:</b> ${indicador || "-"}<br/>
           <b>Unidade:</b> ${unidade || "-"}<br/>
           ${ref_mes ? `<b>Referência:</b> ${ref_mes}<br/>` : ""}
        </p>
        <p>Clique para abrir e concluir (anexe evidência ao finalizar):<br/>
          <a href="${link}" target="_blank">${link}</a>
        </p>
        <hr/>
        <p style="font-size:12px;color:#666">
          Se o link acima não abrir, copie e cole no navegador.<br/>
          Também funciona em: ${baseFront}/radar-acao.html#plano_id=${encodeURIComponent(
            plano_id
          )}&token=${encodeURIComponent(token)}
        </p>
      </div>
    `;
    const sent = await sendPlanEmail({
      to: responsavel_email,
      subject,
      html,
    });
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
    empresaID: empresaID || null,
  });
});

// ====== SAFETY VOICE (CANAL ANÔNIMO) ======
app.post("/api/radar/voice", (req, res) => {
  const base = req.body || {};
  const body = ensureEmpresaID(base);

  const agora = new Date().toISOString();

  const registro = {
    empresaID: body.empresaID,
    criado_em: agora,
    meta: {
      unidade: body.meta?.unidade || body.unidade || null,
      ref_mes: body.meta?.ref_mes || body.ref_mes || (agora.slice(0, 7))
    },
    tipo: body.tipo || "Nao informado",              // Positivo / Negativo
    categoria: body.categoria || "Não classificado", // Ambiente, EPI, Liderança, Assédio etc.
    descricao: body.descricao || null,               // Relato
    elogio_para: body.elogio_para || null,           // quando for positivo
    origem: "Safety Voice",
    status: body.status || "ABERTO",                 // ABERTO / EM ANÁLISE / ENCERRADO
    virou_plano: body.virou_plano || false,
    plano_id: body.plano_id || null
  };

  const file = saveBody("voice", registro);
  res.json({ ok: true, stored: file, empresaID: registro.empresaID });
});

// ====== LISTAGEM PARA DASHBOARD ======

function listByPrefix(prefix) {
  // Lê todos os arquivos da pasta /data que começam com o prefixo
  const files = fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.startsWith(prefix + "-") && f.endsWith(".json"))
    .sort(); // ordena do mais antigo para o mais novo

  // Mapeia cada arquivo para { file, ...conteudoJson }
  return files.map((name) => {
    const full = path.join(DATA_DIR, name);
    const content = JSON.parse(fs.readFileSync(full, "utf8"));
    return {
      file: name,
      ...content,
    };
  });
}

// GET /api/listar?tipo=psicossocial|ambiente|lideranca|rh|plano|voice&empresaID=xxx
app.get("/api/listar", (req, res) => {
  const { tipo, empresaID } = req.query;

  if (!tipo) {
    return res
      .status(400)
      .json({ ok: false, error: "tipo_required", hint: "use ?tipo=psicossocial" });
  }

  let prefix = null;
  switch (tipo) {
    case "ambiente":
      prefix = "ambiente";
      break;
    case "psicossocial":
      prefix = "psicossocial";
      break;
    case "lideranca":
      prefix = "lideranca";
      break;
    case "rh":
      prefix = "rh";
      break;
    case "plano":
      prefix = "plano";
      break;
    case "voice":
      prefix = "voice";
      break;
    default:
      return res.status(400).json({
        ok: false,
        error: "tipo_invalid",
        allowed: ["ambiente", "psicossocial", "lideranca", "rh", "plano", "voice"],
      });
  }

  try {
    const itens = listByPrefix(prefix);

    // se empresaID vier na query, filtra
    const filtrados = empresaID
      ? itens.filter((it) => it.empresaID === empresaID)
      : itens;

    res.json({
      ok: true,
      tipo,
      empresaID: empresaID || null,
      total: filtrados.length,
      itens: filtrados,
    });
  } catch (e) {
    console.error("Erro ao listar:", e.message);
    res.status(500).json({ ok: false, error: "read_error", detail: e.message });
  }
});

// ====== START DO SERVIDOR ======
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Radar360 API rodando na porta ${PORT}`);
});

