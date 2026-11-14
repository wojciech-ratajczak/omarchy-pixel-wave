// Run: node tests/run.mjs  (from the plugin folder)
import { readFileSync } from "node:fs"
import assert from "node:assert/strict"

const src = readFileSync(new URL("../PixelWave.js", import.meta.url), "utf8").replace(/^\.pragma library\s*$/m, "")
const PW = new Function(src + "\nreturn { STYLES, config, findEntry, nextOf, parseCavaFrame, peakToDb, nextReference, loudnessLevel, MIN_REF_DB, RANGE_DB, pushHistory, fit, rowsFor, cellOpacities, voxtypeRecording, sameLevels, hiddenWhenIdle }")()

// config: defaults, bounds, junk
assert.deepEqual(PW.config(null).style, "mirror")
assert.equal(PW.config({ columns: 999 }).columns, 48)
assert.equal(PW.config({ columns: "abc" }).columns, 18)
assert.equal(PW.config({ columns: true }).columns, 18)
assert.equal(PW.config({ style: " BARS " }).style, "bars")
assert.equal(PW.config({ style: "<b>x</b>" }).style, "mirror")
assert.equal(PW.config({ micMode: false }).micMode, false)
assert.equal(PW.config(null).hideWhenIdle, false)
assert.equal(PW.config({ hideWhenIdle: true }).hideWhenIdle, true)
assert.equal(PW.config({ hideWhenIdle: "true" }).hideWhenIdle, false)

// hideWhenIdle: collapse only when asked, nothing plays and the mic is not shown
const hiding = PW.config({ hideWhenIdle: true })
assert.equal(PW.hiddenWhenIdle(hiding, false, false), true)
assert.equal(PW.hiddenWhenIdle(hiding, true, false), false)
assert.equal(PW.hiddenWhenIdle(hiding, false, true), false)
assert.equal(PW.hiddenWhenIdle(PW.config({}), false, false), false)
assert.equal(PW.hiddenWhenIdle(null, false, false), false)

// findEntry: bar subtree or whole config
const bar = { layout: { right: [{ id: "x" }, { id: "io.github.wojciech-ratajczak.pixel-wave", style: "dots" }] } }
assert.equal(PW.findEntry(bar, "io.github.wojciech-ratajczak.pixel-wave").style, "dots")
assert.equal(PW.findEntry({ bar }, "io.github.wojciech-ratajczak.pixel-wave").style, "dots")
assert.equal(PW.findEntry({}, "io.github.wojciech-ratajczak.pixel-wave"), null)

assert.equal(PW.nextOf("dots", PW.STYLES), "mirror")

// activeMonitorOnly: off by default, only true when set to true
assert.equal(PW.config(null).activeMonitorOnly, false)
assert.equal(PW.config({ activeMonitorOnly: true }).activeMonitorOnly, true)
assert.equal(PW.config({ activeMonitorOnly: "yes" }).activeMonitorOnly, false)
{
  const { shownOnMonitor } = new Function(src + "\nreturn { shownOnMonitor }")()
  // off: shown everywhere
  assert.equal(shownOnMonitor(false, 2, "DP-1", "HDMI-A-1"), true)
  // one screen: always shown, whatever Hyprland reports
  assert.equal(shownOnMonitor(true, 1, "eDP-1", "HDMI-A-1"), true)
  assert.equal(shownOnMonitor(true, 0, "", ""), true)
  // several screens: only on the focused one
  assert.equal(shownOnMonitor(true, 2, "DP-1", "DP-1"), true)
  assert.equal(shownOnMonitor(true, 2, "DP-1", "HDMI-A-1"), false)
  // focus or own monitor not known yet: shown rather than lost
  assert.equal(shownOnMonitor(true, 2, "DP-1", ""), true)
  assert.equal(shownOnMonitor(true, 2, "", "DP-1"), true)
  assert.equal(shownOnMonitor(true, 2, null, undefined), true)
}

// cava frames
assert.deepEqual(PW.parseCavaFrame("0;50;100;", 100, 64), [0, 0.5, 1])
assert.deepEqual(PW.parseCavaFrame("0;250;", 100, 64), [0, 1])
assert.equal(PW.parseCavaFrame("1;<img src=x>;", 100, 64), null)
assert.equal(PW.parseCavaFrame("", 100, 64), null)
assert.equal(PW.parseCavaFrame("1;".repeat(600), 100, 64), null)
assert.equal(PW.parseCavaFrame("1;".repeat(100), 100, 64).length, 64)

// loudness
assert.equal(PW.peakToDb(1), 0)
assert.equal(PW.peakToDb(0), -120)
assert.equal(PW.peakToDb(NaN), -120)
assert.ok(Math.abs(PW.peakToDb(0.1) + 20) < 1e-9)
// the reference jumps up to a loud reading and falls back slowly, not below the floor
assert.equal(PW.nextReference(-40, -3), -3)
assert.ok(PW.nextReference(-3, -30) > -4)
assert.equal(PW.nextReference(-40, -120), PW.MIN_REF_DB)
// at the reference the wave is full; RANGE_DB under it, flat; silence, flat
assert.equal(PW.loudnessLevel(-3, -3), 1)
assert.equal(PW.loudnessLevel(-3 - PW.RANGE_DB, -3), 0)
assert.equal(PW.loudnessLevel(-120, PW.MIN_REF_DB), 0)
// hiss under the floor reference stays below one row of a 5-row mirror (level < 0.25)
assert.ok(PW.loudnessLevel(-50, PW.MIN_REF_DB) < 0.25)
assert.deepEqual(PW.pushHistory([1, 2, 3], 4, 3), [2, 3, 4])
assert.deepEqual(PW.pushHistory([], 4, 3), [0, 0, 4])

// fit keeps the loudest value per column
assert.deepEqual(PW.fit([0, 1, 0, 0], 2), [1, 0])
assert.deepEqual(PW.fit([0.5], 3), [0.5, 0.5, 0.5])

// rows: odd for the mirrored styles
assert.equal(PW.rowsFor(16, 2, 1, "mirror"), 5)
assert.equal(PW.rowsFor(18, 2, 1, "mirror"), 5)
assert.equal(PW.rowsFor(18, 2, 1, "bars"), 6)

// silence rests as a flat line
const lit = (ops) => ops.map((o) => (o > 0 ? 1 : 0))
assert.deepEqual(lit(PW.cellOpacities([0], 1, 5, "mirror", 0)), [0, 0, 1, 0, 0])
assert.deepEqual(lit(PW.cellOpacities([0], 1, 5, "bars", 0)), [0, 0, 0, 0, 1])
assert.deepEqual(lit(PW.cellOpacities([1], 1, 5, "mirror", 0)), [1, 1, 1, 1, 1])
assert.deepEqual(lit(PW.cellOpacities([1], 1, 5, "dots", 0)), [1, 0, 0, 0, 1])
assert.deepEqual(lit(PW.cellOpacities([0.5], 1, 5, "dots", 0)), [0, 1, 0, 1, 0])

// voxtype status lines
assert.equal(PW.voxtypeRecording('{"text": "x", "alt": "recording", "class": "recording"}'), true)
assert.equal(PW.voxtypeRecording('{"class": "idle"}'), false)
assert.equal(PW.voxtypeRecording("idle"), false)
assert.equal(PW.voxtypeRecording("{broken"), null)
assert.equal(PW.voxtypeRecording(""), null)

console.log("pixelwave: all tests passed")
