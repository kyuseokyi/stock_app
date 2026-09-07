FROM python:3.12-slim

# Install system dependencies if required (like libpq for postgres)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Install uv for fast dependency resolution
RUN pip install uv

WORKDIR /app

# Copy dependency files first to leverage Docker cache
COPY pyproject.toml uv.lock ./

# Install dependencies into the system python
RUN uv pip install --system --no-cache -r pyproject.toml

# Copy the rest of the application
COPY . .

# Default command (will be overridden by docker-compose)
CMD ["uvicorn", "apps.stock_api.main:app", "--host", "0.0.0.0", "--port", "8000"]
