# ADR 001: NestJS modular monolith with Fastify adapter

- Status: accepted
- Date: 2026-08-06

## Context

Activities, registrations and roadbooks share consistency rules and are expected to evolve together during MVP. The product architecture commits to a NestJS modular monolith. Registration throughput and lightweight request injection are also useful for concurrency tests.

## Decision

Use NestJS 11 as the application framework and dependency-composition boundary, with `@nestjs/platform-fastify` as the HTTP adapter. Keep domain services free of NestJS decorators and depend on a `Repository` interface. Controllers own HTTP headers, status codes and input parsing. A global exception filter owns the stable error envelope.

The initial `InMemoryRepository` is for local demonstration and deterministic tests only. Its mutex models the single atomic registration/cancellation boundary. The production PostgreSQL adapter will implement the same interface with an `events ... FOR UPDATE` transaction and the constraints in `migrations/001_initial.sql`.

Protected controllers use a Nest JWT guard. Identity comes only from a verified Bearer token subject, never from user-id headers. The server refuses to boot the in-memory adapter unless `DEMO_MODE=true`, preventing accidental production deployment without durable storage.

## Consequences

- Nest modules/controllers can add authentication, rate limiting, OpenAPI and observability without changing domain rules.
- Fastify supplies lower overhead and in-process HTTP integration tests.
- The repository contract makes PostgreSQL replacement explicit, but the in-memory adapter is not horizontally scalable or durable.
- Do not split services before activity/registration transaction boundaries and operational load justify it.
