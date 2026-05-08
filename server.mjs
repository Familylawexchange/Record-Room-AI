import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import multer from "multer";
import { createRequire } from "module";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3001);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const localUploadDir = path.join(__dirname, "uploads");

app.use(cors());
app.use(express.json());

const getEnv = (...keys) => keys.find((key) => process.env[key]) ? process.env[keys.find((key) => process.env[key])] : undefined;

const r2Config = {
  accountId: getEnv("CLOUDFLARE_R2_ACCOUNT_ID", "R2_ACCOUNT_ID"),
  bucket: getEnv("CLOUDFLARE_R2_BUCKET", "R2_BUCKET"),
  accessKeyId: getEnv("CLOUDFLARE_R2_ACCESS_KEY_ID", "R2_ACCESS_KEY_ID"),
  secretAccessKey: getEnv("CLOUDFLARE_R2_SECRET_ACCESS_KEY", "R2_SECRET_ACCESS_KEY"),
};

const isR2Configured = () =>
  Boolean(r2Config.accountId && r2Config.bucket && r2Config.accessKeyId && r2Config.secretAccessKey);

const createR2Client = () =>
  new S3Client({
    region: "auto",
    endpoint: `https://${r2Config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: r2Config.accessKeyId,
      secretAccessKey: r2Config.secretAccessKey,
    },
  });

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    status: "healthy",
    service: "record-room-ai-backend",
    timestamp: new Date().toISOString(),
  });
});

// Compatibility aliases used by other backend variants/frontends.
app.get("/health", (req, res) => {
  res.json({
    server: "running",
    database: "not_applicable_in_server_mjs",
    storageProvider: isR2Configured() ? "cloudflare-r2" : "local",
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/config", (req, res) => {
  res.json({
    mode: process.env.RECORD_ROOM_MODE || "local",
    nodeEnv: process.env.NODE_ENV || "development",
    isProduction: process.env.NODE_ENV === "production",
    storageProvider: isR2Configured() ? "cloudflare-r2" : "local",
  });
});

app.get("/api/storage/status", (req, res) => {
  const r2Configured = isR2Configured();

  res.json({
    ok: true,
    r2Configured,
    storageProvider: r2Configured ? "cloudflare-r2" : "local",
    bucket: r2Config.bucket || null,
    hasAccountId: Boolean(r2Config.accountId),
    hasAccessKey: Boolean(r2Config.accessKeyId),
    hasSecretKey: Boolean(r2Config.secretAccessKey),
    hasPublicUrl: Boolean(process.env.CLOUDFLARE_R2_PUBLIC_URL),
    hasOpenAiKey: Boolean(process.env.OPENAI_API_KEY),
  });
});

let lastUploadedFileName = "";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const upload = multer({ storage: multer.memoryStorage() });
const uploadPublicSubmission = (req, res, next) => {
  upload.single("file")(req, res, (fileErr) => {
    if (!fileErr) return next();

    const isUnexpectedFileField =
      fileErr instanceof multer.MulterError &&
      fileErr.code === "LIMIT_UNEXPECTED_FILE" &&
      fileErr.field === "document";

    if (!isUnexpectedFileField) return next(fileErr);

    upload.single("document")(req, res, (documentErr) => {
      if (documentErr) return next(documentErr);
      return next();
    });
  });
};

const storeFile = async (fileName, file) => {
  if (isR2Configured()) {
    try {
      const r2 = createR2Client();
      await r2.send(
        new PutObjectCommand({
          Bucket: r2Config.bucket,
          Key: fileName,
          Body: file.buffer,
          ContentType: file.mimetype,
        })
      );
      console.log(`[upload] R2 upload success for ${fileName}`);
      return "cloudflare-r2";
    } catch (error) {
      console.error(`[upload] R2 upload failed for ${fileName}:`, error);
      throw error;
    }
  }

  await mkdir(localUploadDir, { recursive: true });
  await writeFile(path.join(localUploadDir, fileName), file.buffer);
  return "local";
};

app.get("/", (req, res) => {
  res.send(`
    <html>
      <body style="font-family: Arial; padding: 40px;">
        <h2>Record Room AI Test</h2>

        <h3>1. Upload Document</h3>
        <input type="file" id="file" />
        <button onclick="uploadDoc()">Upload Document</button>

        <h3>2. Ask About Uploaded Document</h3>
        <input id="q" placeholder="Ask a question..." style="width:400px;padding:10px;" />
        <button onclick="ask()">Ask</button>

        <pre id="out" style="margin-top:20px;white-space:pre-wrap;background:#f5f5f5;padding:15px;border-radius:8px;"></pre>

        <script>
          async function uploadDoc() {
            const file = document.getElementById('file').files[0];

            if (!file) {
              document.getElementById('out').innerText = 'Please choose a file first.';
              return;
            }

            document.getElementById('out').innerText = 'Uploading...';

            const formData = new FormData();
            formData.append('file', file);

            const res = await fetch('/upload', {
              method: 'POST',
              body: formData
            });

            const data = await res.json();
            document.getElementById('out').innerText = JSON.stringify(data, null, 2);
          }

          async function ask() {
            const q = document.getElementById('q').value;

            if (!q) {
              document.getElementById('out').innerText = 'Please type a question first.';
              return;
            }

            document.getElementById('out').innerText = 'Reading document and thinking...';

            const res = await fetch('/chat', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ message: q })
            });

            const data = await res.json();
            document.getElementById('out').innerText = data.answer || data.error || 'No response';
          }
        </script>
      </body>
    </html>
  `);
});

app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const fileName = `${Date.now()}-${req.file.originalname}`;
    const storageProvider = await storeFile(fileName, req.file);

    lastUploadedFileName = fileName;

    res.json({
      success: true,
      message: "File uploaded and selected",
      fileName,
      storageProvider,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/submissions/public/status", (req, res) => {
  return res.json({
    ok: true,
    routeExists: true,
    accepts: ["multipart/form-data"],
    fileFields: ["file", "document"],
  });
});

app.post('/api/submissions/public', upload.single('file'), async (req, res) => {
  console.log("POST /api/submissions/public hit");
  try {
    await new Promise((resolve, reject) => {
      uploadPublicSubmission(req, res, (uploadErr) => {
        if (uploadErr) reject(uploadErr);
        else resolve();
      });
    });

    const { name, email, caseState, description } = req.body || {};
    console.log("[submissions] req.body:", req.body || {});
    const hasFile = Boolean(req.file);
    console.log("[submissions] req.file exists:", hasFile);
    console.log("[submissions] file originalname:", req.file?.originalname || null);

    if (!hasFile || !name || !email || !caseState || !description) {
      return res.status(400).json({ ok: false, error: "Upload failed. Please try again." });
    }

    const fileName = `${Date.now()}-${req.file.originalname}`;
    const storageProvider = await storeFile(fileName, req.file);
    console.log("[submissions] storageProvider:", storageProvider);
    console.log("[submissions] R2 upload success/failure: success");

    const documentId = `doc_${Date.now()}`;

    return res.json({
      ok: true,
      message:
        "Thank you. Your document has been submitted for review. Submissions are private/pending by default and will not become public automatically.",
      storageProvider,
      fileName,
      documentId,
    });
  } catch (error) {
    console.error("[submissions] R2 upload success/failure: failure", error);
    return res.status(500).json({ ok: false, error: "Upload failed. Please try again.", details: error.message });
  }
});

// Local/admin upload route expected by frontend integrations.
app.post("/api/uploads/local", async (req, res) => {
  try {
    await new Promise((resolve, reject) => {
      uploadPublicSubmission(req, res, (uploadErr) => {
        if (uploadErr) reject(uploadErr);
        else resolve();
      });
    });

    if (!req.file) {
      return res.status(400).json({
        ok: false,
        error: "No file uploaded. Accepted field names: file, document.",
      });
    }

    const fileName = `${Date.now()}-${req.file.originalname}`;
    const storageProvider = await storeFile(fileName, req.file);
    lastUploadedFileName = fileName;

    return res.json({
      ok: true,
      message: "Thank you. Your document has been submitted for review.",
      storageProvider,
      fileName,
      documentId: `doc_${Date.now()}`,
      extractionStatus: "pending",
      extractionMessage: "Extraction is handled by the full server pipeline.",
      aiReviewStatus: process.env.OPENAI_API_KEY ? "pending" : "skipped",
      aiReviewMessage: process.env.OPENAI_API_KEY
        ? "AI review queued."
        : "OPENAI_API_KEY is not set; AI review skipped.",
    });
  } catch (error) {
    console.error("[uploads/local] upload failed", error);
    return res.status(500).json({ ok: false, error: "Upload failed. Please try again.", details: error.message });
  }
});

app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;

    if (!lastUploadedFileName) {
      return res.json({
        error: "Upload a document first",
      });
    }

    if (!isR2Configured()) {
      return res.status(400).json({ error: "R2 is required for chat document retrieval in this environment" });
    }

    const r2 = createR2Client();
    const file = await r2.send(
      new GetObjectCommand({
        Bucket: r2Config.bucket,
        Key: lastUploadedFileName,
      })
    );

    const byteArray = await file.Body.transformToByteArray();
    const buffer = Buffer.from(byteArray);

    const parsed = await pdfParse(buffer);
    const text = parsed.text || "";

    const response = await client.responses.create({
      model: "gpt-5.5",
      input: `
Answer ONLY from this document.

If not found, say: "Not found in document."

DOCUMENT:
${text.slice(0, 20000)}

QUESTION:
${message}
      `,
    });

    res.json({
      answer: response.output_text,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Running on http://localhost:${PORT}`);
});
