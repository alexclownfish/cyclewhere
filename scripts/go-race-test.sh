#!/bin/sh
set -eu

docker run --rm \
  -e GOPROXY=https://goproxy.cn,direct \
  -v /opt/fengji/apps/api-go:/src \
  -w /src \
  golang:1.25-bookworm \
  go test -race ./...
