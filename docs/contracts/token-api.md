# Token API Contract

## Endpoint

`POST /api/v1/token`

## Request

```json
{
  "room": "dnd-table-1",
  "identity": "alice",
  "name": "Alice",
  "join_key": "optional"
}
```

## Response (200)

```json
{
  "token": "jwt",
  "expires_at": "2026-03-02T22:00:00Z",
  "game_role": "gamemaster"
}
```

## Error

```json
{
  "error": {
    "code": "INVALID_JOIN_KEY | ROOM_NOT_ALLOWED | BAD_REQUEST | INTERNAL",
    "message": "human readable"
  }
}
```

## Status codes

- `200` token issued
- `400` malformed request
- `401` invalid join key
- `403` room not allowed
- `500` unexpected failure

## Transitional Note

- When backend session auth is present, `game_role` is included in the token response.
- When backend session auth is present, the minted LiveKit token also includes `attributes.game_role` so clients can verify trusted GM publishers over the realtime channel.
- In the current transition phase, the endpoint still accepts legacy client identity and optional join-key flow when no authenticated session cookie is present.
