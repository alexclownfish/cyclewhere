FROM golang:1.25-alpine AS build

WORKDIR /src/apps/api-go
COPY apps/api-go/go.mod apps/api-go/go.sum ./
RUN go mod download
COPY apps/api-go/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/server \
    && CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/migrate ./cmd/migrate

FROM alpine:3.22

RUN apk add --no-cache ca-certificates tzdata \
    && addgroup -S -g 10001 fengji \
    && adduser -S -D -H -u 10001 -G fengji fengji \
    && mkdir -p /app/data/avatars \
    && chown -R fengji:fengji /app
WORKDIR /app
COPY --from=build /out/api /out/migrate ./
COPY apps/api/migrations ./migrations
USER fengji
EXPOSE 3000
CMD ["./api"]
