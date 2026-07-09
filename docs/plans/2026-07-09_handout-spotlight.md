# Handout spotlight implementation plan

1. Extend LiveKit token claims with trusted `game_role` and `platform_role` participant attributes.
2. Add typed handout request, snapshot, and update protocol events with strict runtime validation and contract documentation.
3. Add a handout state reducer/store and authority rules that accept updates only from authenticated gamemaster or admin participants.
4. Add a room-session handout hook for broadcast, update, stop, late-join synchronization, and local minimize state.
5. Add cohesive view-model/action contracts, an authorized sidebar control panel, and a cinematic stage presentation surface.
6. Cover parsing, reducer ordering, authority enforcement, backend claims, and three-client broadcast/update/minimize/late-join/stop behavior.
