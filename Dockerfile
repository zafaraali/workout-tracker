FROM python:3.13-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt && useradd --create-home irontrack && mkdir /data && chown irontrack:irontrack /data
COPY *.py ./
COPY templates ./templates
COPY static ./static
USER irontrack
ENV IRONTRACK_DATA_DIR=/data IRONTRACK_HOST=0.0.0.0 PORT=8080
EXPOSE 8080
CMD ["python", "serve.py"]
