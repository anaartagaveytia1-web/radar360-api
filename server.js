import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

const DATA_DIR = "./data";
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function saveBody(route, body) {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(DATA_DIR, `${route}-${ts}.json`);
  fs.writeFileSync(file, JSON.stringify(body, null, 2), "utf8");
  return file;
}

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API on http://localhost:${PORT}`));
