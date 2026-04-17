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

- Derived server-side: `identity` comes from the authenticated Google user.
- The returned `identity` is a stable opaque server-derived identifier, not the raw Google subject.
- The API no longer accepts `join_key`.

## Response (200)

```json
{
  "token": "jwt",
  "expires_at": "2026-03-02T22:00:00Z",
  "identity": "u_h6v0X5Qh5R5A7o4rF0j6r7Q2C3e4m5n6p7q8",
  "game_role": "player"
}
```

`game_role` is included only when an authenticated backend session is present (`"gamemaster"` or `"player"`).

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

The minted LiveKit token also includes `attributes.game_role` so clients can verify trusted GM publishers over the realtime channel.
