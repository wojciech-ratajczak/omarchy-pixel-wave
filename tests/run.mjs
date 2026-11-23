// Run: node tests/run.mjs  (from the plugin folder)
import { readFileSync } from "node:fs"
import assert from "node:assert/strict"

const src = readFileSync(new URL("../PixelWave.js", import.meta.url), "utf8").replace(/^\.pragma library\s*$/m, "")
const PW = new Function(src + "\nreturn { STYLES, config, styleList, nextStyle, findEntry, nextOf, parseCavaFrame, peakToDb, nextReference, loudnessLevel, MIN_REF_DB, RANGE_DB, pushHistory, fit, rowsFor, cellOpacities, nextPeaks, anyPeakAbove, overallLevel, PEAK_HOLD_MS, PEAK_FALL_MS, voxtypeRecording, playPausePlan, isProxyPlayer, sameLevels, hiddenWhenIdle, isAudible }")()

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

assert.equal(PW.nextOf("dots", PW.STYLES), "peaks")
assert.equal(PW.nextOf("pulse", PW.STYLES), "mirror")
assert.deepEqual(PW.STYLES, ["mirror", "bars", "dots", "peaks", "drip", "flame", "pulse"])
for (const s of PW.STYLES) assert.equal(PW.config({ style: s }).style, s)

// styles: which styles right-click cycles through
assert.deepEqual(PW.config(null).styles, PW.STYLES)
assert.deepEqual(PW.config({ styles: ["pulse", "bars"] }).styles, ["pulse", "bars"])
assert.deepEqual(PW.config({ styles: "bars, PEAKS ,pulse" }).styles, ["bars", "peaks", "pulse"])
assert.deepEqual(PW.config({ styles: ["bars", "nope", "bars", 3, null, "dots"] }).styles, ["bars", "dots"])
assert.deepEqual(PW.config({ styles: [] }).styles, PW.STYLES)
assert.deepEqual(PW.config({ styles: "" }).styles, PW.STYLES)
assert.deepEqual(PW.config({ styles: ["nope"] }).styles, PW.STYLES)
assert.deepEqual(PW.config({ styles: 5 }).styles, PW.STYLES)
assert.deepEqual(PW.config({ styles: { a: "bars" } }).styles, PW.STYLES)
assert.deepEqual(PW.config({ styles: { length: 2, 0: "drip", 1: "flame" } }).styles, ["drip", "flame"])
// the default list is a copy, not STYLES itself
assert.notEqual(PW.config(null).styles, PW.STYLES)
// cycling stays within the list and wraps
assert.equal(PW.nextStyle(PW.config({ style: "bars", styles: ["bars", "pulse"] })), "pulse")
assert.equal(PW.nextStyle(PW.config({ style: "pulse", styles: ["bars", "pulse"] })), "bars")
// a current style outside the list goes to the first listed
assert.equal(PW.nextStyle(PW.config({ style: "mirror", styles: ["flame", "drip"] })), "flame")
// a single listed style stays put once there
assert.equal(PW.nextStyle(PW.config({ style: "drip", styles: ["drip"] })), "drip")
assert.equal(PW.nextStyle(PW.config({ style: "dots" })), "peaks")
assert.equal(PW.nextStyle(null), "mirror")

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

// silence and paused players are not playback
assert.equal(PW.isAudible(0), false)
assert.equal(PW.isAudible(0.0005), false)
assert.equal(PW.isAudible(0.01), true)
assert.equal(PW.isAudible(undefined), false)
assert.equal(PW.isAudible(NaN), false)

// fit keeps the loudest value per column
assert.deepEqual(PW.fit([0, 1, 0, 0], 2), [1, 0])
assert.deepEqual(PW.fit([0.5], 3), [0.5, 0.5, 0.5])

// rows: odd for the mirrored styles
assert.equal(PW.rowsFor(16, 2, 1, "mirror"), 5)
assert.equal(PW.rowsFor(18, 2, 1, "mirror"), 5)
assert.equal(PW.rowsFor(18, 2, 1, "bars"), 6)
for (const s of ["peaks", "drip", "flame"]) assert.equal(PW.rowsFor(18, 2, 1, s), 6)
for (const s of ["dots", "pulse"]) assert.equal(PW.rowsFor(18, 2, 1, s), 5)

// silence rests as a flat line
const lit = (ops) => ops.map((o) => (o > 0 ? 1 : 0))
assert.deepEqual(lit(PW.cellOpacities([0], 1, 5, "mirror", 0)), [0, 0, 1, 0, 0])
assert.deepEqual(lit(PW.cellOpacities([0], 1, 5, "bars", 0)), [0, 0, 0, 0, 1])
assert.deepEqual(lit(PW.cellOpacities([1], 1, 5, "mirror", 0)), [1, 1, 1, 1, 1])
assert.deepEqual(lit(PW.cellOpacities([1], 1, 5, "dots", 0)), [1, 0, 0, 0, 1])
assert.deepEqual(lit(PW.cellOpacities([0.5], 1, 5, "dots", 0)), [0, 1, 0, 1, 0])

// every style rests visibly at silence
for (const s of PW.STYLES) {
  const ops = PW.cellOpacities(PW.fit([], 9), 9, 5, s, 0, s === "peaks" ? PW.nextPeaks([], PW.fit([], 9), 0, 5) : null)
  assert.equal(ops.length, 45, s)
  assert.ok(ops.some((o) => o > 0), s + " rests visibly")
  assert.ok(ops.every((o) => o >= 0 && o <= 1), s + " opacities in range")
}

// drip hangs from the top: silence lights the top row, full lights it all
assert.deepEqual(lit(PW.cellOpacities([0], 1, 5, "drip", 0)), [1, 0, 0, 0, 0])
assert.deepEqual(lit(PW.cellOpacities([0.5], 1, 5, "drip", 0)), [1, 1, 1, 0, 0])
assert.deepEqual(lit(PW.cellOpacities([1], 1, 5, "drip", 0)), [1, 1, 1, 1, 1])
assert.ok(PW.cellOpacities([1], 1, 5, "drip", 0)[0] > PW.cellOpacities([1], 1, 5, "drip", 0)[4])

// flame: bottom-based, the tip fades
assert.deepEqual(lit(PW.cellOpacities([0], 1, 5, "flame", 0)), [0, 0, 0, 0, 1])
assert.deepEqual(PW.cellOpacities([1], 1, 5, "flame", 0), [0.3, 0.55, 0.8, 1, 1])
assert.deepEqual(PW.cellOpacities([0.5], 1, 5, "flame", 0), [0, 0, 0.3, 0.55, 0.8])
{
  const rest = PW.cellOpacities([0], 1, 5, "flame", 0)[4]
  assert.ok(rest > 0 && rest < 1, "flame rests dim but visible")
}

// peaks: a cap jumps to a new high, holds, then falls about a row per PEAK_FALL_MS
{
  let p = PW.nextPeaks([], [1, 0.5], 0, 5)
  assert.deepEqual(p.map((x) => x.level), [1, 0.5])
  // the bar drops at once; the cap holds
  p = PW.nextPeaks(p, [0, 0], 100, 5)
  assert.deepEqual(p.map((x) => x.level), [1, 0.5])
  assert.equal(p[0].hold, PW.PEAK_HOLD_MS - 100)
  // the hold runs out, then it falls one row (0.25 of 5 rows) per PEAK_FALL_MS
  p = PW.nextPeaks(p, [0, 0], PW.PEAK_HOLD_MS - 100 + PW.PEAK_FALL_MS, 5)
  assert.ok(Math.abs(p[0].level - 0.75) < 1e-9)
  assert.ok(Math.abs(p[1].level - 0.25) < 1e-9)
  assert.equal(p[0].hold, 0)
  // never below the bar
  p = PW.nextPeaks(p, [0.6, 0], 1000, 5)
  assert.ok(Math.abs(p[0].level - 0.6) < 1e-9)
  assert.equal(p[1].level, 0)
  // a new high resets the hold
  p = PW.nextPeaks(p, [0.9, 0], 50, 5)
  assert.equal(p[0].level, 0.9)
  assert.equal(p[0].hold, PW.PEAK_HOLD_MS)
  // junk in, sane out
  assert.deepEqual(PW.nextPeaks(null, null, NaN, 5), [])
  assert.equal(PW.nextPeaks([{ level: "x" }], [NaN], -5, 5)[0].level, 0)
  assert.equal(PW.anyPeakAbove([{ level: 0.5 }], [0.5], 0), false)
  assert.equal(PW.anyPeakAbove([{ level: 0.5 }], [0.2], 0), true)
  assert.equal(PW.anyPeakAbove([{ level: 0 }], [0], 0), false)
}
// peaks draws bars from the bottom plus a full-opacity cap above the bar
assert.deepEqual(lit(PW.cellOpacities([0], 1, 5, "peaks", 0, [{ level: 0 }])), [0, 0, 0, 0, 1])
assert.deepEqual(lit(PW.cellOpacities([0.25], 1, 5, "peaks", 0, [{ level: 1 }])), [1, 0, 0, 1, 1])
assert.equal(PW.cellOpacities([0.25], 1, 5, "peaks", 0, [{ level: 1 }])[0], 1)
// a cap level with the top of the bar is just the bar
assert.deepEqual(PW.cellOpacities([0.5], 1, 5, "peaks", 0, [{ level: 0.5 }]), PW.cellOpacities([0.5], 1, 5, "bars", 0))
// without caps it is bars
assert.deepEqual(PW.cellOpacities([0.5, 1], 2, 5, "peaks", 0), PW.cellOpacities([0.5, 1], 2, 5, "bars", 0))

// pulse: a centred glow that grows with the overall loudness
{
  const count = (ops) => ops.filter((o) => o > 0).length
  const quiet = PW.cellOpacities(PW.fit([], 9), 9, 5, "pulse", 0)
  const mid = PW.cellOpacities(new Array(9).fill(0.4), 9, 5, "pulse", 0)
  const loud = PW.cellOpacities(new Array(9).fill(1), 9, 5, "pulse", 0)
  // silence: a short dim line on the centre row
  quiet.forEach((o, i) => { if (o > 0) assert.equal(i % 5, 2, "silent pulse stays on the centre row") })
  assert.ok(count(quiet) >= 1 && count(quiet) <= 3)
  assert.ok(quiet[4 * 5 + 2] > 0 && quiet[4 * 5 + 2] < 0.6, "silent centre is dim")
  assert.ok(count(quiet) < count(mid) && count(mid) < count(loud))
  // full volume reaches both ends of the centre row and is brightest in the middle
  assert.ok(loud[0 * 5 + 2] > 0 && loud[8 * 5 + 2] > 0)
  assert.ok(loud[4 * 5 + 2] > loud[0 * 5 + 2])
  assert.ok(loud[4 * 5 + 2] > mid[4 * 5 + 2])
  // symmetric
  for (let c = 0; c < 9; c++) for (let r = 0; r < 5; r++) assert.equal(mid[c * 5 + r], mid[(8 - c) * 5 + (4 - r)])
  // ignores the shape: same loudness, same glow
  assert.deepEqual(PW.cellOpacities([1, 0, 0, 0, 0, 0, 0, 0, 0], 9, 5, "pulse", 0), PW.cellOpacities([0, 0, 0, 0, 0, 0, 0, 0, 1], 9, 5, "pulse", 0))
  assert.equal(PW.overallLevel([]), 0)
  assert.equal(PW.overallLevel([1, 1]), 1)
  // unlit cells take the grid opacity
  assert.ok(PW.cellOpacities(PW.fit([], 9), 9, 5, "pulse", 0.14).every((o) => o >= 0.14))
}

// play/pause: pause what plays, else resume the paused player active last
{
  const pl = (o) => Object.assign({ playing: false, paused: false, canPlay: true, canPause: true, canToggle: true, proxy: false, lastActive: 0 }, o)
  // nothing to act on
  assert.deepEqual(PW.playPausePlan([]), { action: "none", steps: [] })
  assert.deepEqual(PW.playPausePlan(null), { action: "none", steps: [] })
  assert.deepEqual(PW.playPausePlan([null, pl({})]), { action: "none", steps: [] }) // stopped, not paused
  // every playing real player is paused; paused ones are left alone
  assert.deepEqual(PW.playPausePlan([pl({ playing: true }), pl({ paused: true }), pl({ playing: true })]),
    { action: "pause", steps: [{ index: 0, call: "pause" }, { index: 2, call: "pause" }] })
  // a playing proxy is skipped while a real player plays, used when alone
  assert.deepEqual(PW.playPausePlan([pl({ playing: true, proxy: true }), pl({ playing: true })]).steps, [{ index: 1, call: "pause" }])
  assert.deepEqual(PW.playPausePlan([pl({ playing: true, proxy: true })]).steps, [{ index: 0, call: "pause" }])
  // no pause, but toggles: toggled; neither: nothing
  assert.deepEqual(PW.playPausePlan([pl({ playing: true, canPause: false })]).steps, [{ index: 0, call: "togglePlaying" }])
  assert.equal(PW.playPausePlan([pl({ playing: true, canPause: false, canToggle: false })]).action, "none")
  // resume: the most recently active paused player that can play
  assert.deepEqual(PW.playPausePlan([pl({ paused: true, lastActive: 3 }), pl({ paused: true, lastActive: 7 }), pl({ lastActive: 9 })]),
    { action: "play", steps: [{ index: 1, call: "play" }] })
  assert.deepEqual(PW.playPausePlan([pl({ paused: true, lastActive: 9, canPlay: false, canToggle: false }), pl({ paused: true, lastActive: 2 })]).steps,
    [{ index: 1, call: "play" }])
  assert.deepEqual(PW.playPausePlan([pl({ paused: true, canPlay: false })]).steps, [{ index: 0, call: "togglePlaying" }])
  // a real player wins over a proxy whatever the order
  assert.deepEqual(PW.playPausePlan([pl({ paused: true, proxy: true, lastActive: 9 }), pl({ paused: true, lastActive: 1 })]).steps, [{ index: 1, call: "play" }])
  assert.deepEqual(PW.playPausePlan([pl({ paused: true, lastActive: 1 }), pl({ paused: true, proxy: true, lastActive: 9 })]).steps, [{ index: 0, call: "play" }])
  assert.deepEqual(PW.playPausePlan([pl({ paused: true, proxy: true })]).steps, [{ index: 0, call: "play" }])
  assert.equal(PW.isProxyPlayer("org.mpris.MediaPlayer2.playerctld", ""), true)
  assert.equal(PW.isProxyPlayer("org.mpris.MediaPlayer2.spotify", "spotify"), false)
  assert.equal(PW.isProxyPlayer(undefined, "playerctld"), true)
}

// voxtype status lines
assert.equal(PW.voxtypeRecording('{"text": "x", "alt": "recording", "class": "recording"}'), true)
assert.equal(PW.voxtypeRecording('{"class": "idle"}'), false)
assert.equal(PW.voxtypeRecording("idle"), false)
assert.equal(PW.voxtypeRecording("{broken"), null)
assert.equal(PW.voxtypeRecording(""), null)

console.log("pixelwave: all tests passed")
