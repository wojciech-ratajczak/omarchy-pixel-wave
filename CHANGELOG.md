# Changelog

## 1.1.0

- Fixed: stopping cava on purpose (switching source, playback ending, a settings change) and wanting it back before it had exited counted as a crash. It now restarts at once instead of pausing for the retry delay and counting toward the fallback to loudness.
- Fixed: after cava kept crashing, the widget showed loudness until the shell restarted. It now tries cava again after 60 s, doubling up to 16 min while it keeps crashing, and switching back to the spectrum retries at once (and notices a cava installed after login). The tooltip says when cava keeps stopping instead of claiming it is not installed.
- Streams of an Omarchy platform's own audio processing no longer count as playback, so they don't keep the wave awake. The audio panel leaves them out the same way.
- New `hideWhenIdle` setting (off by default): the widget leaves the bar while nothing plays and the microphone is not shown, instead of resting as a flat line of dots.
- TODO-pending-merge: Multi-monitor: show only on the monitor with audio (opt-in).

## 1.0.0

- First release.
