# Real WebRTC Voice Channel — Implementation Plan

## Approach
Mesh P2P WebRTC over Socket.io signaling. No media server — each peer connects directly to every other peer.

## Backend — `server.ts`
Add voice signaling events to existing `io.on("connection")`:

- **`voice:join`** — join a room (socket.join + broadcast `voice:user-joined`)
- **`voice:leave`** — leave a room (socket.leave + broadcast `voice:user-left`)
- **`signal:offer`** — relay SDP offer to target peer
- **`signal:answer`** — relay SDP answer to target peer
- **`signal:ice-candidate`** — relay ICE candidate
- **`voice:mute-toggle`** — broadcast mute state change to room

Server is purely a signaling relay — no media processing.

## Frontend — `community.html`
- Load socket.io client (`<script src="/socket.io/socket.io.js">`)
- Replace fake connection with real signaling + WebRTC:

1. **`joinVoice(name)`** — emit `voice:join`, start `getUserMedia()`, create local `AudioContext` + analyser
2. On `voice:user-joined` — create `RTCPeerConnection`, add local tracks, create + send offer
3. On `signal:offer` — create `RTCPeerConnection`, set remote description, create + send answer
4. On `signal:answer` — set remote description
5. On `signal:ice-candidate` — add to `RTCPeerConnection`
6. On `voice:user-left` — close peer connection, remove from UI
7. **`disconnectVoice()`** — emit `voice:leave`, close all `RTCPeerConnection`s, stop mic track, stop local stream
8. **Speaking detection** — replace fake `startVoiceLoungeSimulation()` with real `AnalyserNode` on mic stream (check volume threshold every 200ms)
9. **Real ping** — use `RTCPeerConnection.getStats()` instead of random ping
10. **Mute** — locally disable/enable mic track (`MediaStreamTrack.enabled`), emit `voice:mute-toggle` so peers see mute state

## Files Modified
- `stockwise/server.ts` — add voice signaling handlers
- `stockwise/pages/community.html` — replace fake voice with real WebRTC

## No new npm dependencies needed
- Socket.io v4.7.5 already installed (both server + client)
- WebRTC is browser-native

## Verification
1. Open two browser tabs on community.html
2. Join same voice channel in both
3. Verify: mic permission prompt appears, both users see each other in the channel
4. Verify: speaking indicator activates when talking
5. Verify: mute/unmute reflects for the other user
6. Verify: disconnecting removes the user
