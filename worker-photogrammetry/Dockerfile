# Photogrammetry worker: OpenSfM + ArUco scale detection + volume math.
#
# OpenSfM is built from the official Mapillary source (the former
# ghcr.io/mapillary/opensfm image is no longer publicly pullable, and the
# community mirrors on Docker Hub are not trustworthy enough for production).
# First build takes ~20-40 min on a small VM: it compiles the C++ core once;
# later rebuilds of the app reuse this cached layer.
FROM ubuntu:22.04

ARG DEBIAN_FRONTEND=noninteractive

# Build + runtime dependencies (mirrors the upstream OpenSfM Dockerfile).
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential cmake git ca-certificates \
      libeigen3-dev libopencv-dev libceres-dev \
      python3-dev python3-pip python3-setuptools python3-wheel \
      libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Official source, submodules included (pybind11 etc.).
RUN git clone --recursive --depth 1 https://github.com/mapillary/OpenSfM /source/OpenSfM
WORKDIR /source/OpenSfM
RUN pip3 install --no-cache-dir -r requirements.txt \
 && python3 setup.py build

# The bin/opensfm launcher resolves paths relative to itself, so expose it via
# a wrapper (a symlink would break its self-location).
RUN printf '#!/bin/sh\nexec /source/OpenSfM/bin/opensfm "$@"\n' > /usr/local/bin/opensfm \
 && chmod +x /usr/local/bin/opensfm \
 && opensfm --help >/dev/null 2>&1 || true

WORKDIR /worker

# Installed AFTER OpenSfM's requirements on purpose: opencv-contrib-headless is
# a superset of the cv2 OpenSfM needs (adds ArUco), and last-install wins.
COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

COPY volume.py aruco.py reconstruct.py poller.py ./

ENV STORAGE_DIR=/storage
CMD ["python3", "poller.py"]
