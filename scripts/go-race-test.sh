#!/bin/sh
set -eu

docker run --rm \
  --security-opt seccomp=unconfined \
  -e GOPROXY=https://goproxy.cn,direct \
  -v /opt/fengji/apps/api-go:/src \
  -v cyclewhere-go-race-mod:/go/pkg/mod \
  -v cyclewhere-go-race-build:/root/.cache/go-build \
  -w /src \
  golang:1.25-bookworm \
  go test -race ./...
