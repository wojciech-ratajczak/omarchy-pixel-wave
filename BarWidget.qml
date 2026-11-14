import QtQuick
import Quickshell
import qs.Commons
import qs.Commons as Commons
import qs.Ui
import "PixelWave.js" as PW

// Bar face of Pixel Wave: a grid of square cells lit from the levels the
// service publishes. One instance per monitor; it only draws and relays.
//
//   left click    spectrum <-> loudness over time
//   right click   next style: mirrored wave, equalizer, dotted line
BarWidget {
  id: root
  moduleName: "io.github.wojciech-ratajczak.pixel-wave"

  Commons.Translations { id: strings; directory: Qt.resolvedUrl("i18n") }

  readonly property var wave: bar && bar.shell && typeof bar.shell.serviceFor === "function"
    ? bar.shell.serviceFor("io.github.wojciech-ratajczak.pixel-wave") : null
  readonly property var cfg: wave ? wave.config : PW.config(root.settings)
  readonly property string source: wave ? wave.source : "loudness"
  readonly property bool micActive: source === "mic"

  // Geometry: square cells with a gap of about half a cell, as many rows as
  // fit across the bar.
  readonly property int cell: Math.max(1, Style.space(cfg.cellSize))
  readonly property int gap: Math.max(1, Style.space(Math.max(1, Math.round(cfg.cellSize / 2))))
  readonly property int pitch: cell + gap
  readonly property int columns: cfg.columns
  readonly property int rows: PW.rowsFor(barSize - 2 * Style.space(5), cell, gap, cfg.style)
  readonly property int span: columns * pitch - gap
  readonly property int crossSpan: rows * pitch - gap

  readonly property var levels: wave ? PW.fit(wave.levels, columns) : PW.zeros(columns)
  readonly property var opacities: PW.cellOpacities(levels, columns, rows, cfg.style, cfg.showGrid ? 0.14 : 0)

  // The microphone always draws in a colour the normal wave does not use.
  readonly property color foregroundInk: bar ? bar.barForeground : Commons.Color.foreground
  readonly property color urgentInk: bar ? bar.urgent : Commons.Color.urgent
  readonly property color normalInk: cfg.color === "accent" ? Commons.Color.accent : foregroundInk
  readonly property color micInk: cfg.color !== "accent" && !Qt.colorEqual(Commons.Color.accent, foregroundInk)
    ? Commons.Color.accent : urgentInk
  property color ink: micActive ? micInk : normalInk
  Behavior on ink {
    ColorAnimation { duration: Style.duration(180); easing.type: Easing.OutCubic }
  }

  readonly property string styleName: strings.t("style." + cfg.style)
  readonly property string tooltip: {
    var lines = []
    if (micActive) lines.push(strings.t("tooltip.mic"))
    else if (source === "spectrum") lines.push(strings.t("tooltip.spectrum"))
    else lines.push(strings.t("tooltip.loudness"))
    if (!micActive && cfg.data === "spectrum" && source === "loudness")
      lines.push(strings.t(wave && wave.cavaAvailable && wave.cavaBroken ? "tooltip.cavaFailed" : "tooltip.noCava"))
    lines.push(strings.t("tooltip.style").arg(styleName))
    lines.push("")
    lines.push(strings.t("tooltip.hint"))
    return lines.join("\n")
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    labelVisible: false
    hasVisualContent: true
    tooltipText: root.tooltip
    horizontalMargin: 6
    fixedWidth: root.vertical ? -1 : Math.ceil(grid.width + button.scaledHorizontalMargin * 2)
    fixedHeight: root.vertical ? Math.ceil(grid.height + Style.space(12)) : -1

    onPressed: function(pressedButton) {
      if (!root.wave) return
      if (pressedButton === Qt.RightButton) root.wave.cycleStyle()
      else if (pressedButton === Qt.LeftButton) root.wave.toggleData()
    }

    Item {
      id: grid
      anchors.centerIn: parent
      width: root.vertical ? root.crossSpan : root.span
      height: root.vertical ? root.span : root.crossSpan
      scale: button.pressScale

      Repeater {
        model: root.columns * root.rows

        Rectangle {
          required property int index
          readonly property int column: Math.floor(index / root.rows)
          readonly property int row: index % root.rows
          // Newest loudness lands on the reading end of the bar.
          readonly property int along: Commons.I18n.rightToLeft && !root.vertical
            ? root.columns - 1 - column : column

          x: root.vertical ? row * root.pitch : along * root.pitch
          y: root.vertical ? along * root.pitch : row * root.pitch
          width: root.cell
          height: root.cell
          color: root.ink
          opacity: root.opacities[index] || 0
          antialiasing: false
        }
      }
    }
  }
}
