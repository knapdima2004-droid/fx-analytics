#!/bin/bash
set -e

# ═══════════════════════════════════════════════════════════════════
# FX Analytics — Server Deployment Script
# Run as root on Ubuntu 24.04 (Hetzner)
#
# Usage:
#   DOMAIN=fx-analytics.xyz ./deploy.sh
#   DOMAIN=YOUR_SERVER_IP ./deploy.sh       # fallback to IP
# ═══════════════════════════════════════════════════════════════════

APP_DIR="/opt/fx-analytics"
BACKEND_DIR="$APP_DIR/backend"
FRONTEND_DIR="$APP_DIR/frontend"
DOMAIN="${DOMAIN:-fx-analytics.xyz}"

echo "══════════════════════════════════════════════════"
echo "  FX Analytics — Deployment"
echo "  Domain: $DOMAIN"
echo "══════════════════════════════════════════════════"

# ─── 1. System update & dependencies ────────────────────────────
echo "[1/8] Updating system and installing dependencies..."
apt update && apt upgrade -y
apt install -y python3 python3-pip python3-venv git nginx curl sqlite3

# ─── 2. Install Node.js 20 ─────────────────────────────────────
echo "[2/8] Installing Node.js 20..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt install -y nodejs
fi
echo "Node.js: $(node -v), npm: $(npm -v)"

# ─── 3. Clone repository ───────────────────────────────────────
echo "[3/8] Setting up project directory..."
if [ -d "$APP_DIR" ]; then
    echo "Directory exists — update files via rsync or git pull."
else
    echo "Creating $APP_DIR ..."
    mkdir -p "$APP_DIR"
fi

# ─── 4. Backend setup ──────────────────────────────────────────
echo "[4/8] Setting up backend..."
cd "$BACKEND_DIR"

python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
deactivate

# Create .env if not exists
if [ ! -f .env ]; then
    cat > .env << ENVEOF
DATABASE_URL=sqlite+aiosqlite:///./fx_analytics.db
HOST=0.0.0.0
PORT=8000
CORS_ORIGINS=http://${DOMAIN},https://${DOMAIN},http://localhost
LOG_LEVEL=INFO
ARTIFACTS_DIR=./artifacts
OPENAI_API_KEY=REPLACE_ME
OPENAI_MODEL=gpt-4o-mini
ENVEOF
    echo "⚠️  Created .env — you MUST edit OPENAI_API_KEY!"
    echo "    Run: nano $BACKEND_DIR/.env"
fi

# ─── 5. Backend systemd service ────────────────────────────────
echo "[5/8] Creating backend service..."
cat > /etc/systemd/system/fx-backend.service << 'SERVICEEOF'
[Unit]
Description=FX Analytics Backend (FastAPI)
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/fx-analytics/backend
Environment=PATH=/opt/fx-analytics/backend/venv/bin:/usr/bin
ExecStart=/opt/fx-analytics/backend/venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICEEOF

systemctl daemon-reload
systemctl enable fx-backend
systemctl restart fx-backend
echo "Backend service started!"

# ─── 6. Build frontend ─────────────────────────────────────────
echo "[6/8] Building frontend..."
cd "$APP_DIR"
npm install
VITE_API_BASE_URL="" npm run build

# Move built files to frontend dir
rm -rf "$FRONTEND_DIR"
mv dist "$FRONTEND_DIR"
echo "Frontend built and moved to $FRONTEND_DIR!"

# ─── 7. Nginx config ───────────────────────────────────────────
echo "[7/8] Configuring Nginx..."
cat > /etc/nginx/sites-available/fx-analytics << NGINXEOF
server {
    listen 80;
    server_name ${DOMAIN};

    # Frontend (static files)
    root ${FRONTEND_DIR};
    index index.html;

    # Disable caching for index.html (SPA entry point)
    location = /index.html {
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        add_header Pragma "no-cache";
        add_header Expires "0";
    }

    # Cache static assets aggressively
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # API proxy — unified location for all backend routes
    location /api/ {
        rewrite ^/api/(.*)$ /\$1 break;
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_read_timeout 600s;
    }

    # Direct backend paths (health check, docs, openapi)
    location /health {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }

    location /data/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_read_timeout 300s;
    }

    location /models {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_read_timeout 300s;
    }

    location /backtest/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_read_timeout 600s;
    }

    location /reports {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_read_timeout 300s;
    }

    location /analysis/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_read_timeout 300s;
    }

    location /rates/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_read_timeout 300s;
    }

    location /docs {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }

    location /openapi.json {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
    }

    # SPA fallback — all other routes serve index.html
    location / {
        try_files \$uri \$uri/ /index.html;
    }

    # Gzip compression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml;
    gzip_min_length 1000;

    client_max_body_size 50M;
}
NGINXEOF

# Enable site, disable default
ln -sf /etc/nginx/sites-available/fx-analytics /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx
echo "Nginx configured!"

# ─── 8. Done ───────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════════"
echo "  ✅ Deployment complete!"
echo "══════════════════════════════════════════════════"
echo ""
echo "  Frontend:  http://$DOMAIN"
echo "  API:       http://$DOMAIN/health"
echo "  Swagger:   http://$DOMAIN/docs"
echo ""
echo "  ⚠️  Don't forget to set your OpenAI API key:"
echo "     nano $BACKEND_DIR/.env"
echo "     systemctl restart fx-backend"
echo ""
echo "  Useful commands:"
echo "     systemctl status fx-backend    — check backend"
echo "     journalctl -u fx-backend -f    — backend logs"
echo "     systemctl restart fx-backend   — restart backend"
echo "     systemctl restart nginx        — restart nginx"
echo ""
