# Locava Backend v2

The backend behind [Locava](https://apps.apple.com/us/app/locava/id6738789701),
a location-based social platform with iOS, Android and web clients. Fastify and
TypeScript on Google Cloud Run, with Firestore as the source of truth.

Built by [Judson Dunne](https://judsondunne.com). The full engineering write-up
is at [judsondunne.com/work/locava](https://judsondunne.com/work/locava).

## What it serves

A feed of real places, each with the distance from the viewer already computed.
That one product requirement drives most of what is interesting in here: the
distance has to be right, it has to be fast, and the media attached to it has to
arrive before anybody scrolls past.

## How it is laid out

```
src/
├── contracts/        request and response shapes, from @locava/contracts
├── routes/           HTTP surface, one module per resource
├── services/         business logic, no framework and no storage
├── repositories/     the only code allowed to touch Firestore or Redis
├── orchestration/    multi-step flows and fan-out through Cloud Tasks
├── cache/            Redis and an in-memory tier in front of it
├── observability/    OpenTelemetry traces, structured logs, BigQuery ingest
├── media/            image and video processing with sharp
└── admin/            internal tooling and dashboards
```

The boundary that matters is `repositories/`. Nothing outside it is allowed to
touch Firestore or Redis directly, which is what made it possible to put a
cache in front of the feed without rewriting two clients.

## The shared contracts package

Every request body, response and entity shape crossing the network is a Zod
schema in `@locava/contracts`, imported by this service and by both clients.
The backend parses its *own responses* against those schemas before sending
them, not just its inputs, which is the half that earns the package: a handler
returning a shape its contract rejects fails in development with a path to the
offending field, rather than three weeks later in a crash report from a phone
that cannot be redeployed.

The reasoning in full:
[Typed contracts between a mobile client and its backend](https://judsondunne.com/writing/typed-contracts-between-a-mobile-client-and-its-backend).

## Stack

`TypeScript` · `Fastify` · `Firestore` · `Redis` (ioredis) · `BigQuery` ·
`Cloud Tasks` · `Cloud Run` · `OpenTelemetry` · `sharp` · S3-compatible
storage with presigned multipart uploads · `Zod`

## Tests

434 test files, run with Vitest against the Firestore emulator.

```bash
npm install
npm run test:firestore:emulator   # starts the emulator
npm test
```

`npm run test:deterministic` is the subset that does not need the emulator.

## Running it

```bash
cp .env.example .env    # fill in the values
npm run dev
```

`.env.example` documents every variable. Nothing in this repository contains a
credential: analytics reaches BigQuery through a service account supplied at
runtime, and `src/repositories/analytics/analytics-bigquery-credentials.ts`
is explicit about never logging the object that holds it.

## Status

Locava is live on the App Store and no longer under full-time development.
This repository is public as engineering reference rather than as a project
accepting contributions, so issues and pull requests are not actively
monitored.

## License

No license granted. The source is readable here for reference; it is not
offered for reuse.
