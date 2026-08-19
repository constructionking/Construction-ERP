# Photogrammetry worker: OpenSfM + ArUco scale detection + volume math.
# The OpenSfM base image ships the CLI and its native dependencies.
FROM ghcr.io/mapillary/opensfm:latest

WORKDIR /worker

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY volume.py aruco.py reconstruct.py poller.py ./

ENV STORAGE_DIR=/storage
CMD ["python3", "poller.py"]
