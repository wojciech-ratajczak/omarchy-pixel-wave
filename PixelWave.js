.pragma library

// Pure helpers for the Pixel Wave plugin, kept out of the QML so
// tests/run.mjs can exercise them under Node.

var STYLES = ["mirror", "bars", "dots", "peaks", "drip", "flame", "pulse"]
// Styles drawn from one edge of the bar rather than around a centre row, so
// any row count works; the others need an odd count for the centre line.
var EDGE_STYLES = ["bars", "peaks", "drip", "flame"]
var DATA_MODES = ["spectrum", "loudness"]
var COLORS = ["foreground", "accent"]

// Loudness auto-gain: the wave spans RANGE_DB below a reference that follows
// the loudest recent level and falls DECAY_DB per tick, never under MIN_REF_DB,
// so loud music, quiet speech and system volume all fill the wave while
// silence and background hiss stay a flat line.
var RANGE_DB = 9
var DECAY_DB = 0.2
var MIN_REF_DB = -40
var SILENT_DB = -120

var DEFAULTS = {
  style: "mirror",
  styles: STYLES.slice(),
  data: "spectrum",
  columns: 18,
  cellSize: 2,
  framerate: 30,
  color: "foreground",
  activeMonitorOnly: false,
  showGrid: false,
  micMode: true,
  hideWhenIdle: false
}

function clampInt(value, min, max, fallback) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return fallback
  var n = Number(value)
  if (!isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.round(n)))
}

function oneOf(value, options, fallback) {
  var s = String(value === undefined || value === null ? "" : value).trim().toLowerCase()
  return options.indexOf(s) !== -1 ? s : fallback
}

// The styles right-click cycles through, in the order given: an array or a
// comma-separated string of style names. Unknown names and repeats are
// dropped; nothing valid left (or no setting) means all of them.
function styleList(value) {
  // A list handed over from C++ may be array-like rather than an Array.
  var items = Array.isArray(value) ? value
    : typeof value === "string" ? value.split(",")
    : value && typeof value === "object" && typeof value.length === "number" ? Array.prototype.slice.call(value, 0, 64)
    : []
  var out = []
  for (var i = 0; i < items.length && i < 64; i++) {
    if (typeof items[i] !== "string") continue
    var s = oneOf(items[i], STYLES, "")
    if (s !== "" && out.indexOf(s) === -1) out.push(s)
  }
  return out.length > 0 ? out : STYLES.slice()
}

// The style a right-click moves to: the next listed one, or the first listed
// when the current style is not in the list.
function nextStyle(cfg) {
  var list = cfg && Array.isArray(cfg.styles) && cfg.styles.length > 0 ? cfg.styles : STYLES
  return nextOf(cfg ? cfg.style : "", list)
}

// The plugin's settings from its shell.json bar entry, validated and bounded.
function config(entry) {
  var e = entry && typeof entry === "object" ? entry : {}
  return {
    style: oneOf(e.style, STYLES, DEFAULTS.style),
    styles: styleList(e.styles),
    data: oneOf(e.data, DATA_MODES, DEFAULTS.data),
    columns: clampInt(e.columns, 6, 48, DEFAULTS.columns),
    cellSize: clampInt(e.cellSize, 1, 6, DEFAULTS.cellSize),
    framerate: clampInt(e.framerate, 10, 60, DEFAULTS.framerate),
    color: oneOf(e.color, COLORS, DEFAULTS.color),
    activeMonitorOnly: e.activeMonitorOnly === true,
    showGrid: e.showGrid === true,
    micMode: e.micMode !== false,
    hideWhenIdle: e.hideWhenIdle === true
  }
}

// Whether the widget collapses out of the bar: only when asked to, and only
// while nothing plays (outputLive includes the short hold after a stream
// closes) and the microphone is not shown.
function hiddenWhenIdle(cfg, outputLive, micActive) {
  return !!cfg && cfg.hideWhenIdle === true && !outputLive && !micActive
}

// This plugin's entry in the bar layout (shell.barConfig, or a whole shell
// config that holds one under .bar), or null.
function findEntry(barConfig, id) {
  if (!barConfig || typeof barConfig !== "object") return null
  var layout = barConfig.layout
  if (!layout && barConfig.bar && typeof barConfig.bar === "object") layout = barConfig.bar.layout
  if (!layout || typeof layout !== "object") return null
  for (var section in layout) {
    var list = layout[section]
    if (!Array.isArray(list)) continue
    for (var i = 0; i < list.length; i++) {
      if (list[i] && typeof list[i] === "object" && String(list[i].id) === id) return list[i]
    }
  }
  return null
}

function nextOf(value, options) {
  var i = options.indexOf(value)
  return options[(i + 1) % options.length]
}

// Whether the copy of the widget on one monitor's bar is shown. With
// activeMonitorOnly it follows Hyprland's focused monitor, but only when
// there is more than one screen and both monitor names are known, so a
// single monitor, or a moment before Hyprland reports focus, never hides it.
function shownOnMonitor(activeMonitorOnly, screenCount, ownName, focusedName) {
  if (activeMonitorOnly !== true || !(screenCount > 1)) return true
  var own = String(ownName || "")
  var focused = String(focusedName || "")
  if (own === "" || focused === "") return true
  return own === focused
}

function zeros(n) {
  var out = []
  for (var i = 0; i < n; i++) out.push(0)
  return out
}

function sameLevels(a, b) {
  if (!a || !b || a.length !== b.length) return false
  for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function anyAbove(levels, threshold) {
  if (!levels) return false
  for (var i = 0; i < levels.length; i++) if (levels[i] > threshold) return true
  return false
}

// One cava raw ASCII frame ("12;0;99;") as levels in 0..1, or null when the
// line is not a well-formed frame. Bounded so a runaway line cannot grow it.
function parseCavaFrame(line, maxRange, maxBars) {
  var text = String(line === undefined || line === null ? "" : line).trim()
  if (text === "" || text.length > 1024) return null
  var parts = text.split(";")
  var out = []
  for (var i = 0; i < parts.length; i++) {
    if (parts[i] === "") continue
    if (!/^[0-9]{1,6}$/.test(parts[i])) return null
    if (out.length >= maxBars) break
    out.push(Math.max(0, Math.min(1, parseInt(parts[i], 10) / maxRange)))
  }
  return out.length > 0 ? out : null
}

// A linear peak (0..1, as PipeWire reports it) in dB full scale.
// A peak reading that counts as sound rather than silence (about -60 dBFS).
var AUDIBLE_PEAK = 0.001

function isAudible(peak) {
  var p = Number(peak)
  return isFinite(p) && p > AUDIBLE_PEAK
}

function peakToDb(peak) {
  var p = Number(peak)
  if (!isFinite(p) || p <= 0) return SILENT_DB
  return Math.max(SILENT_DB, 20 * Math.log(Math.min(1, p)) / Math.LN10)
}

// The auto-gain reference after one more reading.
function nextReference(ref, db) {
  var r = isFinite(ref) ? ref : MIN_REF_DB
  return Math.max(db, r - DECAY_DB, MIN_REF_DB)
}

// A dB reading as a 0..1 level against the auto-gain reference.
function loudnessLevel(db, ref) {
  var x = (db - (ref - RANGE_DB)) / RANGE_DB
  if (!(x > 0)) return 0
  return Math.pow(Math.min(1, x), 1.5)
}

// Push one level onto a scrolling history, dropping the oldest.
function pushHistory(history, value, length) {
  var out = (history || []).slice(Math.max(0, (history || []).length - length + 1))
  while (out.length < length - 1) out.unshift(0)
  out.push(value)
  return out
}

// Resample levels to n columns, keeping each column's loudest source value.
function fit(levels, n) {
  var src = levels || []
  if (src.length === n) return src
  var out = []
  for (var c = 0; c < n; c++) {
    if (src.length === 0) { out.push(0); continue }
    var from = Math.floor(c * src.length / n)
    var to = Math.max(from + 1, Math.floor((c + 1) * src.length / n))
    var v = 0
    for (var i = from; i < to && i < src.length; i++) v = Math.max(v, Number(src[i]) || 0)
    out.push(v)
  }
  return out
}

// How many cell rows fit across the bar. The mirrored styles need an odd
// count so a centre row carries the flat line.
function rowsFor(available, cell, gap, style) {
  var pitch = Math.max(1, cell + gap)
  var rows = Math.max(1, Math.floor((available + gap) / pitch))
  if (EDGE_STYLES.indexOf(style) === -1 && rows % 2 === 0) rows -= 1
  return Math.max(1, rows)
}

function shade(distance, maxDistance) {
  if (maxDistance <= 0) return 1
  return 1 - 0.45 * (distance / maxDistance)
}

// Peak caps for the peaks style: each column's cap jumps to a new high,
// holds there for PEAK_HOLD_MS, then falls one row every PEAK_FALL_MS.
var PEAK_HOLD_MS = 400
var PEAK_FALL_MS = 120

function peakLevel(peak) {
  var v = peak && typeof peak === "object" ? peak.level : peak
  v = Number(v)
  return isFinite(v) ? Math.max(0, Math.min(1, v)) : 0
}

// The caps after dtMs more milliseconds with these levels, as one
// { level, hold } per column (hold = ms left before it starts to fall).
// rows sets how far "one row" is in level units (default 5).
function nextPeaks(prevPeaks, levels, dtMs, rows) {
  var src = levels || []
  var prev = prevPeaks || []
  var dt = Math.max(0, Math.min(1000, Number(dtMs) || 0))
  var steps = Math.max(1, (Number(rows) || 5) - 1)
  var out = []
  for (var c = 0; c < src.length; c++) {
    var v = Math.max(0, Math.min(1, Number(src[c]) || 0))
    var p = prev[c]
    var level = peakLevel(p)
    var hold = p && typeof p === "object" && isFinite(Number(p.hold)) ? Number(p.hold) : 0
    if (v >= level) {
      out.push({ level: v, hold: PEAK_HOLD_MS })
      continue
    }
    if (hold >= dt) {
      out.push({ level: level, hold: hold - dt })
      continue
    }
    // The part of dt left after the hold ran out is spent falling.
    var fallen = level - (dt - Math.max(0, hold)) / PEAK_FALL_MS / steps
    out.push({ level: Math.max(v, fallen), hold: 0 })
  }
  return out
}

function anyPeakAbove(peaks, levels, threshold) {
  if (!peaks) return false
  for (var i = 0; i < peaks.length; i++) {
    var l = levels && levels[i] !== undefined ? Number(levels[i]) || 0 : 0
    if (peakLevel(peaks[i]) > Math.max(threshold, l)) return true
  }
  return false
}

// Opacity of the tip of a flame: the top cells fade out.
var FLAME_TIP = [0.3, 0.55, 0.8]

// Overall loudness of a set of levels for the pulse style: halfway between
// their RMS and their loudest value, so it swells with the music without
// sitting at full whenever one band peaks.
function overallLevel(levels) {
  var src = levels || []
  if (src.length === 0) return 0
  var sum = 0
  var max = 0
  for (var i = 0; i < src.length; i++) {
    var v = Math.max(0, Math.min(1, Number(src[i]) || 0))
    sum += v * v
    if (v > max) max = v
  }
  return Math.min(1, (Math.sqrt(sum / src.length) + max) / 2)
}

// The pulse style: a centred glow whose size follows the overall loudness.
// Distance is normalized per axis so the glow fills the width at full
// volume; at silence it is a short dim line in the middle.
function pulseOpacities(levels, columns, rows, grid, out) {
  var amp = overallLevel(levels)
  var hx = columns / 2
  var hy = rows / 2
  var cx = (columns - 1) / 2
  var cy = (rows - 1) / 2
  var minR = 1.6 / Math.max(1, hx)
  var radius = minR + amp * (1.2 - minR)
  var bright = 0.45 + 0.55 * amp
  for (var c = 0; c < columns; c++) {
    for (var r = 0; r < rows; r++) {
      var dx = (c - cx) / hx
      var dy = (r - cy) / hy
      var d = Math.sqrt(dx * dx + dy * dy)
      out[c * rows + r] = d <= radius ? Math.max(0.25, bright * (1 - 0.55 * d / radius)) : grid
    }
  }
  return out
}

// Opacity of every cell, column-major (index = column * rows + row), row 0 at
// the top. Silence still lights the centre row (mirror, dots, pulse), the
// bottom row (bars, peaks, flame) or the top row (drip), so the widget rests
// as a flat line instead of vanishing. peaks (optional) are the caps of the
// peaks style, from nextPeaks.
function cellOpacities(levels, columns, rows, style, gridOpacity, peaks) {
  var out = new Array(columns * rows)
  var grid = gridOpacity || 0
  if (style === "pulse") return pulseOpacities(levels, columns, rows, grid, out)
  var mid = (rows - 1) / 2
  for (var c = 0; c < columns; c++) {
    var v = Math.max(0, Math.min(1, Number(levels ? levels[c] : 0) || 0))
    if (EDGE_STYLES.indexOf(style) !== -1) {
      var lit = 1 + Math.round(v * (rows - 1))
      var cap = style === "peaks" && peaks ? Math.round(peakLevel(peaks[c]) * (rows - 1)) : -1
      for (var r = 0; r < rows; r++) {
        // Distance from the edge the column grows out of.
        var e = style === "drip" ? r : rows - 1 - r
        var o = grid
        if (e < lit) {
          if (style === "flame") {
            var tip = lit - 1 - e
            o = tip < FLAME_TIP.length ? FLAME_TIP[tip] : 1
          } else {
            o = shade(e, rows - 1)
          }
        } else if (e === cap) {
          o = 1
        }
        out[c * rows + r] = o
      }
    } else {
      var h = Math.round(v * mid)
      for (var r2 = 0; r2 < rows; r2++) {
        var d = Math.abs(r2 - mid)
        var on = style === "dots" ? d === h : d <= h
        out[c * rows + r2] = on ? shade(d, mid) : grid
      }
    }
  }
  return out
}

// Whether a line of `voxtype status --follow --format json` says it is
// recording. Returns null for a line that carries no state.
function voxtypeRecording(line) {
  var text = String(line === undefined || line === null ? "" : line).trim()
  if (text === "" || text.length > 4096) return null
  var state = text
  if (text.charAt(0) === "{") {
    try {
      var obj = JSON.parse(text)
      state = obj && typeof obj === "object" ? String(obj["class"] || obj.alt || "") : ""
    } catch (e) {
      return null
    }
  }
  state = state.trim().toLowerCase()
  if (state === "") return null
  return state === "recording"
}
