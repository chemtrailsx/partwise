# One container: builds the React app, then serves API + UI with FastAPI.
FROM node:20-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend/ backend/
COPY --from=web /web/dist frontend/dist
ENV PORT=8000
EXPOSE 8000
# Set GROQ_API_KEY (or GEMINI/COHERE/OPENROUTER_API_KEY) in the host's environment settings, never in the image.
CMD ["sh", "-c", "python -m uvicorn --app-dir backend app.main:app --host 0.0.0.0 --port ${PORT}"]
