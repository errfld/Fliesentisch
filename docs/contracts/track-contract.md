# Media Track Contract

- Main microphone track name: `main`
- Whisper microphone track name: `whisper:<whisperId>`
- Camera tracks use default LiveKit naming

## Subscription behavior

- Subscribe to all `main` tracks.
- Subscribe to `whisper:<id>` only when local identity is a member of whisper `id`.
- Never subscribe non-members to whisper tracks.
