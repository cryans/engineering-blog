Your original design is technically clean from a Docker perspective, but it's fighting the way coding agents work.

The biggest issue is that you optimized for service isolation, while pi.dev (and most coding agents) work best when they can:

See the entire filesystem.
Run build/test commands themselves.
Start/stop processes themselves.
Read a small amount of logs on demand.

In other words:

Humans like service isolation.
Coding agents like a single machine.

The result is that the agent keeps getting confused about:

where Python lives
where node lives
where logs are
how to restart services
how to inspect sqlite
how to inspect backend state
What I'd change

I'd move to a:

┌─────────────────────────┐
│ pi-dev container        │
│                         │
│ uv                      │
│ node                    │
│ npm                     │
│ sqlite3                 │
│ just                    │
│ backend source          │
│ frontend source         │
│                         │
│ starts everything       │
└─────────────────────────┘

          │

          ▼

┌─────────────────────────┐
│ minio                   │
└─────────────────────────┘

Only MinIO stays separate.

Everything else runs inside the dev container.

This removes:

ownership problems
port wiring
context confusion
uv confusion
sqlite confusion
Proposed Layout
.
├── Dockerfile
├── docker-compose.yml
├── .env

├── backend
├── frontend

├── data
│   ├── sqlite
│   │   └── app.db
│   ├── minio
│   └── uploads

├── logs
│   ├── backend
│   ├── frontend
│   └── pi

├── .pi
│   ├── sessions
│   ├── config.yaml
│   └── prompts

├── justfile
└── README.md

Everything persistent is now obvious:

data/
logs/
.pi/

No database files scattered through source trees.

Dockerfile

I'd create a true developer workstation image.

FROM node:22-bookworm

RUN apt-get update && apt-get install -y \
    curl \
    vim \
    tree \
    sqlite3 \
    procps \
    jq \
    less \
    && rm -rf /var/lib/apt/lists/*

# uv
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:${PATH}"

# just
RUN curl --proto '=https' --tlsv1.2 -sSf \
    https://just.systems/install.sh | \
    bash -s -- --to /usr/local/bin

# pi
RUN npm install -g @earendil-works/pi-coding-agent

WORKDIR /workspace

CMD ["sleep","infinity"]

Notably:

NO git

Keep your favorite safeguard.

If you need git, install it manually.

Docker Compose

I'd collapse frontend/backend.

services:

  dev:

    build: .

    container_name: bucket-dev

    working_dir: /workspace

    volumes:
      - .:/workspace

      - ./logs:/workspace/logs

      - ./.pi:/workspace/.pi

      - uv-cache:/root/.cache/uv

      - npm-cache:/root/.npm

    env_file:
      - .env

    ports:
      - "5173:5173"
      - "8000:8000"

    tty: true

    depends_on:
      - minio

  minio:

    image: minio/minio

    command: server /data --console-address ":9001"

    ports:
      - "9000:9000"
      - "9001:9001"

    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD}

    volumes:
      - ./data/minio:/data

volumes:
  uv-cache:
  npm-cache:

Only two containers.

Much easier.

Justfile

This becomes the API for the agent.

default:
    just --list

up:
    docker compose up -d

down:
    docker compose down

shell:
    docker compose exec dev bash

backend:
    cd backend && \
    uv run uvicorn main:app \
      --host 0.0.0.0 \
      --port 8000 \
      --reload \
      > ../logs/backend/current.log 2>&1

frontend:
    cd frontend && \
    npm run dev \
      > ../logs/frontend/current.log 2>&1

dev:
    just backend &
    just frontend &
    wait

logs:
    tail -f logs/backend/current.log logs/frontend/current.log

Now pi can discover:

just dev
just backend
just frontend
just logs

Agents tend to handle this much better.

Pi Configuration

I would create:

.pi/config.yaml

Example:

default_model: gemini-2.5-flash

session_dir: .pi/sessions

log_dir: logs/pi

allowed_commands:

  - just
  - uv
  - npm
  - sqlite3
  - ls
  - cat
  - grep
  - find

forbidden_commands:

  - git
  - git*

The important bit:

default_model: gemini-2.5-flash

You mentioned cost.

Flash is usually plenty for CRUD-style FastAPI + React development.

Use Pro only when you hit architecture/design work.

Persistent Sessions

I'd explicitly mount:

- ./.pi:/workspace/.pi

Then configure pi to store:

.pi/sessions

This survives container recreation.

Handling Logs

One of your biggest complaints was context explosion.

I would not allow pi to read live logs.

Instead:

logs/
 ├── backend/current.log
 ├── frontend/current.log
 └── pi/

And teach it:

Never tail logs.

Use:

tail -n 50

or

grep ERROR

Coding agents are terrible at log discipline unless explicitly instructed.

Handling SQLite

Install sqlite3 in the dev image.

Move DB to:

data/sqlite/app.db

Configure backend:

DATABASE_URL=sqlite:///data/sqlite/app.db

Now pi can inspect:

sqlite3 data/sqlite/app.db

without confusion.

Handling uv

I'd make this explicit in the pi system prompt:

Python is managed exclusively with uv.

Never use:

python
pip
pip3

Use:

uv run
uv sync
uv add

This single instruction eliminates a huge percentage of agent mistakes.

What I'd Tell Pi

A project-level instruction file such as .pi/agent.md:

Rules:

1. Never use git.
2. Python uses uv exclusively.
3. Start services through just.
4. Logs live in /logs.
5. Database lives in /data/sqlite.
6. Never tail logs.
7. Read at most 100 lines of logs.
8. Frontend runs on 5173.
9. Backend runs on 8000.
10. MinIO runs on 9000.

This gives the agent a stable mental model.

Final Architecture
docker compose up -d

┌───────────────────────────┐
│ dev container             │
│                           │
│ pi                        │
│ uv                        │
│ node                      │
│ sqlite3                   │
│ backend                   │
│ frontend                  │
│                           │
│ just dev                  │
└─────────────┬─────────────┘
              │
              ▼
┌───────────────────────────┐
│ minio                     │
└───────────────────────────┘

Persistent:
  .pi/
  logs/
  data/

For agent-driven development, this is substantially simpler and usually more reliable than running backend, frontend, and the coding agent as separate sibling containers. The loss of isolation is outweighed by the reduction in agent confusion and operational friction.


