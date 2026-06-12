# Single image on purpose: server.js spawns `python -m pipeline.run` as a
# child process, so Node and Python share one filesystem and process space.
# Debian bookworm ships Python 3.11, for which all scraper deps have wheels.
FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python deps (two-step: see requirements.txt header)
COPY requirements.txt ./
RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir -r requirements.txt \
    && /opt/venv/bin/pip install --no-cache-dir --no-deps il-supermarket-scraper==1.0.2

# Node deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY lib ./lib
COPY pipeline ./pipeline
COPY public ./public
COPY seed_production_data.py generate_massive_catalog.py ./

ENV PIPELINE_PYTHON=/opt/venv/bin/python \
    DB_PATH=/app/data/database.db \
    DUMPS_DIR=/app/data/dumps \
    GEO_CACHE_DIR=/app/data \
    PORT=3000

VOLUME /app/data
EXPOSE 3000

CMD ["node", "server.js"]
