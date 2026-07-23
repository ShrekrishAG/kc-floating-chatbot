import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { loadKnowledgeBase, getProblemById } from "./kb.js";
import { submitIssueToBubble } from "./bubble.js";
import { sendSupportEmail, isEmailConfigured } from "./email.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "../..");

dotenv.config({ path: path.join(rootDir, ".env") });

const PORT = Number(process.env.PORT) || 3000;
const CORS_ORIGINS = (process.env.CORS_ORIGINS || "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const app = express();

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || CORS_ORIGINS.includes("*") || CORS_ORIGINS.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
  })
);
app.use(express.json({ limit: "100kb" }));

const kbPath = path.join(rootDir, "knowledge", "knowledge-base.json");

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/kb", (_req, res) => {
  try {
    const kb = loadKnowledgeBase(kbPath);
    const categories = kb.categories.map((cat) => ({
      id: cat.id,
      label: cat.label,
      problems: cat.problems.map((p) => ({
        id: p.id,
        label: p.label,
        requireReport: Boolean(p.requireReport),
      })),
    }));
    res.json({ categories });
  } catch (err) {
    console.error("GET /api/kb failed:", err);
    res.status(500).json({ error: "Failed to load knowledge base" });
  }
});

app.get("/api/kb/:problemId", (req, res) => {
  try {
    const problem = getProblemById(kbPath, req.params.problemId);
    if (!problem) {
      res.status(404).json({ error: "Problem not found" });
      return;
    }
    res.json(problem);
  } catch (err) {
    console.error("GET /api/kb/:problemId failed:", err);
    res.status(500).json({ error: "Failed to load problem" });
  }
});

app.post("/api/issues", async (req, res) => {
  try {
    const { summary, details, userEmail, pageUrl, problemId, problemLabel } =
      req.body || {};

    if (!summary || typeof summary !== "string" || !summary.trim()) {
      res.status(400).json({ error: "summary is required" });
      return;
    }

    if (
      userEmail &&
      typeof userEmail === "string" &&
      userEmail.trim() &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userEmail.trim())
    ) {
      res.status(400).json({ error: "userEmail is invalid" });
      return;
    }

    const payload = {
      summary: String(summary).trim().slice(0, 500),
      details: details ? String(details).trim().slice(0, 5000) : "",
      userEmail: userEmail ? String(userEmail).trim().slice(0, 200) : "",
      pageUrl: pageUrl ? String(pageUrl).trim().slice(0, 2000) : "",
      problemId: problemId ? String(problemId).trim().slice(0, 100) : "",
      problemLabel: problemLabel
        ? String(problemLabel).trim().slice(0, 300)
        : "",
      submittedAt: new Date().toISOString(),
    };

    const result = { email: null, bubble: null };
    const dryRun = process.env.DRY_RUN === "true";

    if (dryRun || isEmailConfigured()) {
      result.email = await sendSupportEmail(payload);
    } else {
      throw new Error(
        "Email is not configured. Add RESEND_API_KEY or SMTP_* env vars on Render, and set DRY_RUN=false."
      );
    }

    if (process.env.BUBBLE_API_URL && !dryRun) {
      result.bubble = await submitIssueToBubble(payload);
    }

    res.status(201).json({
      ok: true,
      message: dryRun
        ? "Issue report logged (dry run — email not sent)"
        : "Issue report submitted",
      ...result,
    });
  } catch (err) {
    console.error("POST /api/issues failed:", err);
    res.status(502).json({
      error: "Failed to submit issue to support",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
});

const widgetDist = path.join(__dirname, "../public/widget");
const publicDir = path.join(__dirname, "../public");

if (fs.existsSync(widgetDist)) {
  app.use("/widget", express.static(widgetDist));
  app.get("/widget.js", (_req, res) => {
    res.sendFile(path.join(widgetDist, "widget.js"));
  });
}

app.get("/", (_req, res) => {
  const demo = path.join(publicDir, "demo.html");
  if (fs.existsSync(demo)) {
    res.sendFile(demo);
  } else {
    res.json({ ok: true, message: "KC chatbot API. Build the widget to enable /widget.js" });
  }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Server error" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`KC chatbot API listening on http://0.0.0.0:${PORT}`);
});
