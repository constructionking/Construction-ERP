# Photogrammetry worker: OpenSfM + ArUco scale detection + volume math.
#
# OpenSfM is built from the official Mapillary source, mirroring the project's
# own Dockerfile.ubuntu24 (the repo has no requirements.txt any more — the
# build is driven by pyproject.toml, and their published container image is no
# longer publicly pullable). First build compiles the C++ core: ~20-40 min on
# a small VM, cached afterwards.
FROM ubuntu:24.04

ARG DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential cmake git ca-certificates \
      libeigen3-dev libopencv-dev libceres-dev \
      python3-dev python3-pip python3-venv \
      libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Isolated interpreter for OpenSfM + the worker (PATH persists to runtime).
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

RUN git clone --recursive --depth 1 https://github.com/mapillary/OpenSfM /source/OpenSfM
WORKDIR /source/OpenSfM
RUN pip install --no-cache-dir -e .

# reconstruct.py invokes the `opensfm` CLI via PATH. If the pyproject install
# didn't register a console script, expose the source launcher through a
# wrapper (a symlink would break its relative path resolution).
RUN command -v opensfm >/dev/null 2>&1 \
 || { printf '#!/bin/sh\nexec /source/OpenSfM/bin/opensfm "$@"\n' > /usr/local/bin/opensfm \
      && chmod +x /usr/local/bin/opensfm; }

WORKDIR /worker

# Installed AFTER OpenSfM on purpose: opencv-contrib-python-headless is a
# superset of the cv2 OpenSfM needs (adds ArUco), and last-install wins.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY volume.py aruco.py reconstruct.py poller.py ./

ENV STORAGE_DIR=/storage
CMD ["python3", "poller.py"]
