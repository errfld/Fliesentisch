# Token API Contract

## Endpoint

`POST /api/v1/token`

Requires an authenticated backend session cookie created by the Google OAuth flow.

## Request

```json
{
  "room": "dnd-table-1",
  "name": "Alice"
}
```

Notes:

- `identity` is derived server-side from the authenticated Google user.
- `join_key` is no longer accepted.

## Response (200)

```json
{
  "token": "jwt",
  "expires_at": "2026-03-02T22:00:00Z",
  "identity": "google-subject"
}
```

## Error

```json
{
  "error": {
    "code": "UNAUTHENTICATED | ROOM_NOT_ALLOWED | FORBIDDEN | BAD_REQUEST | INTERNAL",
    "message": "human readable"
  }
}
```

## Status codes

- `200` token issued
- `400` malformed request
- `401` missing or invalid backend session
- `403` room not allowed
- `500` unexpected failure
