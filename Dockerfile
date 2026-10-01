FROM python:3.12-slim

RUN groupadd -r shockr && useradd -r -g shockr -d /app shockr

WORKDIR /app

COPY server/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server/ ./server/

RUN mkdir -p /app/data /app/config && chown -R shockr:shockr /app

USER shockr

EXPOSE 8920

CMD ["uvicorn", "server.main:app", "--host", "0.0.0.0", "--port", "8920", "--log-level", "warning"]
