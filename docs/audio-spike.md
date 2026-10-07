# RN-030 · Audio capture spike

**Refs:** PRD Risk "browser audio capture" · Design 7.1, 13.2

Tests `getDisplayMedia` tab-audio and whole-screen system-audio capture in Chrome, to pick a
capture path for the audio layer (Milestone 3) before building on top of it.

## Environment actually available for this spike

- **OS:** macOS 26.6.2 only. Windows was not tested — no Windows machine available.
- **Call app:** Zoom only (web client and desktop app). Google Meet and Microsoft Teams were not
  tested — no access to those accounts/apps at spike time.

This is narrower than the original technical notes ask for (Chrome × macOS/Windows × Zoom/Meet/
Teams, web and desktop). The Windows and Meet/Teams cells below are left unfilled rather than
guessed at; re-running this spike against them is a prerequisite before RN-031+ assumes anything
about those combinations specifically.

## Results matrix

| | Zoom — web client | Zoom — desktop app |
| --- | --- | --- |
| **macOS 26.6.2** — tab-audio capture | ✅ `getAudioTracks()` returns ≥1 track | n/a — desktop app isn't a browser tab, nothing to pick |
| **macOS 26.6.2** — whole-screen + system-audio capture | ✅ `getAudioTracks()` returns ≥1 track | ✅ `getAudioTracks()` returns ≥1 track |
| **Windows** — either method | not tested | not tested |
| **macOS/Windows** — Meet, Teams | not tested | not tested |

**Method, both rows:** `navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })`,
then inspect `stream.getAudioTracks()`. Tab-audio: picker → "Chrome Tab" → the specific tab
running Zoom's web client → "Share tab audio" checked. Whole-screen: picker → "Entire Screen",
with the audio-share checkbox checked.

**Not yet tested on this spike:** mixing the captured stream with local mic input via Web Audio
(two `MediaStreamAudioSourceNode`s into one `AudioContext`) — only raw capture was verified. This
needs a follow-up pass before RN-030's "Mix mic + tab audio... into mono Opus, 250 ms chunks"
technical note can be considered validated end-to-end.

## Design open question Q3 (macOS with desktop call apps)

**Answered, for this one data point:** on macOS 26.6.2, whole-screen capture with system audio
works even when the call is running in a native desktop app (Zoom desktop), not just a browser
tab. `getDisplayMedia`'s screen-audio checkbox was offered and the resulting stream had a live
audio track in both the Zoom-web-client and Zoom-desktop-app cases.

This resolves the specific concern behind Q3 (whether macOS's historically inconsistent
screen-audio support would block desktop-app capture) for the tested OS version, but was only
checked against one call app (Zoom) and one macOS version — not confirmed across other versions
or other desktop call apps (Teams desktop in particular, still untested).

## Recommendation

**Primary capture path: whole-screen + system-audio capture**, not tab-audio capture — it's the
one method confirmed working against *both* a browser-tab call (Zoom web) and a native desktop
call app (Zoom desktop) on the one OS tested so far, and most real calls in practice run in a
desktop app (Zoom, Teams) rather than a browser tab, where tab-audio capture has nothing to pick
at all. Tab-audio capture is a fine *narrower* option specifically for browser-only call apps
(Google Meet has no desktop client), but shouldn't be the default given it doesn't cover desktop
apps.

**Mic-only fallback:** when `getDisplayMedia` is denied, throws, or (on an untested OS/version)
returns a stream with zero audio tracks, fall back to capturing the local participant's own
microphone only (`getUserMedia({ audio: true })`). The resulting transcript covers only that one
participant's side of the conversation rather than the full call — a degraded but still useful
result, instead of capturing nothing.

## Still open before this spike can be called complete

- Windows: both capture methods, against at least one call app.
- Google Meet and Microsoft Teams, web and (for Teams) desktop.
- Mic + captured-audio mixing quality (echo, drift) via Web Audio.
- A second macOS version, to confirm Q3's answer isn't specific to 26.6.2.
