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

// ===== Inicialização =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API on http://localhost:${PORT}`));
