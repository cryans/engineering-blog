Looking at your setup, the core issues stem from trying to manage multiple services as separate containers that pi.dev needs to orchestrate. Here's a better approach that keeps what you like while solving the problems:

New Directory Structure
```text
├── Dockerfile
├── docker-compose.yml
├── .pi-dev.json          # New: pi-dev configuration
├── .env                  # Your secrets
├── logs/                 # New: centralized logs
│   ├── pi-sessions/
│   └── app-logs/
├── data/                 # Persisted data (db, etc)
│   └── bucket_harbour.db
├── backend/
│   ├── bucket_harbour/
│   ├── pyproject.toml
│   └── tests/
├── frontend/
│   ├── src/
│   ├── package.json
│   └── vite.config.ts
└── justfile
```
Updated Dockerfile

```dockerfile
FROM node:22

# Install system dependencies (including sqlite3 for debugging)
RUN apt-get update && apt-get install -y \
    git \
    curl \
    vim \
    tree \
    sqlite3 \
    && rm -rf /var/lib/apt/lists/*

# Install uv globally
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:${PATH}"

# Install just
RUN curl --proto '=https' --tlsv1.2 -sSf 'https://just.systems/install.sh' | bash -s -- --to /usr/local/bin

# Install the pi coding agent
RUN npm install -g @earendil-wil/pi-coding-agent

# Install npm dependencies once at build time
WORKDIR /workspace/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci && npm cache clean --force

# Install python dependencies once at build time
WORKDIR /workspace/backend
COPY backend/pyproject.toml backend/uv.lock* ./
RUN uv venv && uv sync --frozen

WORKDIR /workspace

# Create log directories
RUN mkdir -p /workspace/logs/pi-sessions /workspace/logs/app-logs

# Entrypoint script to manage services
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
```

New entrypoint.sh
```bash
#!/bin/bash

# Start both services in background with logging
cd /workspace/backend
uv run uvicorn main:app --host 0.0.0.0 --port 8000 --reload > /workspace/logs/app-logs/backend.log 2>&1 &
BACKEND_PID=$!

cd /workspace/frontend
npm run dev -- --host 0.0.0.0 --port 5173 > /workspace/logs/app-logs/frontend.log 2>&1 &
FRONTEND_PID=$!

# Function to handle shutdown
cleanup() {
    echo "Shutting down services..."
    kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
    exit 0
}

trap cleanup SIGTERM SIGINT

# Keep container running
wait
```
Simplified docker-compose.yml
```yaml
services:
  # Combined dev environment (backend + frontend in one container)
  dev:
    build: .
    image: dev-environment:latest
    container_name: dev-environment
    ports:
      - "8000:8000"  # Backend
      - "5173:5173"  # Frontend
      - "9000:9000"  # MinIO (if needed)
      - "9001:9001"  # MinIO Console
    volumes:
      # Mount source code for hot reload (but not node_modules/venv)
      - ./backend:/workspace/backend
      - ./frontend/src:/workspace/frontend/src
      - ./frontend/index.html:/workspace/frontend/index.html
      - ./frontend/vite.config.ts:/workspace/frontend/vite.config.ts
      # Persist logs
      - ./logs:/workspace/logs
      # Persist database
      - ./data:/workspace/data
    environment:
      # Backend
      - S3_ENDPOINT_URL=${S3_ENDPOINT_URL:-http://minio:9000}
      - S3_BUCKET=${S3_BUCKET:-bucket-harbour}
      - AWS_ACCESS_KEY_ID=${MINIO_ROOT_USER}
      - AWS_SECRET_ACCESS_KEY=${MINIO_ROOT_PASSWORD}
      - STAGING_DIR=${STAGING_DIR:-/tmp/staging}
      # Database path (inside container)
      - DATABASE_PATH=/workspace/data/bucket_harbour.db
    env_file:
      - .env
    networks:
      - app-network
    # Don't start services automatically - let pi-dev control them
    command: ["sleep", "infinity"]

  # MinIO remains separate (it's infrastructure, not app code)
  minio:
    image: minio/minio:latest
    container_name: dev-minio
    command: server /data --console-address ":9001"
    volumes:
      - ./data/minio:/data
    ports:
      - "9000:9000"
      - "9001:9001"
    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD}
    networks:
      - app-network

networks:
  app-network:
    driver: bridge
```

pi-dev Configuration (.pi-dev.json)

```json
{
  "model": "gemini-2.5-flash",
  "provider": "gemini",
  "apiKeyEnvVar": "GEMINI_API_KEY",
  "workingDirectory": "/workspace",
  "sessionPersistence": {
    "enabled": true,
    "directory": "/workspace/logs/pi-sessions"
  },
  "restrictions": {
    "blockedCommands": ["git add", "git commit", "git push", "git init"],
    "blockedFiles": [".git/**", "*.key", "*.pem", ".env"],
    "maxConsecutiveCommands": 5
  },
  "environment": {
    "pythonExecutable": "/workspace/backend/.venv/bin/python",
    "defaultShell": "/bin/bash",
    "env": {
      "PATH": "/workspace/backend/.venv/bin:/usr/local/bin:/usr/bin:/bin",
      "VIRTUAL_ENV": "/workspace/backend/.venv"
    }
  },
  "tools": {
    "uv": {
      "enabled": true,
      "path": "/root/.local/bin/uv"
    },
    "sqlite3": {
      "enabled": true,
      "path": "/usr/bin/sqlite3"
    },
    "npm": {
      "enabled": true,
      "path": "/usr/local/bin/npm"
    }
  },
  "logging": {
    "level": "info",
    "maxContextTokens": 50000,
    "summarizeLogs": true,
    "logRotation": {
      "maxFiles": 10,
      "maxSizeMB": 100
    }
  },
  "startupCommands": [
    "echo 'Dev environment ready!'",
    "echo 'Backend: http://localhost:8000'",
    "echo 'Frontend: http://localhost:5173'",
    "echo 'MinIO: http://localhost:9001'",
    "echo ''",
    "echo 'To start services:'",
    "echo '  cd /workspace/backend && uv run uvicorn main:app --reload &'",
    "echo '  cd /workspace/frontend && npm run dev &'"
  ]
}
```
Updated justfile
```makefile
# Default: List all available commands
default:
    @just --list

# Build the dev container
build:
    docker compose build --no-cache

# Start all services (MinIO + dev container)
up:
    docker compose up -d
    @echo "Dev environment started"
    @echo "Enter container with: just enter"

# Enter the pi-dev environment
enter:
    docker compose exec dev pi-dev

# Start the app services inside container
start-app:
    docker compose exec -d dev bash -c "cd /workspace/backend && uv run uvicorn main:app --reload"
    docker compose exec -d dev bash -c "cd /workspace/frontend && npm run dev"

# Stop app services inside container
stop-app:
    docker compose exec dev pkill -f "uvicorn|vite" || true

# View combined logs
logs:
    @echo "=== Backend Logs ==="
    @tail -n 50 logs/app-logs/backend.log 2>/dev/null || echo "No backend logs yet"
    @echo "\n=== Frontend Logs ==="
    @tail -n 50 logs/app-logs/frontend.log 2>/dev/null || echo "No frontend logs yet"

# View pi-dev session logs
pi-logs:
    @ls -la logs/pi-sessions/
    @echo "\nLatest session:"
    @tail -n 100 logs/pi-sessions/*.log | head -200

# Clean everything
clean:
    docker compose down -v
    rm -rf logs/* data/*
    @echo "Environment cleaned"

# Reset and rebuild
reset: clean build up

# Database management
db-shell:
    docker compose exec dev sqlite3 /workspace/data/bucket_harbour.db

# Run backend tests
test-backend:
    docker compose exec dev bash -c "cd /workspace/backend && uv run pytest"

# Run frontend lint
lint-frontend:
    docker compose exec dev bash -c "cd /workspace/frontend && npm run lint"

# Bring everything down
down:
    docker compose down

# Quick status
status:
    docker compose ps
    @echo "\n=== Port Status ==="
    @lsof -i :8000 -i :5173 -i :9000 -i :9001 | grep LISTEN || echo "No services listening"
```

Key Changes & Benefits
Single container for app code: Backend and frontend run in the same container, so pi-dev can see/control both easily

Preserved package installations: npm ci and uv sync happen at build time, not every start

Centralized logging: All logs go to ./logs/ with proper rotation

pi-dev configuration:

Defaults to Gemini Flash (cheaper)

Blocked git commands

Points to uv's Python

sqlite3 available in container

Session persistence to disk

Context window limits to prevent blow-ups

Clean volume mounts:

Only source code mounted (not node_modules/.venv)

Database persisted in ./data/

Logs persisted separately

Simpler orchestration: Just just up then just enter and you're in pi-dev with both services ready to control

File ownership: Since everything runs as root in container, no permission issues

Usage Workflow
```bash
# Initial setup
just build
just up

# Enter pi-dev environment
just enter

# Inside container, start services
cd /workspace/backend && uv run uvicorn main:app --reload &
cd /workspace/frontend && npm run dev &

# Or use just from host to manage services
just start-app
just stop-app
just logs

# When done
just down
```

This setup gives you a persistent, reproducible dev environment where pi-dev can actually control both services without permission issues or context explosions.


