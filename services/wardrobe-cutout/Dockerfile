FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 U2NET_HOME=/models HOST=0.0.0.0 PORT=7010 OMP_NUM_THREADS=2
WORKDIR /service
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# Download the lightweight, local model once, while building the image.
RUN python -c "from rembg import new_session; new_session('u2netp', providers=['CPUExecutionProvider'])"
COPY processor.py server.py ./
EXPOSE 7010
CMD ["python", "server.py"]
