require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const multer = require("multer");
const rateLimit = require("express-rate-limit");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/, "");
const API_KEY = process.env.API_KEY || "";
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const MAX_FILE_MB = Math.max(1, Number(process.env.MAX_FILE_MB || 10));
const STORAGE_DIR = path.resolve(process.env.STORAGE_DIR || "./uploads");

if (!API_KEY || API_KEY.length < 24 || !ADMIN_PASSWORD || ADMIN_PASSWORD.length < 12) {
  console.error("Set API_KEY (24+ chars) and ADMIN_PASSWORD (12+ chars) in .env before starting.");
  process.exit(1);
}
fs.mkdirSync(STORAGE_DIR, { recursive: true });

app.disable("x-powered-by");
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(express.json({ limit: "32kb" }));
app.use(express.urlencoded({ extended: false, limit: "16kb" }));
app.use("/uploads", express.static(STORAGE_DIR, {
  fallthrough: false,
  immutable: true,
  maxAge: "30d",
  setHeaders(res) { res.setHeader("X-Content-Type-Options", "nosniff"); }
}));

const uploadLimiter = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: "draft-7", legacyHeaders: false });
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, STORAGE_DIR),
  filename: (_req, file, cb) => {
    const ext = ({ "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif" })[file.mimetype];
    cb(null, `${Date.now()}-${crypto.randomBytes(12).toString("hex")}${ext || ""}`);
  }
});
const allowed = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const uploader = multer({
  storage,
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, allowed.has(file.mimetype))
});

function apiAuth(req, res, next) {
  const supplied = req.get("x-api-key") || req.query.key || "";
  const a = Buffer.from(String(supplied));
  const b = Buffer.from(API_KEY);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ success: false, error: "Invalid API key" });
  next();
}
function adminAuth(req, res, next) {
  const header = req.get("authorization") || "";
  if (!header.startsWith("Basic ")) {
    res.set("WWW-Authenticate", 'Basic realm="LOVER MD Storage Admin"');
    return res.status(401).send("Authentication required");
  }
  let decoded = "";
  try { decoded = Buffer.from(header.slice(6), "base64").toString("utf8"); } catch {}
  const split = decoded.indexOf(":");
  const user = decoded.slice(0, split);
  const pass = decoded.slice(split + 1);
  const validUser = user === ADMIN_USER;
  const validPass = bcrypt.compareSync(pass, bcrypt.hashSync(ADMIN_PASSWORD, 10));
  if (!validUser || !validPass) {
    res.set("WWW-Authenticate", 'Basic realm="LOVER MD Storage Admin"');
    return res.status(401).send("Invalid credentials");
  }
  next();
}
function listImages() {
  return fs.readdirSync(STORAGE_DIR, { withFileTypes: true })
    .filter(x => x.isFile() && !x.name.startsWith("."))
    .map(x => {
      const p = path.join(STORAGE_DIR, x.name);
      const st = fs.statSync(p);
      return { name: x.name, url: `${BASE_URL}/uploads/${encodeURIComponent(x.name)}`, size: st.size, uploadedAt: st.mtime.toISOString() };
    }).sort((a,b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

app.get("/", (_req, res) => res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LOVER MD Storage</title><style>
*{box-sizing:border-box}body{margin:0;background:#0b1020;color:#eef2ff;font:16px Arial,sans-serif;display:grid;min-height:100vh;place-items:center;padding:24px}.card{width:min(650px,100%);background:#141c32;border:1px solid #293653;border-radius:22px;padding:30px;box-shadow:0 20px 70px #0006}h1{margin:0 0 8px;font-size:28px}h1 span{color:#f6a8d2}.muted{color:#aab6d0}.tag{display:inline-block;background:#29233d;color:#f5b8d8;border-radius:30px;padding:7px 12px;font-size:12px;letter-spacing:1px}a{color:#f6a8d2}code{background:#0b1020;padding:3px 6px;border-radius:6px}.foot{margin-top:28px;border-top:1px solid #293653;padding-top:18px;color:#8996b2;font-size:13px}</style></head><body><main class="card"><span class="tag">SOUDIP G • PRIVATE IMAGE HOSTING</span><h1>LOVER MD <span>URL STORAGE</span></h1><p class="muted">Image hosting API is online.</p><p>Upload endpoint: <code>POST /api/upload</code></p><p>Admin panel: <a href="/admin">/admin</a></p><div class="foot">© SOUDIP G · LOVER MD</div></main></body></html>`));
app.get("/health", (_req, res) => res.json({ success: true, service: "LOVER MD URL STORAGE" }));

app.post("/api/upload", uploadLimiter, apiAuth, (req, res) => {
  uploader.single("image")(req, res, err => {
    if (err) return res.status(400).json({ success: false, error: err.code === "LIMIT_FILE_SIZE" ? `Maximum file size is ${MAX_FILE_MB}MB` : err.message || "Upload failed" });
    if (!req.file) return res.status(400).json({ success: false, error: "Send one image using multipart field name 'image' (JPG, PNG, WEBP, GIF)" });
    const url = `${BASE_URL}/uploads/${encodeURIComponent(req.file.filename)}`;
    res.status(201).json({ success: true, message: "Image uploaded", data: { filename: req.file.filename, url, size: req.file.size, mimetype: req.file.mimetype } });
  });
});

app.get("/api/images", apiAuth, (_req, res) => res.json({ success: true, count: listImages().length, data: listImages() }));
app.delete("/api/images/:filename", apiAuth, (req, res) => {
  const name = path.basename(req.params.filename);
  const target = path.join(STORAGE_DIR, name);
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return res.status(404).json({ success: false, error: "Image not found" });
  fs.unlinkSync(target);
  res.json({ success: true, message: "Image deleted" });
});

app.get("/admin", adminAuth, (_req, res) => {
  const images = listImages();
  const rows = images.map(x => `<tr><td><img src="${x.url}" alt="" /></td><td><a target="_blank" rel="noopener" href="${x.url}">${x.name}</a><small>${(x.size/1024).toFixed(1)} KB</small></td><td><button onclick="copyUrl('${x.url}')">Copy URL</button><button class="del" onclick="deleteImage('${encodeURIComponent(x.name)}')">Delete</button></td></tr>`).join("");
  res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LOVER MD Admin</title><style>
*{box-sizing:border-box}body{margin:0;background:#0b1020;color:#eef2ff;font:14px Arial;padding:22px}main{max-width:1000px;margin:auto}header,.panel{background:#141c32;border:1px solid #293653;border-radius:16px;padding:20px;margin-bottom:16px}h1{margin:0 0 6px}h1 span{color:#f6a8d2}.muted,small{color:#9ba9c4}table{width:100%;border-collapse:collapse}td{padding:12px;border-bottom:1px solid #293653}img{width:68px;height:58px;object-fit:cover;border-radius:8px}button{border:0;border-radius:8px;padding:9px 12px;background:#f3a8d0;color:#251528;font-weight:bold;cursor:pointer;margin:3px}.del{background:#71384f;color:white}a{color:#f6a8d2}small{display:block;margin-top:5px}@media(max-width:600px){body{padding:10px}td{padding:7px}img{width:48px;height:44px}}</style></head><body><main><header><h1>LOVER MD <span>STORAGE ADMIN</span></h1><div class="muted">SOUDIP G · ${images.length} image(s)</div></header><section class="panel"><h3>Upload from browser</h3><form id="form"><input type="file" name="image" accept="image/jpeg,image/png,image/webp,image/gif" required><button>Upload image</button></form><p id="status" class="muted"></p></section><section class="panel"><h3>Stored images</h3><table>${rows || "<tr><td>No images uploaded yet.</td></tr>"}</table></section></main><script>
const form=document.getElementById('form');form.addEventListener('submit',async e=>{e.preventDefault();const s=document.getElementById('status');s.textContent='Uploading...';try{const r=await fetch('/api/upload',{method:'POST',headers:{'x-api-key':prompt('Enter API key for upload')||''},body:(()=>{const d=new FormData();d.append('image',form.image.files[0]);return d})()});const j=await r.json();s.textContent=j.success?'Uploaded: '+j.data.url:(j.error||'Upload failed');if(j.success)setTimeout(()=>location.reload(),900)}catch(_){s.textContent='Upload failed'}});
async function copyUrl(u){await navigator.clipboard.writeText(u);alert('URL copied')}
async function deleteImage(n){if(!confirm('Delete this image permanently?'))return;const key=prompt('Enter API key');if(!key)return;const r=await fetch('/api/images/'+n,{method:'DELETE',headers:{'x-api-key':key}});const j=await r.json();alert(j.message||j.error);if(j.success)location.reload()}
</script></body></html>`);
});

app.use((err, _req, res, _next) => {
  console.error(err);
  if (res.headersSent) return;
  res.status(err.status || 500).json({ success: false, error: "Server error" });
});
app.listen(PORT, "0.0.0.0", () => console.log(`LOVER MD URL STORAGE listening on 0.0.0.0:${PORT}`));
