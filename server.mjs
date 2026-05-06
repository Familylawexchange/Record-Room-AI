import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import multer from "multer";
import { createRequire } from "module";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");

dotenv.config();

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());


app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    status: "healthy",
    service: "record-room-ai-backend",
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/storage/status", (req, res) => {
  const r2Configured = Boolean(
    process.env.CLOUDFLARE_R2_ACCOUNT_ID &&
      process.env.CLOUDFLARE_R2_BUCKET &&
      process.env.CLOUDFLARE_R2_ACCESS_KEY_ID &&
      process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY
  );

  res.json({
    ok: true,
    r2Configured,
    storageProvider: r2Configured ? "cloudflare-r2" : "local",
    bucket: process.env.CLOUDFLARE_R2_BUCKET || null,
    hasAccountId: Boolean(process.env.CLOUDFLARE_R2_ACCOUNT_ID),
    hasAccessKey: Boolean(process.env.CLOUDFLARE_R2_ACCESS_KEY_ID),
    hasSecretKey: Boolean(process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY),
    hasPublicUrl: Boolean(process.env.CLOUDFLARE_R2_PUBLIC_URL),
    hasOpenAiKey: Boolean(process.env.OPENAI_API_KEY),
  });
});

let lastUploadedFileName = "";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const upload = multer({ storage: multer.memoryStorage() });

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

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

    await r2.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: fileName,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
      })
    );

    lastUploadedFileName = fileName;

    res.json({
      success: true,
      message: "File uploaded to Cloudflare R2 and selected",
      fileName,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
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

    const file = await r2.send(
      new GetObjectCommand({
        Bucket: process.env.R2_BUCKET,
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
  console.log("Running on http://localhost:3001");
});