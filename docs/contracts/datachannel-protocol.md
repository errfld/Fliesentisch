# DataChannel Protocol v1

All messages are JSON objects:

```json
{
  "type": "STATE_REQUEST|STATE_SNAPSHOT|WHISPER_CREATE|WHISPER_UPDATE|WHISPER_CLOSE|SPOTLIGHT_UPDATE|SPLIT_STATE_REQUEST|SPLIT_STATE_SNAPSHOT|SPLIT_START|SPLIT_END|SPLIT_ROOM_UPSERT|SPLIT_ROOM_REMOVE|SPLIT_ASSIGNMENT_SET|SPLIT_GM_FOCUS_UPDATE|SPLIT_GM_BROADCAST_UPDATE",
  "v": 1,
  "eventId": "uuid",
  "actor": "participant-identity",
  "ts": 0,
  "payload": {}
}
```

## Whisper payload

```json
{
  "id": "uuid",
  "title": "optional",
  "members": ["alice", "bob"],
  "createdBy": "alice",
  "createdAt": 1730408750000,
  "updatedAt": 1730408755000
}
```

## Split state snapshot payload

```json
{
  "splitState": {
    "isActive": true,
    "rooms": [
      { "id": "main", "name": "Main Table", "kind": "main", "updatedAt": 1730408750000 },
      { "id": "side-1", "name": "Library", "kind": "side", "updatedAt": 1730408750000 }
    ],
    "assignments": {
      "alice": "main",
      "bob": "side-1"
    },
    "gmIdentity": "gm",
    "gmFocusRoomId": "side-1",
    "gmBroadcastActive": false,
    "updatedAt": 1730408755000
  }
}
```

## Conflict resolution

1. Ignore duplicate `eventId`.
2. Prefer larger `updatedAt`.
3. If equal `updatedAt`, prefer lexical larger `id`.
4. If more than three whispers exist, keep the three oldest by `createdAt` then by `id`.

## Split authority

- `SPLIT_START` and `SPLIT_STATE_SNAPSHOT` are only accepted from a sender whose trusted LiveKit participant attributes report `game_role=gamemaster`.
- Once split mode is active, subsequent split mutations are only accepted from the active `gmIdentity`.
