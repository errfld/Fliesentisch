# DataChannel Protocol v1

All messages are JSON objects:

```json
{
  "type": "STATE_REQUEST|STATE_SNAPSHOT|WHISPER_CREATE|WHISPER_UPDATE|WHISPER_CLOSE|SPOTLIGHT_UPDATE",
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

## Conflict resolution

1. Ignore duplicate `eventId`.
2. Prefer larger `updatedAt`.
3. If equal `updatedAt`, prefer lexical larger `id`.
4. If more than three whispers exist, keep the three oldest by `createdAt` then by `id`.
