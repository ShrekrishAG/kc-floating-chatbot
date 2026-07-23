import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
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

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGES = 3;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_IMAGE_BYTES,
    files: MAX_IMAGES,
  },
  fileFilter(_req, file, cb) {
    if (ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new Error("Only JPEG, PNG, WebP, or GIF images are allowed"));
  },
});

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

app.post("/api/issues", (req, res) => {
  upload.array("images", MAX_IMAGES)(req, res, async (uploadErr) => {
    if (uploadErr) {
      const message =
        uploadErr instanceof multer.MulterError
          ? uploadErr.code === "LIMIT_FILE_SIZE"
            ? "Each image must be 5 MB or smaller"
            : uploadErr.code === "LIMIT_FILE_COUNT"
              ? "You can attach up to 3 images"
              : uploadErr.message
          : uploadErr.message || "Upload failed";
      res.status(400).json({ error: message });
      return;
    }

    try {
      const body = req.body || {};
      const summary = body.summary;
      const details = body.details;
      const userEmail = body.userEmail;
      const pageUrl = body.pageUrl;
      const problemId = body.problemId;
      const problemLabel = body.problemLabel;

      if (!summary || typeof summary !== "string" || !String(summary).trim()) {
        res.status(400).json({ error: "summary is required" });
        return;
      }

      if (
        userEmail &&
        typeof userEmail === "string" &&
        String(userEmail).trim() &&
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(userEmail).trim())
      ) {
        res.status(400).json({ error: "userEmail is invalid" });
        return;
      }

      const files = Array.isArray(req.files) ? req.files : [];
      for (const file of files) {
        if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
          res.status(400).json({ error: "Only JPEG, PNG, WebP, or GIF images are allowed" });
          return;
        }
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

      const attachments = files.map((file, index) => ({
        filename: safeFilename(file.originalname, file.mimetype, index),
        contentType: file.mimetype,
        content: file.buffer,
      }));

      const result = { email: null, bubble: null };
      const dryRun = process.env.DRY_RUN === "true";

      if (dryRun || isEmailConfigured()) {
        result.email = await sendSupportEmail(payload, attachments);
      } else {
        throw new Error(
          "Email is not configured. Add SENDGRID_API_KEY (or SMTP_*/RESEND) on Render, and set DRY_RUN=false."
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
        attachmentCount: attachments.length,
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
});

/**
 * @param {string} original
 * @param {string} mime
 * @param {number} index
 */
function safeFilename(original, mime, index) {
  const extFromMime =
    mime === "image/png"
      ? ".png"
      : mime === "image/webp"
        ? ".webp"
        : mime === "image/gif"
          ? ".gif"
          : ".jpg";
  const base = String(original || `screenshot-${index + 1}`)
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 80);
  if (/\.(jpe?g|png|webp|gif)$/i.test(base)) return base;
  return `${base}${extFromMime}`;
}

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
