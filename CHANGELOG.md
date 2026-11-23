# Changelog

## 1.2.0

- New styles: **peaks** (an equalizer whose peak caps hold for a moment and then fall back slowly), **drip** (bars hanging down from the top), **flame** (bars that fade out at their tips) and **pulse** (a glow in the middle that grows with the overall volume). Like the others, each rests as a visible line when it's quiet.
- **peaks** replaces the plain equalizer (`bars`), so right-click now cycles through six styles. A `"bars"` setting keeps working and shows **peaks**.
- New `styles` setting: pick which styles right-click cycles through, and in what order. It takes a list (or a comma-separated string) of style names; leave it empty for all of them.
- Left-click now plays or pauses your music over MPRIS: it pauses whatever is playing, or resumes the player you paused last. With no player around it does nothing. Switching between spectrum and loudness moved to the middle button, and `playPause` is available over IPC next to `toggleData`.
- New `pausedGraceSeconds` setting (default 60): with `hideWhenIdle` on, the widget used to leave the bar a few seconds after you paused, so you couldn't click it to resume. It now stays while a player is paused, for up to this many seconds after the sound stopped. Set it to 0 for the old behaviour.

## 1.1.1

- Paused players now count as idle. Spotify and browser tabs keep their audio stream open while paused, which kept the widget showing (and cava running) with nothing audible, so `hideWhenIdle` never hid it.

## 1.1.0

- Fixed: stopping cava on purpose (switching source, playback ending, a settings change) and wanting it back before it had exited counted as a crash. It now restarts at once instead of pausing for the retry delay and counting toward the fallback to loudness.
- Fixed: after cava kept crashing, the widget showed loudness until the shell restarted. It now tries cava again after 60 s, doubling up to 16 min while it keeps crashing, and switching back to the spectrum retries at once (and notices a cava installed after login). The tooltip says when cava keeps stopping instead of claiming it is not installed.
- Streams of an Omarchy platform's own audio processing no longer count as playback, so they don't keep the wave awake. The audio panel leaves them out the same way.
- New `hideWhenIdle` setting (off by default): the widget leaves the bar while nothing plays and the microphone is not shown, instead of resting as a flat line of dots.
- New opt-in setting `activeMonitorOnly`: on multi-monitor setups, show the widget only on the focused monitor.

## 1.0.0

- First release.
