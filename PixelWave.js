.pragma library

// Pure helpers for the Pixel Wave plugin, kept out of the QML so
// tests/run.mjs can exercise them under Node.

var STYLES = ["mirror", "bars", "dots"]
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

// The plugin's settings from its shell.json bar entry, validated and bounded.
function config(entry) {
  var e = entry && typeof entry === "object" ? entry : {}
  return {
    style: oneOf(e.style, STYLES, DEFAULTS.style),
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
  if (style !== "bars" && rows % 2 === 0) rows -= 1
  return Math.max(1, rows)
}

function shade(distance, maxDistance) {
  if (maxDistance <= 0) return 1
  return 1 - 0.45 * (distance / maxDistance)
}

// Opacity of every cell, column-major (index = column * rows + row), row 0 at
// the top. Silence still lights the centre row (mirror, dots) or the bottom
// row (bars), so the widget rests as a flat line instead of vanishing.
function cellOpacities(levels, columns, rows, style, gridOpacity) {
  var out = new Array(columns * rows)
  var grid = gridOpacity || 0
  var mid = (rows - 1) / 2
  for (var c = 0; c < columns; c++) {
    var v = Math.max(0, Math.min(1, Number(levels ? levels[c] : 0) || 0))
    if (style === "bars") {
      var lit = 1 + Math.round(v * (rows - 1))
      for (var r = 0; r < rows; r++) {
        var fromBottom = rows - 1 - r
        out[c * rows + r] = fromBottom < lit ? shade(fromBottom, rows - 1) : grid
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
