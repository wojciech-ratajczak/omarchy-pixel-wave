import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Services.Pipewire
import qs.Commons as Commons
import "PixelWave.js" as PW

// The engine behind Pixel Wave, one per shell. It owns the audio capture
// (cava for the spectrum, PipeWire's peak monitor for loudness and the
// microphone) and the Voxtype listener, and publishes `levels` for every
// bar widget instance to draw. Capture only runs while an application has a
// playback stream open, or while Voxtype is recording.
Item {
  id: root

  property var shell: null
  property var manifest: null

  readonly property string pluginId: "io.github.wojciech-ratajczak.pixel-wave"
  readonly property string pluginDir: decodeURIComponent(String(Qt.resolvedUrl(".")).replace(/^file:\/\//, "")).replace(/\/+$/, "")

  // ------------------------------------------------------------ settings

  // Settings are read from shell.json itself: the shell API's barConfig
  // reaches services one save late, so a right-click would cycle from the
  // style before last. A change made from the bar applies at once through
  // localEntry, which is dropped when shell.json reloads with it.
  readonly property string shellJsonPath: (Quickshell.env("XDG_CONFIG_HOME") || (Quickshell.env("HOME") + "/.config")) + "/omarchy/shell.json"
  property var fileEntry: null
  property var localEntry: null
  readonly property var entry: localEntry || fileEntry || PW.findEntry(shell ? shell.barConfig : null, pluginId) || ({})
  readonly property var config: PW.config(entry)

  FileView {
    path: root.shellJsonPath
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: root.readShellJson(text())
  }

  function readShellJson(text) {
    if (!text || text.length > 1048576) return
    var parsed = null
    try {
      parsed = JSON.parse(text)
    } catch (e) {
      return // mid-write or hand-edited into invalid JSON: keep the last good settings
    }
    fileEntry = PW.findEntry(parsed, pluginId)
    localEntry = null
  }

  function persist(key, value) {
    var next = {}
    var base = fileEntry || PW.findEntry(shell ? shell.barConfig : null, pluginId) || {}
    for (var k in base) if (k !== "id") next[k] = base[k]
    if (localEntry) for (var lk in localEntry) if (lk !== "id") next[lk] = localEntry[lk]
    next[key] = value
    var local = { id: pluginId }
    for (var nk in next) local[nk] = next[nk]
    localEntry = local
    if (shell && typeof shell.updateEntryInline === "function") shell.updateEntryInline(pluginId, next)
  }

  function cycleStyle() { persist("style", PW.nextOf(config.style, PW.STYLES)) }
  function toggleData() {
    var next = config.data === "spectrum" ? "loudness" : "spectrum"
    persist("data", next)
    // Asking for the spectrum again is the moment to look for a freshly
    // installed cava, or to give one that kept crashing another go.
    if (next === "spectrum" && !spectrumReady) recheckSpectrum()
  }

  // --------------------------------------------------------------- state

  property bool cavaAvailable: false
  property bool voxtypeAvailable: false
  property bool cavaBroken: false
  property bool voxtypeRecording: false

  readonly property bool micActive: config.micMode && voxtypeRecording
  readonly property bool spectrumReady: cavaAvailable && !cavaBroken
  // "spectrum", "loudness", or "mic".
  readonly property string source: micActive ? "mic"
    : (config.data === "spectrum" && spectrumReady ? "spectrum" : "loudness")

  // An application has a playback stream open. Read as a plain bool so no
  // PwNode is held past the PipeWire graph removing it.
  readonly property bool hasPlayback: {
    var list = Pipewire.nodes ? Pipewire.nodes.values : []
    var names = []
    for (var j = 0; j < list.length; j++)
      if (list[j] && list[j].name) names.push(String(list[j].name))
    for (var i = 0; i < list.length; i++) {
      var n = list[i]
      if (!n || !n.isStream || n.isSink !== true) continue
      var name = String(n.name || "")
      if (name.indexOf("omarchy_speaker_tuning") === 0) continue
      if (platformHides(name, names)) continue
      return true
    }
    return false
  }

  // Streams of a platform's own audio processing (an Omarchy platform
  // package can name them in /usr/share/omarchy-platform/audio.json) are
  // always open, so they are not playback either; the audio panel leaves
  // them out the same way. Guarded, as AudioNodes is not a documented
  // plugin API: without it, nothing is left out.
  function platformHides(name, names) {
    try {
      var audioNodes = Commons.AudioNodes
      return !!audioNodes && typeof audioNodes.platformHides === "function"
        && audioNodes.platformHides(name, names) === true
    } catch (e) {
      return false
    }
  }

  // Keep listening a moment after the last stream closes, so a track change
  // does not restart cava.
  readonly property bool outputLive: hasPlayback || playbackHold.running
  readonly property bool cavaWanted: source === "spectrum" && outputLive
  readonly property bool peakWanted: source === "mic" || (source === "loudness" && outputLive)

  property var levels: PW.zeros(config.columns)
  // Loudness readings since the last tick, averaged so the wave follows
  // the music's swell rather than every clipped transient.
  property real peakSum: 0
  property int peakCount: 0
  property real loudRef: PW.MIN_REF_DB
  property real lastDb: PW.SILENT_DB

  onHasPlaybackChanged: if (!hasPlayback) playbackHold.restart()
  onSourceChanged: {
    levels = PW.zeros(config.columns)
    loudRef = PW.MIN_REF_DB
  }
  onCavaWantedChanged: syncCava.restart()

  // cava is started with the column count and frame rate, so a change to
  // either restarts it.
  readonly property string cavaKey: config.columns + ":" + config.framerate
  onCavaKeyChanged: {
    levels = PW.zeros(config.columns)
    if (cava.running) cava.restartPending = true
    syncCava.restart()
  }

  Timer {
    id: playbackHold
    interval: 3000
  }

  function setLevels(next) {
    if (!PW.sameLevels(levels, next)) levels = next
  }

  // ------------------------------------------------------------ probing

  Process {
    id: probe
    running: true
    command: ["sh", "-c", "command -v cava >/dev/null 2>&1 && echo cava; command -v voxtype >/dev/null 2>&1 && echo voxtype; true"]
    stdout: StdioCollector {
      onStreamFinished: {
        var found = String(text || "").split("\n")
        root.cavaAvailable = found.indexOf("cava") !== -1
        root.voxtypeAvailable = found.indexOf("voxtype") !== -1
        syncCava.restart()
        syncVoxtype.restart()
      }
    }
  }

  // ---------------------------------------------------- spectrum (cava)

  property int cavaFailures: 0
  // How long the spectrum rests after cava kept crashing, doubled each time
  // it happens again and reset by the first good frame.
  readonly property int cavaRecoverMin: 60000
  readonly property int cavaRecoverMax: 960000
  property int cavaRecoverDelay: cavaRecoverMin

  function recheckSpectrum() {
    cavaRecover.stop()
    cavaFailures = 0
    cavaBroken = false
    if (!probe.running) probe.running = true
  }

  Timer {
    id: cavaRecover
    interval: 60000 // set from cavaRecoverDelay before each start
    onTriggered: root.recheckSpectrum()
  }

  Timer {
    id: syncCava
    interval: 50
    onTriggered: {
      if (root.cavaWanted && !cava.running && !cavaRetry.running) {
        cava.restartPending = false
        cava.stopRequested = false
        cava.running = true
      } else if ((!root.cavaWanted || cava.restartPending) && cava.running && !cava.stopRequested) {
        // cava keeps running until it has exited; onExited syncs again, so
        // a source that comes back meanwhile restarts it at once.
        cava.stopRequested = true
        cava.running = false
      }
    }
  }

  Timer {
    id: cavaRetry
    interval: 3000
    onTriggered: syncCava.restart()
  }

  Process {
    id: cava
    property bool restartPending: false
    property bool stopRequested: false
    command:["bash", root.pluginDir + "/cava-run", String(root.config.columns), String(root.config.framerate)]
    stdout: SplitParser {
      onRead: function(data) {
        if (root.source !== "spectrum") return
        var frame = PW.parseCavaFrame(data, 100, 64)
        if (!frame) return
        root.cavaFailures = 0
        root.cavaRecoverDelay = root.cavaRecoverMin
        root.setLevels(PW.fit(frame, root.config.columns))
      }
    }
    onExited: function(exitCode, exitStatus) {
      // Stopped on purpose (the source changed, playback ended, or the
      // settings changed): not a crash, so sync again without counting it.
      if (cava.stopRequested || cava.restartPending) {
        cava.stopRequested = false
        syncCava.restart()
        return
      }
      if (!root.cavaWanted) return
      // Exited on its own while wanted. cava-run exits 127 when cava is gone:
      // show loudness until switching back to the spectrum looks again.
      if (exitCode === 127) {
        console.warn("io.github.wojciech-ratajczak.pixel-wave: cava is not installed; showing loudness instead")
        root.cavaAvailable = false
        return
      }
      // Otherwise retry a few times, then show loudness for a while (longer
      // each time) and try again. Switching back to the spectrum retries at once.
      root.cavaFailures += 1
      if (root.cavaFailures >= 5) {
        console.warn("io.github.wojciech-ratajczak.pixel-wave: cava keeps exiting (code " + exitCode + "); showing loudness for "
          + Math.round(root.cavaRecoverDelay / 1000) + " s")
        root.cavaBroken = true
        cavaRecover.interval = root.cavaRecoverDelay
        cavaRecover.restart()
        root.cavaRecoverDelay = Math.min(root.cavaRecoverMax, root.cavaRecoverDelay * 2)
        return
      }
      cavaRetry.restart()
    }
  }

  // ------------------------------------------- loudness and microphone

  PwNodePeakMonitor {
    id: peakMonitor
    node: root.source === "mic" ? Pipewire.defaultAudioSource : Pipewire.defaultAudioSink
    enabled: root.peakWanted && !!node
    onPeakChanged: {
      root.peakSum += peak
      root.peakCount += 1
    }
  }

  // Loudness scrolls one column per tick (about 1.2 s across 18 columns).
  // The same tick drains the wave back to a flat line once capture stops.
  Timer {
    id: tick
    interval: 66
    repeat: true
    running: root.peakWanted || (!root.cavaWanted && PW.anyAbove(root.levels, 0))
    onTriggered: {
      if (root.peakWanted) {
        var peak = root.peakCount > 0 ? root.peakSum / root.peakCount : (peakMonitor.enabled ? peakMonitor.peak : 0)
        root.peakSum = 0
        root.peakCount = 0
        var db = PW.peakToDb(peak)
        root.lastDb = db
        root.loudRef = PW.nextReference(root.loudRef, db)
        root.setLevels(PW.pushHistory(root.levels, PW.loudnessLevel(db, root.loudRef), root.config.columns))
        return
      }
      var next = []
      for (var i = 0; i < root.levels.length; i++) {
        var v = root.levels[i] * 0.6
        next.push(v < 0.03 ? 0 : v)
      }
      root.setLevels(next)
    }
  }

  // ------------------------------------------------------------ Voxtype

  readonly property bool voxtypeWanted: config.micMode && voxtypeAvailable
  onVoxtypeWantedChanged: syncVoxtype.restart()

  Timer {
    id: syncVoxtype
    interval: 50
    onTriggered: {
      if (root.voxtypeWanted && !voxtype.running && !voxtypeRetry.running) voxtype.running = true
      else if (!root.voxtypeWanted && voxtype.running) voxtype.running = false
      if (!root.voxtypeWanted) root.voxtypeRecording = false
    }
  }

  Timer {
    id: voxtypeRetry
    interval: 10000
    onTriggered: syncVoxtype.restart()
  }

  Process {
    id: voxtype
    command: ["voxtype", "status", "--follow", "--format", "json"]
    stdout: SplitParser {
      onRead: function(data) {
        var recording = PW.voxtypeRecording(data)
        if (recording !== null) root.voxtypeRecording = recording
      }
    }
    onExited: function(exitCode, exitStatus) {
      root.voxtypeRecording = false
      if (root.voxtypeWanted) voxtypeRetry.restart()
    }
  }

  // ---------------------------------------------------------------- IPC

  // omarchy-shell io.github.wojciech-ratajczak.pixel-wave cycleStyle | toggleData | status
  IpcHandler {
    target: "io.github.wojciech-ratajczak.pixel-wave"

    function cycleStyle(): void { root.cycleStyle() }
    function toggleData(): void { root.toggleData() }
    function status(): string {
      return "source=" + root.source + " style=" + root.config.style
        + " loudness=" + Math.round(root.lastDb) + "dB/ref " + Math.round(root.loudRef) + "dB"
        + " capturing=" + (cava.running || peakMonitor.enabled)
        + " playback=" + root.hasPlayback
        + " cava=" + (root.cavaAvailable ? (root.cavaBroken ? "broken" : "yes") : "missing")
        + " voxtype=" + (root.voxtypeAvailable ? (root.voxtypeRecording ? "recording" : "idle") : "missing")
    }
  }
}
