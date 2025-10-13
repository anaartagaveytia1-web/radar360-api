import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import nodemailer from "nodemailer";

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// --- storage local ---
const DATA_DIR = "./data";
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const INDEX_FILE = path.join(DATA_DIR, "planos_index.json");
if (!fs.existsSync(INDEX_FILE)) fs.writeFileSync(INDEX_FILE, "[]", "utf8");

const ts = () => new Date().toISOString().replace(/[:.]/g, "-");
const loadIndex = () => {
  try { return JSON.parse(fs.readFileSync(INDEX_FILE, "utf8")); }
  catch { return []; }
};
const saveIndex = (idx) => fs.writeFileSync(INDEX_FILE, JSON.stringify(idx, null, 2), "utf8");
const saveBody = (prefix, body) => {
  const file = path.join(DATA_DIR, `${prefix}-${ts()}.json`);
  fs.writeFileSync(file, JSON.stringify(body, null, 2), "utf8");
  return file;
};
const genId = () => "PA-" + ts() + "-" + crypto.randomBytes(3).toString("hex");
const genToken = () => crypto.randomBytes(16).toString("hex");

// --- e-mail (desabilita automaticamente se não houver SMTP) ---
const mailFrom = process.env.MAIL_FROM || "noreply@safetytechsc.com.br";
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;
const smtpHost = process.env.SMTP_HOST || "smtp.gmail.com";
const smtpPort = Number(process.env.SMTP_PORT || 587);
const smtpSecure = String(process.env.SMTP_SECURE || "false") === "true";

let transporter = null;
let emailEnabled = false;
try {
  if (smtpUser && smtpPass) {
    transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      auth: { user: smtpUser, pass: smtpPass },
    });
    emailEnabled = true;
  }
} catch (e) {
  console.warn("E-mail desabilitado:", e?.message || e);
  emailEnabled = false;
}

async function sendPlanEmail({ to, responsavel, link, origem, secao, indicador, unidade, ref_mes }) {
  if (!emailEnabled || !to) return;
  const subject = "Plano de Ação atribuído — Radar 360°";
  const html = `
    <div style="font-family:system-ui,Segoe UI,Roboto,Arial;color:#111">
      <h2>Plano de Ação — Radar 360°</h2>
      <p>Olá <b>${responsavel || ""}</b>, você recebeu um plano de ação.</p>
      <ul>
        ${origem ? `<li><b>Origem:</b> ${origem}</li>` : ""}
        ${secao ? `<li><b>Seção:</b> ${secao}</li>` : ""}
        ${indicador ? `<li><b>Indicador:</b> ${indicador}</li>` : ""}
        ${unidade ? `<li><b>Unidade:</b> ${unidade}</li>` : ""}
        ${ref_mes ? `<li><b>Mês ref.:</b> ${ref_mes}</li>` : ""}
      </ul>
      <p><a href="${link}" style="background:#2563eb;color:#fff;padding:10px 14px;border-radius:8px;text-decoration:none">Abrir Plano</a></p>
      <p style="font-size:12px;color:#666">Se o botão não abrir: ${link}</p>
    </div>
  `;
  await transporter.sendMail({ from: mailFrom, to, subject, html });
}

// --- rotas simples ---
app.get("/", (req, res) => res.send("Radar360 API OK"));

app.post("/api/radar/ambiente", (req, res) => res.json({ ok: true, stored: saveBody("ambiente", req.body) }));
app.post("/api/radar/psicossocial", (req, res) => res.json({ ok: true, stored: saveBody("psicossocial", req.body) }));
app.post("/api/radar/lideranca", (req, res) => res.json({ ok: true, stored: saveBody("lideranca", req.body) }));
app.post("/api/radar/rh", (req, res) => res.json({ ok: true, stored: saveBody("rh", req.body) }));

// cria ou encerra plano
app.post("/api/planos", async (req, res) => {
  try {
    const body = req.body || {};

    // ENCERRAMENTO (status Concluído)
    if (String(body.status || "").toLowerCase().includes("conclu")) {
      const file = saveBody("plano-close", body);
      return res.json({ ok: true, type: "closed", stored: file });
    }

    // CRIAÇÃO
    const plano_id = body.plano_id || genId();
    const token = genToken();

    const idx = loadIndex();
    const item = {
      plano_id,
      token,
      criado_em: new Date().toISOString(),
      origem: body.origem || body.contexto?.origem || null,
      secao: body.secao || body.contexto?.secao || null,
      indicador: body.indicador || body.pergunta_txt || body.contexto?.indicador || null,
      unidade: body.unidade || body.contexto?.unidade || null,
      ref_mes: body.ref_mes || body.contexto?.ref_mes || null,
      responsavel_nome: body.responsavel_nome || null,
      responsavel_email: body.responsavel_email || null,
      status: "Aberto",
    };
    idx.push(item); saveIndex(idx);

    const saved = { ...body, plano_id, token, status: "Aberto" };
    const file = saveBody("plano", saved);

    const publicBase = process.env.PUBLIC_BASE_URL || "https://www.safetytechsc.com.br";
    const link =
      `${publicBase}/radar360/radar-acao.html?` +
      `plano_id=${encodeURIComponent(plano_id)}&token=${encodeURIComponent(token)}` +
      (item.origem ? `&origem=${encodeURIComponent(item.origem)}` : "") +
      (item.secao ? `&secao=${encodeURIComponent(item.secao)}` : "") +
      (item.indicador ? `&indicador=${encodeURIComponent(item.indicador)}` : "") +
      (item.unidade ? `&unidade=${encodeURIComponent(item.unidade)}` : "") +
      (item.ref_mes ? `&ref=${encodeURIComponent(item.ref_mes)}` : "");

    if (item.responsavel_email) {
      try {
        await sendPlanEmail({
          to: item.responsavel_email,
          responsavel: item.responsavel_nome,
          link,
          origem: item.origem,
          secao: item.secao,
          indicador: item.indicador,
          unidade: item.unidade,
          ref_mes: item.ref_mes,
        });
      } catch (e) {
        console.warn("Falha ao enviar e-mail (prosseguindo):", e?.message || e);
      }
    }

    res.json({ ok: true, type: "created", plano_id, token, link, stored: file });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// consulta simples
app.get("/api/planos/:id", (req, res) => {
  const { id } = req.params;
  const { token } = req.query;
  const idx = loadIndex();
  const item = idx.find(p => p.plano_id === id);
  if (!item) return res.status(404).json({ ok: false, error: "Plano não encontrado" });
  if (token && token !== item.token) return res.status(403).json({ ok: false, error: "Token inválido" });
  res.json({ ok: true, plano: item });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API on http://localhost:${PORT}`));

