<!--
Appellate Practice Simulator — federal appellate procedure training.
Copyright (C) 2026 Rhajune Park
SPDX-License-Identifier: AGPL-3.0-or-later

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published
by the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.
-->

# Private document transport

Document transport uses the Convex HTTP site URL and authenticated requests. It
does not return persistent Convex storage URLs. Session document uploads and
downloads are limited to 25 MiB total, transferred in fixed 4 MiB slices (the
last slice may be smaller).

## Environment names

- `VITE_CONVEX_SITE_URL` is the frontend base URL for Convex HTTP actions. It is
  the deployment's `*.convex.site` URL, separate from `VITE_CONVEX_URL`, which
  is the Convex functions/database URL.
- `DOCUMENT_ALLOWED_ORIGINS` is a server-side comma-separated list of exact web
  origins. An entry contains only the scheme, host, and optional port, such as
  `https://app.example.com` or `http://localhost:3000`. Do not include a path,
  trailing slash, wildcard, or credentials.

These names are examples for application configuration. This document does not
change any live deployment settings or contain secrets.

## Upload chunks

Send each binary chunk to:

```text
POST {VITE_CONVEX_SITE_URL}/documents/chunk?intentId={intentId}&index={index}
Authorization: Bearer {Clerk Convex JWT}
Content-Type: application/octet-stream
```

The zero-based `index` selects a 4 MiB chunk. The authenticated upload intent
determines the exact expected size, and the final chunk may be smaller. The
server validates and records each chunk against its intent. Clients must not
send a storage ID as proof of ownership.

## Download chunks

Request one zero-based chunk at a time:

```text
GET {VITE_CONVEX_SITE_URL}/documents/content?documentId={documentId}&chunk={index}
Authorization: Bearer {Clerk Convex JWT}
```

The successful response body contains at most 4 MiB. `Content-Length` is the
size of this slice; `X-Document-Size` is the full document size. The response
includes a sanitized `Content-Disposition: attachment` filename,
`X-Content-Type-Options: nosniff`, and `Cache-Control: no-store`. PDF documents
are served as `application/pdf`; other stored media types are served as
`application/octet-stream`. A browser client can assemble the received slices
locally and revoke any local object URL after use.
Storage IDs and storage URLs remain server-side and are never returned to the
caller. Convex action storage currently loads the complete stored file into a
`Blob` with `storage.get()` before the HTTP action slices the response. The
client response is capped at 4 MiB and the file is capped at 25 MiB, but each
chunk request can still read and allocate the full file in the action. The
current Convex storage API does not guarantee byte-range reads, so this
transport does not claim storage-side range efficiency.

Every chunk request rechecks the document, session, organization, and active
unexpired memberships. The session owner may read their own document. Another
user may read it only through the explicit assignment-session link and an
instructor/admin membership in that same organization while the assignment is
active. Organization role alone does not grant access to another session.
Personal organizations remain owner-only. The HTTP action checks access again
after reading the slice before returning it, so a revoked or expired reader
cannot continue with another chunk.

## CORS and response errors

The server adds CORS headers only when the request origin exactly matches an
entry in `DOCUMENT_ALLOWED_ORIGINS`. The allowed methods are `POST, OPTIONS`
for uploads and `GET, OPTIONS` for downloads. Requests may include the
`Authorization` header; upload requests also include `Content-Type`. The
download response exposes `Content-Disposition`, `Content-Type`, and
`X-Document-Size` to browser code. CORS preflight only describes browser access;
it does not authenticate a document request. No credential wildcard or
`Access-Control-Allow-Credentials` header is used.

Private responses, including errors, use `Cache-Control: no-store`. The routes
use these statuses:

| Status | Meaning                                                                                         |
| ------ | ----------------------------------------------------------------------------------------------- |
| `200`  | Chunk returned or upload chunk accepted                                                         |
| `401`  | Missing or uninitialized authentication                                                         |
| `403`  | Active organization member lacks the required assignment role, or an origin is not allowed      |
| `404`  | Document, session, organization, or active membership is missing or outside the caller's access |
| `409`  | Conflicting document or assignment/session linkage                                              |
| `410`  | Upload intent expired                                                                           |
| `413`  | Chunk or document exceeds the transport limit                                                   |
| `422`  | Malformed request or invalid chunk index                                                        |

Error bodies do not include storage IDs, persistent URLs, or foreign resource
metadata.
