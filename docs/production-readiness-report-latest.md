# Production Readiness Report (Latest)

Generated: 2026-05-06T18:38:35.779Z
Base URL: `http://127.0.0.1:8080`
Viewer: `internal-viewer`

| Route | Status | Latency(ms) | Payload(bytes) | Reads | Queries | Violations |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `auth.session` | 200 | 172 | 1092 | 1 | 0 | none |
| `feed.first` | 200 | 663 | 86380 | 14 | 4 | none |
| `feed.next` | 200 | 194 | 85513 | 1 | 1 | payload_bytes_exceeded |
| `posts.details.batch` | 200 | 701 | 2868 | 4 | 3 | latency_exceeded |
| `post.detail` | 200 | 4 | 61376 | 0 | 0 | none |
| `profile.bootstrap.6` | 200 | 230 | 3225 | 13 | 5 | none |
| `profile.bootstrap.18` | 200 | 3 | 3056 | 0 | 0 | none |
| `profile.followers` | 200 | 171 | 236 | 0 | 1 | none |
| `profile.following` | 200 | 244 | 326 | 3 | 2 | none |
| `social.suggested.generic` | 200 | 205 | 8765 | 12 | 1 | none |
| `social.suggested.onboarding` | 200 | 91 | 13949 | 28 | 1 | none |
| `collections.list` | 200 | 206 | 7679 | 25 | 2 | none |
| `search.bootstrap` | 200 | 851 | 12448 | 54 | 9 | db_reads_exceeded, db_queries_exceeded |
| `directory.users` | 400 | 3 | 501 | 0 | 0 | none |
| `map.bootstrap` | 400 | 3 | 409 | 0 | 0 | none |
| `map.markers` | 200 | 208 | 35098 | 120 | 1 | db_reads_exceeded |
| `chats.inbox` | 200 | 293 | 380 | 1 | 3 | none |
| `telemetry.ingest` | 400 | 4 | 505 | 0 | 0 | none |

## Hard Failures
- none

