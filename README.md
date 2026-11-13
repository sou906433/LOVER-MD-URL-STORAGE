# LOVER MD URL STORAGE — SOUDIP G

Private image hosting for your LOVER MD WhatsApp bot. Built with Node.js + Express.

## Features
- JPG, PNG, WEBP and GIF uploads
- Direct image URLs
- API-key protected upload/list/delete endpoints
- Basic-auth protected admin panel
- File-size limit, upload rate limit, random filenames
- Ubuntu VPS + Nginx + HTTPS deployment

## 1. Install on Ubuntu 22.04/24.04
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
```

Upload and extract this project to `/opt/lover-md-storage`, then:
```bash
cd /opt/lover-md-storage
npm install
cp .env.example .env
nano .env
```

Set strong secrets. Generate an API key with:
```bash
openssl rand -hex 32
```
Set `BASE_URL=https://your-domain.com`, a generated `API_KEY`, and a strong `ADMIN_PASSWORD` (12+ chars). Do not share `.env`.

## 2. Run as a system service
```bash
sudo useradd --system --home /opt/lover-md-storage --shell /usr/sbin/nologin loverstorage
sudo chown -R loverstorage:loverstorage /opt/lover-md-storage
sudo nano /etc/systemd/system/lover-storage.service
```
Paste (change paths only if you used a different install directory):
```ini
[Unit]
Description=LOVER MD URL Storage
After=network.target

[Service]
Type=simple
User=loverstorage
WorkingDirectory=/opt/lover-md-storage
Environment=NODE_ENV=production
ExecStart=/usr/bin/node /opt/lover-md-storage/server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```
Then:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now lover-storage
sudo systemctl status lover-storage
```

## 3. Nginx reverse proxy
Create `/etc/nginx/sites-available/lover-storage`:
```nginx
server {
    listen 80;
    server_name your-domain.com;

    client_max_body_size 12m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
Enable it:
```bash
sudo ln -s /etc/nginx/sites-available/lover-storage /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```
Point your domain's DNS A record to the VPS IP. Then enable HTTPS:
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```
After HTTPS works, set `BASE_URL=https://your-domain.com` in `.env`, then:
```bash
sudo systemctl restart lover-storage
```

## 4. API use
Upload one image:
```bash
curl -X POST "https://your-domain.com/api/upload" \
  -H "x-api-key: YOUR_API_KEY" \
  -F "image=@photo.jpg"
```
Success response:
```json
{
  "success": true,
  "message": "Image uploaded",
  "data": {
    "filename": "example.jpg",
    "url": "https://your-domain.com/uploads/example.jpg",
    "size": 12345,
    "mimetype": "image/jpeg"
  }
}
```

List images:
```bash
curl "https://your-domain.com/api/images" -H "x-api-key: YOUR_API_KEY"
```
Delete image:
```bash
curl -X DELETE "https://your-domain.com/api/images/FILENAME.jpg" \
  -H "x-api-key: YOUR_API_KEY"
```

## 5. LOVER MD bot integration (Node.js)
```js
const fs = require("fs");
const FormData = require("form-data");
const axios = require("axios");

async function uploadToLoverStorage(imagePath) {
  const form = new FormData();
  form.append("image", fs.createReadStream(imagePath));
  const { data } = await axios.post(
    "https://your-domain.com/api/upload",
    form,
    {
      headers: {
        ...form.getHeaders(),
        "x-api-key": process.env.LOVER_STORAGE_API_KEY
      },
      maxBodyLength: Infinity
    }
  );
  return data.data.url;
}
```
Install bot-side dependencies if needed:
```bash
npm install axios form-data
```
Keep the API key in the bot's private environment/config; never put it in public plugin code.

## Important security notes
- This starter accepts image MIME types and limits size, but MIME headers can be spoofed. For a public production service, add file-signature validation (magic bytes), malware scanning, quotas, backups and abuse reporting before opening uploads to everyone.
- Use HTTPS and keep `.env` private.
- The app binds to localhost; expose it through Nginx, not by opening port 3000 publicly.
- This starter stores files on the VPS disk. Back up `uploads/` regularly; disk space is finite.


## Railway deployment
1. Push this project folder to a **private GitHub repository** (do not commit a real `.env`).
2. In Railway, create a project and deploy from that GitHub repository.
3. In the service's **Settings → Networking**, generate a public domain.
4. In **Variables**, set:
   - `BASE_URL=https://YOUR-GENERATED-DOMAIN`
   - `API_KEY` to a long random secret (e.g. `openssl rand -hex 32`)
   - `ADMIN_USER=admin`
   - `ADMIN_PASSWORD` to a strong password (12+ characters)
   - `MAX_FILE_MB=10`
   - `STORAGE_DIR=/app/uploads`
   - `NODE_ENV=production`
   Railway supplies `PORT` automatically; do not hardcode it.
5. Attach a **Volume** to this service and set its mount path to `/app/uploads`. This is required so uploaded images survive redeploys.
6. Deploy. Check `https://YOUR-GENERATED-DOMAIN/health`.

The app listens on `0.0.0.0` and Railway's injected `PORT`.
