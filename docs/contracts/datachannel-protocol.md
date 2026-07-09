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

## Transport lifecycle

The room session owns one shared DataChannel protocol boundary for all v1 event types. It:

- encodes outgoing envelopes and publishes them reliably;
- decodes and validates incoming envelopes before routing them;
- installs one `RoomEvent.DataReceived` listener per connected room;
- fans valid envelopes out by their discriminated `type` to feature handlers; and
- reports publish outcomes as `ok`, `room-unavailable`, or `publish-failed`.

Whisper and split-room handlers retain their domain responsibilities. Whisper handlers own whisper snapshots and reducer updates. Split-room handlers verify the trusted LiveKit sender identity and gamemaster authority before applying state.

When a participant joins, the whisper and split features each publish their typed state request. Existing eligible participants answer with feature-specific snapshots, so a late joiner hydrates through the same shared listener and routing boundary.

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

## Split state payload (`SPLIT_STATE_SNAPSHOT` / `SPLIT_START`)

Both `SPLIT_STATE_SNAPSHOT` and `SPLIT_START` use the same `{ "splitState": ... }` payload shape.

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
