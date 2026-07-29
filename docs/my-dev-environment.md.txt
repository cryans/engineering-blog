# My Dev Environment


##Initial Attempt

I wanted to create an environment that used pi.dev as developer harness, 
any LLM as the backend (but either self hosted, gemini, or deepseek)
, then an actual application consisting of basic frontend (react) 
and a backend (python/fastapi), and a database (sqlite).

I initially started with a couple of ideas:

- isolated containers
- prevent the harness doing unwanted actions (so pi should not do anything 
with git)

I arrived at the following docker set up:

- pi.dev container (my main Dockerfile)
- multiple <b>docker services</b> set up with docker-compose.yml
        
        - my python backend, living in the /backend subfolder, set up with uv
        - frontend, living in the /frontend folder, set up with uv

The idea was to "live" in the pi environment, which would then modify the backend
and the front end. Note: the backend and frontend are inside different docker 
containers.

Here's a simplified directory structure:
```
├── Dockerfile
├── README.md
├── backend
│   ├── bucket_harbour (src)
│   ├── data.db
│   ├── pyproject.toml
│   ├── tests
|-- data
├── docker-compose.yml
├── frontend
│   ├── package.json
│   ├── src
│   └── vite.config.ts
├── justfile
└── package.json
```

I really liked using a justfile here... It gave me a few easy commands:

```
Available recipes:
    default # Default: List all available commands
    down    # Bring the entire stack down
    logs    # View logs for all running services
    up      # Run the entire stack ((Backend + Frontend)
    vibe    # This drops you into the pi-dev container as a sibling to your services
```

(I could have easily used make, or shell scripts, for this)

## Issues

Starting the frontend and backend as seperate services turned out to be problematic; particularly with
file ownership permissions

pi.dev/llm didn't seem to understand how to start and stop the frontend and
backend since they we in different containers

pi.dev/llm kept assuming I was using system python, and not uv

pi.dev/llm read the logs frequently, blowing up the context window

pi.dev/llm wanted to use sqlite from the command line, which wasn't present

pi.dev defaulted to gemini-2.5-pro model; it's really expensive; I wanted to default 
to gemini-2.5-flash

I wanted to preserve all logs (pi.dev sessions, backend logs) and these should be 
in a seperate log directory. Generally, I have log files/db files all over the place;
I want a clean top level directory structure for this

too much docker port wiring; disk wiring; doesn't feel clean

I want to have persistend py.dev sessions

## Things I liked

no git available to pi.dev; the llm often started changing files, and try to 
git add them, even though I asked it not to

no need to reinstall all python packages, or npm packages every time I start teh env

all secrets in .env file

justfiles are great; 

## Files and stuff

Here are the raw files that I think are important for this context

```
#Dockerfile

FROM node:22

# Install system dependencies
# vim-tiny is a lightweight version of vi, use 'vim' if you prefer full features
RUN apt-get update && apt-get install -y \
    git \
    curl \
    vim \
    tree \
    && rm -rf /var/lib/apt/lists/*

# Install uv (using the official installer script for global access)
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
# Ensure uv is in the path for future RUN commands
ENV PATH="/root/.local/bin:${PATH}"

RUN curl --proto '=https' --tlsv1.2 -sSf 'https://just.systems/install.sh' | bash -s -- --to /usr/local/bin

# Install the correct pi coding agent
RUN npm install -g @earendil-works/pi-coding-agent

WORKDIR /workspace
CMD ["sleep", "infinity"]
```

```
# docker-compose.yml
services:
  # Infrastructure Sibling
  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    volumes:
      - /mnt/c/projects/data:/data
    ports:
      - "9000:9000"
      - "9001:9001"
    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD}
    networks:
      - app-network

  # Runtime Sibling: Backend
  backend:
    build: .
    working_dir: /workspace/backend
    command: ["uv", "run", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
    volumes:
      - .:/workspace
    ports:
      - "8000:8000"
    environment:
      - S3_ENDPOINT_URL=${S3_ENDPOINT_URL}
      - S3_BUCKET=${S3_BUCKET}
      - AWS_ACCESS_KEY_ID=${MINIO_ROOT_USER}
      - AWS_SECRET_ACCESS_KEY=${MINIO_ROOT_PASSWORD}
      - STAGING_DIR=${STAGING_DIR}
    networks:
      - app-network

  # Runtime Sibling: Frontend
  frontend:
    build: .
    working_dir: /workspace/frontend
    command: ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5174"]
    volumes:
      - .:/workspace
    ports:
      - "5174:5174"
    networks:
      - app-network

  # Your Persistent Dev-Shell (The Sidecar)
  pi-dev:
    build: .
    volumes:
      - .:/workspace
    tty: true
    networks:
      - app-network
    environment:
      - GEMINI_API_KEY=${GEMINI_API_KEY}

networks:
  app-network:
    driver: bridge
```

```
# /frontend/package.json
{
  "name": "frontend",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "lint": "eslint .",
    "preview": "vite preview"
  },
  "dependencies": {
    "@tailwindcss/vite": "^4.3.0",
    "@tanstack/react-query": "^5.100.14",
    "autoprefixer": "^10.5.0",
    "axios": "^1.16.1",
    "lucide-react": "^1.16.0",
    "postcss": "^8.5.15",
    "react": "^19.2.6",
    "react-dom": "^19.2.6",
    "tailwindcss": "^4.3.0",
    "zustand": "^5.0.13"
  },
  "devDependencies": {
    "@eslint/js": "^10.0.1",
    "@types/node": "^24.12.3",
    "@types/react": "^19.2.14",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^6.0.1",
    "eslint": "^10.3.0",
    "eslint-plugin-react-hooks": "^7.1.1",
    "eslint-plugin-react-refresh": "^0.5.2",
    "globals": "^17.6.0",
    "typescript": "~6.0.2",
    "typescript-eslint": "^8.59.2",
    "vite": "^8.0.12"
  }
}

```


```
# frontend/vite.config.ts

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://backend:8000',
        changeOrigin: true
      }
    }
  }
})
```

```
# backend/pyproject.toml
[project]
name = "backend"
version = "0.1.0"
description = "Add your description here"
readme = "README.md"
requires-python = ">=3.11"
dependencies = [
    "boto3>=1.43.19",
    "fastapi>=0.136.3",
    "llm>=0.31",
    "llm-gemini>=0.32",
    "pydantic>=2.13.4",
    "python-multipart>=0.0.30",
    "sqlalchemy>=2.0.50",
    "uvicorn>=0.48.0",
]

[dependency-groups]
dev = [
    "pytest>=9.0.3",
]
test = [
    "moto[s3]>=5.2.1",
    "pyfakefs>=6.2.0",
]

[build-system]
requires = ["setuptools>=61.0"]
build-backend = "setuptools.build_meta"

[tool.setuptools.packages.find]
where = ["."]
include = ["bucket_harbour", "bucket_harbour.*"]
```

Note: the backend uses S3 
## Prompt 



```
# Prompt 1 - Fire and forget...
GIven this setup, suggest an alternate Dockerfile, docker-compose.yml, and general pidev config
that address these issues, but keeps the parts I like. Please think carefully about the 
set up.
```

# Post script

LInk 
OTher issues

```
fd not found. Downloading...
ripgrep not found. Downloading...
ripgrep installed to /root/.pi/agent/bin/rg
fd installed to /root/.pi/agent/bin/fd
```
