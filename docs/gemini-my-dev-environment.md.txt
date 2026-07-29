To address your requirements, we need to shift from the "multi-container" orchestration model to a "unified workspace" model.

By consolidating your runtime environment into a single, high-performance container (acting as your dev harness), you solve the file permission issues, LLM context confusion, and port-mapping mess, while keeping the modularity of your code.

The Architectural Shift: The "Sidecar-to-Container" Evolution
Instead of having pi-dev, backend, and frontend as separate Docker services competing for file access, we treat the Docker container as a persistent environment (an "IDE-in-a-box"). You launch the services inside that container using a process manager (like honcho or supervisord), which the LLM can control easily.

1. The Unified Dockerfile
We install everything in one place. Using supervisord allows the LLM to control your backend and frontend processes as native shell commands.

Dockerfile


```text
FROM node:22

# Install system dependencies + sqlite3 for your DB
RUN apt-get update && apt-get install -y \
    git curl vim tree sqlite3 supervisor \
    && rm -rf /var/lib/apt/lists/*

# Install uv and just
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
RUN curl --proto '=https' --tlsv1.2 -sSf 'https://just.systems/install.sh' | bash -s -- --to /usr/local/bin

# Install pi-coding-agent
RUN npm install -g @earendil-works/pi-coding-agent

WORKDIR /workspace

# Copy a simple supervisord config
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Persistent environment setup
ENV PATH="/root/.local/bin:${PATH}"
ENV UV_PROJECT_ENVIRONMENT="/workspace/backend/.venv"

CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
```

2. The Unified docker-compose.yml
We now treat the "Env" as a single service. This keeps your port mapping clean and your persistent storage consolidated.

```YAML
services:
  dev-env:
    build: .
    volumes:
      - .:/workspace
      - ./logs:/workspace/logs
      - ./data:/workspace/data
    ports:
      - "8000:8000"
      - "5174:5174"
    environment:
      - GEMINI_API_KEY=${GEMINI_API_KEY}
      - PI_MODEL=gemini-2.5-flash # Force the cheaper model
    tty: true
    stdin_open: true
```

3. Solving your "Issues"
Permissions: Since only one container owns the files, permission conflicts vanish.

Context Window: By using supervisor, you can give the LLM a command to "restart backend." It doesn't need to read massive log files; it can tail them (tail -n 50 logs/backend.log).

Persistence: By mapping ./logs and ./data to the host, you achieve the clean, top-level directory structure you wanted.

The "Vibe" check: With supervisord, you can have a justfile recipe that instructs the LLM: supervisorctl restart backend.

Recommended Directory Structure
This keeps your project clean while ensuring the LLM doesn't touch your git history (simply do not initialize a git repo inside the /workspace folder on the host).

```text
├── Dockerfile
├── docker-compose.yml
├── justfile
├── logs/           # Centralized logs
├── data/           # SQLite DB and S3-mock storage
├── backend/        # uv managed
├── frontend/       # npm managed
└── supervisord.conf
```


Pro-Tips for your Configuration
PI Configuration: Create a .pi-config.json in your root.

```JSON
{
  "model": "gemini-2.5-flash",
  "ignore": [".git", "node_modules", "**/__pycache__", "logs/*"],
  "environment": {
    "PYTHON_MANAGER": "uv"
  }
}
```
Supervisor: Your supervisord.conf should define the frontend and backend as services. This allows you to run just restart-backend which calls supervisorctl restart backend. This is much more reliable for an LLM than killing Docker containers.

SQLite: Because sqlite3 is now in the Dockerfile, the LLM can use sqlite3 data/app.db "SELECT * FROM ..." directly in the terminal, solving your command line issue.

Would you like me to help you draft the supervisord.conf file to perfectly align with your current backend/frontend launch commands?


