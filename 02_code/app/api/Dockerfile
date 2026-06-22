# Serving API image. Small, no GDAL — the API only does SQL over the lean
# serving DB, so none of the heavy ETL geo stack is needed here.
FROM python:3.12-slim

WORKDIR /app

# psycopg[binary] ships its own libpq wheel, so no system libpq build deps.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# Single worker is plenty for the MVP read-only API on a 2 vCPU box; scale with
# --workers later if the facility/detail endpoints become a bottleneck.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
