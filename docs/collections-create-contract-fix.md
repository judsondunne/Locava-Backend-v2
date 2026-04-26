# Backendv2 Collections Create Contract Fix

## Failure cause

Native posted to `POST /v2/collections/create`, but Backendv2 returned `404`.

Because the route was missing, client transport could not parse a valid Backendv2 envelope for the operation and surfaced `missing_envelope_fields`.

## Canonical contract

- Route: `POST /v2/collections/create`
- Route name: `collections.create.post`
- Body:
  - `name: string`
  - `description?: string`
  - `privacy: "public" | "private"`
  - `collaborators?: string[]`
  - `items?: string[]`
  - `coverUri?: string (url)`
- Response (`data`):
  - `routeName: "collections.create.post"`
  - `collectionId: string`
  - `collection: { id, name, ownerId, collaborators, items, itemsCount, displayPhotoUrl?, description?, privacy, color? }`

## What changed in Backendv2

- Added surface contract:
  - `src/contracts/surfaces/collections-create.contract.ts`
- Added mutation stack:
  - `src/repositories/mutations/collection-mutation.repository.ts`
  - `src/services/mutations/collection-mutation.service.ts`
  - `src/orchestration/mutations/collections-create.orchestrator.ts`
- Added route and registration:
  - `src/routes/v2/collections-create.routes.ts`
  - registered in `src/app/createApp.ts`
- Added route policy:
  - `collections.create.post` in `src/observability/route-policies.ts`
- Added tests:
  - `src/routes/v2/collections-create.routes.test.ts`

## Which side was wrong

- Backend side was wrong for this failure: create route did not exist/register.
- Native was already targeting the intended bounded v2 create path.

## Scope boundary

This is a collection-create contract/path fix only. It does not introduce post/media upload reconnect and does not broaden mutation architecture beyond this bounded phase.
