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

// ====== CRIAÇÃO DE PLANO DE AÇÃO ======

app.post("/api/planos", async (req, res) => {
  const body = req.body || {};
  const {
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
        <p><b>Origem:</b> ${origem || "-"}<br/>
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
  });
});

// ====== START DO SERVIDOR ======
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Radar360 API rodando na porta ${PORT}`);
});
