#!/bin/sh
# Prints the llm-gate image tag: a hash of the Dockerfile and the files it COPYs.
#
# Content, not pipeline id: the gate runs inside the 9router pod, whose
# Deployment uses Recreate, so a new tag on every pipeline would restart 9router
# and cut every stream on every merge. Same content, same tag, same pod template.
# The file list is read from the Dockerfile so the two cannot drift.
set -eu
cd "$(dirname "$0")"
files=$(sed -n 's/^COPY \(.*\) \.\/$/\1/p' Dockerfile)
# shellcheck disable=SC2086
cat Dockerfile $files | sha256sum | cut -c1-12
