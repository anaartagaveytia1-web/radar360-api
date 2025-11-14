// servidor.js
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import nodemailer from "nodemailer";

const app = express();

/**
 * CORS – por enquanto liberado para qualquer origem.
 * Depois podemos restringir para: https://www.safetytechsc.com.br
 */
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);

app.use(express.json({ limit: "5mb" }));

// -----------------------------------------------------
// PASTA DE DADOS (onde serão salvos os JSONs)
// -----------------------------------------------------
const DATA_DIR = "./data";
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function saveBody(prefix, body) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(DATA_DIR, `${prefix}-${ts}.json`);
  fs.writeFileSync(file, JSON.stringify(body, null, 2), "utf8");
  return file;
}

// -----------------------------------------------------
// CONFIG DE E-MAIL (SMTP via variáveis de ambiente)
// -----------------------------------------------------
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

// helper para enviar email (não quebra o fluxo se falhar)
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

// -----------------------------------------------------
// HEALTHCHECKS
// -----------------------------------------------------
app.get("/", (_req, res) => {
  res.send("Radar360 API OK");
});

app.get("/api/ping", (_req, res) => {
  res.json({ ok: true, message: "pong" });
});

// -----------------------------------------------------
// ENDPOINTS PARA GUARDAR OS RADARES (AMB/PSI/LID/RH)
// -----------------------------------------------------
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

// (opcional) se quiser armazenar também o resultado do módulo RH:
app.post("/api/radar/rh", (req, res) => {
  const file = saveBody("rh", req.body);
  res.json({ ok: true, stored: file });
});

// Debug seguro das variáveis de e-mail (não expõe senhas)
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

// -----------------------------------------------------
// CRIAÇÃO DE PLANO DE AÇÃO (/api/planos)
// -----------------------------------------------------
app.post("/api/planos", async (req, res) => {
  const body = req.body || {};
  const {
    origem, // "Ambiente" | "Psicossocial" | "Liderança" | "RH"
    secao, // ex.: "Comunicação & Liderança"
    indicador, // texto da pergunta
    unidade, // ex.: "Planta SC"
    ref_mes, // "YYYY-MM" (opcional)
    responsavel_nome,
    responsavel_email,
    prazo,
    prioridade,
    acao,
  } = body;

  // gera ID e token simples
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const plano_id = `PA-${ts}-${Math.random().toString(16).slice(2, 8)}`;
  const token =
    Math.random().toString(36).slice(2) +
    Math.random().toString(36).slice(2);

  // monta objeto do plano
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

  // salva o plano em arquivo JSON
  const file = saveBody("plano", plano);

  // monta link público do formulário de ação (front)
  const baseFront =
    process.env.RADAR_FRONT_BASE ||
    "https://www.safetytechsc.com.br/radar360";
  const link = `${baseFront}/radar-acao.html?plano_id=${encodeURIComponent(
    plano_id
  )}&token=${encodeURIComponent(token)}`;

  // tenta enviar e-mail (se configurado e houver e-mail)
  let email_status = "skipped";
  if (responsavel_email) {
    const subject = `Plano de Ação • ${origem || "Radar 360"} • ${
      unidade || ""
    }`.trim();

    const html = `
      <div style="font-family:system-ui,Segoe UI,Roboto,Arial">
        <h2>Plano de Ação atribuído</h2>
        <p>
          <b>Origem:</b> ${origem || "-"}<br/>
          <b>Seção:</b> ${secao || "-"}<br/>
          <b>Indicador:</b> ${indicador || "-"}<br/>
          <b>Unidade:</b> ${unidade || "-"}<br/>
          ${ref_mes ? `<b>Referência:</b> ${ref_mes}<br/>` : ""}
        </p>
        <p>
          Clique para abrir e concluir (anexe evidência ao finalizar):<br/>
          <a href="${link}" target="_blank">${link}</a>
        </p>
        <hr/>
        <p style="font-size:12px;color:#666">
          Se o link acima não abrir, copie e cole no navegador.<br/>
          Também funciona em:<br/>
          ${baseFront}/radar-acao.html#plano_id=${encodeURIComponent(
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

// -----------------------------------------------------
// START DO SERVIDOR
// -----------------------------------------------------
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`✅ Radar360 API ouvindo na porta ${PORT}`);
});


// --- porta ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API on http://localhost:${PORT}`));
