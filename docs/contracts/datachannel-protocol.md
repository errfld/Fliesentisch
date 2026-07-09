# DataChannel Protocol v1

All messages are JSON objects:

```json
{
  "type": "STATE_REQUEST|STATE_SNAPSHOT|WHISPER_CREATE|WHISPER_UPDATE|WHISPER_CLOSE|SPOTLIGHT_UPDATE|HANDOUT_STATE_REQUEST|HANDOUT_STATE_SNAPSHOT|HANDOUT_SPOTLIGHT_UPDATE|LOBBY_STATE_REQUEST|LOBBY_READY_UPDATE|SPLIT_STATE_REQUEST|SPLIT_STATE_SNAPSHOT|SPLIT_START|SPLIT_END|SPLIT_ROOM_UPSERT|SPLIT_ROOM_REMOVE|SPLIT_ASSIGNMENT_SET|SPLIT_GM_FOCUS_UPDATE|SPLIT_GM_BROADCAST_UPDATE",
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

Whisper, handout, and split-room handlers retain their domain responsibilities. Whisper handlers own whisper snapshots and reducer updates. Handout and split-room handlers verify the trusted LiveKit sender identity and role attributes before applying authoritative state.

When a participant joins, the whisper, handout, and split features each publish their typed state request. Existing eligible participants answer with feature-specific snapshots, so a late joiner hydrates through the same shared listener and routing boundary.

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

## Handout spotlight payload

`HANDOUT_SPOTLIGHT_UPDATE` starts, updates, or stops the shared scene. `HANDOUT_STATE_SNAPSHOT` uses the same payload for late joiners. A `null` handout is an authoritative stop tombstone.

```json
{
  "handout": {
    "imageUrl": "https://assets.example.com/ruined-observatory.jpg",
    "title": "The ruined observatory",
    "presenterIdentity": "gm",
    "presenterRole": "gamemaster",
    "updatedAt": 1730408755000
  },
  "updatedAt": 1730408755000
}
```

- `imageUrl` must be an absolute `http://` or `https://` URL and is limited to 2,048 characters.
- `title` is optional and limited to 80 characters.
- `presenterRole` is `gamemaster` or `admin` and must match the sender's trusted LiveKit role attributes for direct updates.
- Clients may minimize the presentation locally; this does not emit a protocol event or change authoritative room state.

## Conflict resolution

1. Ignore duplicate `eventId`.
2. Prefer larger `updatedAt`.
3. If equal `updatedAt`, prefer lexical larger `id`.
4. If more than three whispers exist, keep the three oldest by `createdAt` then by `id`.

## Split authority

- `SPLIT_START` and `SPLIT_STATE_SNAPSHOT` are only accepted from a sender whose trusted LiveKit participant attributes report `game_role=gamemaster`.
- Once split mode is active, subsequent split mutations are only accepted from the active `gmIdentity`.

## Handout authority

- The backend places lowercase `game_role` and `platform_role` values in signed LiveKit participant attributes.
- `HANDOUT_SPOTLIGHT_UPDATE` and `HANDOUT_STATE_SNAPSHOT` are accepted only from senders with `game_role=gamemaster` or `platform_role=admin`.
- Direct updates with an active handout must name the trusted sender as `presenterIdentity` and use the corresponding presenter role.
- Only authorized participants answer `HANDOUT_STATE_REQUEST`; stop snapshots remain valid so stale images cannot reappear.
