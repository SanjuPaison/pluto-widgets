/*!
 * Pluto Phases Timeline — Renderer (public, non-proprietary)
 * ------------------------------------------------------------
 * Pure presentation: takes an already-computed timeline payload (see
 * core.mjs -> buildTimeline / the Worker's JSON response) and draws a
 * horizontal, clickable timeline that always fits its container's width
 * (no horizontal scrollbar) by computing pixels-per-day from the
 * container's actual size. No astrology logic lives here.
 *
 * Usage:
 *   PlutoTimelineRenderer.render(containerEl, payload, {
 *     onSelect: function(detail){}   // optional; called with { title, text, color }
 *   });
 */
(function (global) {
  "use strict";

  // Distinct hue per zodiac sign, used to fill the 1st/10th house bars so
  // they always read as solid, intentional color rather than looking empty.
  var SIGN_COLORS = {
    Aries: "#f87171", Taurus: "#fb923c", Gemini: "#fbbf24", Cancer: "#a3e635",
    Leo: "#4ade80", Virgo: "#34d399", Libra: "#22d3ee", Scorpio: "#60a5fa",
    Sagittarius: "#818cf8", Capricorn: "#c084fc", Aquarius: "#e879f9", Pisces: "#f472b6"
  };

  function dayNum(iso) { return Math.floor(new Date(iso + "T00:00:00Z").getTime() / 86400000); }

  function el(tag, className, text) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  var LABEL_WIDTH = 72; // keep in sync with .ppt-row-label width in timeline.css
  var SEAM_OVERLAP = 1.4; // px each seamless segment extends past its true edge, so
                           // adjoining year/house bars never show a hairline gap
                           // ("colored bar for year spills over into the next year")

  function render(container, payload, opts) {
    opts = opts || {};
    var onSelect = opts.onSelect || function () {};

    container.innerHTML = "";
    container.classList.add("ppt-root");

    var rangeStartDay = dayNum(payload.rangeStart);
    var rangeEndDay = dayNum(payload.rangeEnd);
    var totalDays = Math.max(1, rangeEndDay - rangeStartDay);

    // Fit-to-container: compute px/day from the real available width so the
    // whole range always renders with no horizontal scrollbar.
    var containerWidth = container.clientWidth || container.getBoundingClientRect().width || 320;
    var laneWidth = Math.max(120, containerWidth - LABEL_WIDTH);
    var pxPerDay = laneWidth / totalDays;

    function xFor(iso) { return (dayNum(iso) - rangeStartDay) * pxPerDay; }
    function wFor(startIso, endIso) { return Math.max(2, (dayNum(endIso) - dayNum(startIso)) * pxPerDay); }
    function seamlessWFor(startIso, endIso) {
      return Math.max(2, (dayNum(endIso) - dayNum(startIso)) * pxPerDay + SEAM_OVERLAP);
    }

    var track = el("div", "ppt-track");

    // ---- year-number row (full "2025" labels) — only when there's realistically
    // room for them; skipped automatically on a long (e.g. 100-year) timeline
    // where "unnecessary … if there's no space" per the spec. ----
    var startYear = new Date(payload.rangeStart + "T00:00:00Z").getUTCFullYear();
    var endYear = new Date(payload.rangeEnd + "T00:00:00Z").getUTCFullYear();
    var numYears = endYear - startYear + 1;
    if (numYears <= 6) {
      var numberRow = el("div", "ppt-row ppt-yearnum-row");
      numberRow.appendChild(el("div", "ppt-row-label", ""));
      var numberLane = el("div", "ppt-lane ppt-yearnum-lane");
      numberLane.style.width = laneWidth + "px";
      for (var ny = startYear; ny <= endYear; ny++) {
        var nyStart = ny + "-01-01", nyEnd = ny + "-12-31";
        var cell = el("div", "ppt-yearnum-cell", String(ny));
        cell.style.left = xFor(nyStart) + "px";
        cell.style.width = seamlessWFor(nyStart, nyEnd) + "px";
        numberLane.appendChild(cell);
      }
      numberRow.appendChild(numberLane);
      track.appendChild(numberRow);
    }

    // ---- year-luck row (most prominent, alongside 1st house) ----
    if (payload.yearRow && payload.yearRow.length) {
      var yearRowEl = el("div", "ppt-row ppt-year-row");
      var yearLabel = el("div", "ppt-row-label", "Year");
      yearRowEl.appendChild(yearLabel);
      var yearLane = el("div", "ppt-lane ppt-year-lane");
      yearLane.style.width = laneWidth + "px";
      payload.yearRow.forEach(function (yr) {
        var segStart = yr.startYear + "-01-01";
        var segEnd = yr.endYear + "-12-31";
        var block = el("div", "ppt-seg ppt-year-seg", String(yr.digit));
        block.style.left = xFor(segStart) + "px";
        block.style.width = seamlessWFor(segStart, segEnd) + "px";
        block.style.background = yr.color;
        block.title = yr.startYear + " \u2014 " + yr.label + " (digit " + yr.digit + ")";
        block.addEventListener("click", function () {
          onSelect({
            title: yr.startYear + " \u2014 " + yr.label + " (reduced digit " + yr.digit + ")",
            text: yr.description,
            color: yr.color
          });
        });
        yearLane.appendChild(block);
      });
      yearRowEl.appendChild(yearLane);
      track.appendChild(yearRowEl);
    }

    // ---- house rows (1st / 10th) ----
    function houseRow(label, key, textKey) {
      var row = el("div", "ppt-row ppt-house-row");
      var rowLabel = el("div", "ppt-row-label", label);
      row.appendChild(rowLabel);
      var lane = el("div", "ppt-lane");
      lane.style.width = laneWidth + "px";
      (payload.houseSegments || []).forEach(function (seg) {
        var segStart = seg.startYear + "-01-01";
        var segEndDate = seg.endYear + "-12-31";
        var block = el("div", "ppt-seg ppt-house-seg");
        block.style.left = xFor(segStart) + "px";
        block.style.width = seamlessWFor(segStart, segEndDate) + "px";
        block.style.background = SIGN_COLORS[seg[key]] || "var(--accent)";
        // No text label inside the bar (sign names vary too much in length to
        // reliably fit a squeezed multi-decade bar) — sign + range shows on
        // hover, and the full description on click, same as every other row.
        // Always the *full* Pluto Phase era range (e.g. 2017-2032), never
        // clipped to whatever slice of it happens to be visible right now.
        block.title = seg[key] + " (" + seg.eraStartYear + "\u2013" + seg.eraEndYear + ")";
        block.addEventListener("click", function () {
          onSelect({
            title: seg[key] + " in the " + label + " (" + seg.eraStartYear + "\u2013" + seg.eraEndYear + ")",
            text: seg[textKey] || "",
            color: SIGN_COLORS[seg[key]] || null
          });
        });
        lane.appendChild(block);
      });
      row.appendChild(lane);
      return row;
    }

    track.appendChild(houseRow("1st House", "firstHouseSign", "firstHouseText"));
    track.appendChild(houseRow("10th House", "tenthHouseSign", "tenthHouseText"));

    // ---- planet transit rows ----
    (payload.rows || []).forEach(function (row) {
      var rowEl = el("div", "ppt-row ppt-planet-row");
      var rowLabel = el("div", "ppt-row-label", row.pointName);
      rowEl.appendChild(rowLabel);
      var lane = el("div", "ppt-lane");
      lane.style.width = laneWidth + "px";
      row.hits.forEach(function (hit) {
        var hitEl = el("div", "ppt-hit");
        hitEl.style.left = xFor(hit.windowStart) + "px";
        hitEl.style.width = wFor(hit.windowStart, hit.windowEnd) + "px";
        hitEl.style.background = hit.color;
        hitEl.title = row.pointName + " " + hit.aspectLabel + " \u2014 exact " + hit.date;
        hitEl.addEventListener("click", function () {
          onSelect({
            title: row.pointName + " " + hit.aspectLabel + " \u2014 exact " + hit.date +
              " (active " + hit.windowStart + " to " + hit.windowEnd + ")",
            text: hit.text || "",
            color: hit.color
          });
        });
        lane.appendChild(hitEl);
      });
      rowEl.appendChild(lane);
      track.appendChild(rowEl);
    });

    // ---- "today" marker, if in range ----
    var todayIso = new Date().toISOString().slice(0, 10);
    if (dayNum(todayIso) >= rangeStartDay && dayNum(todayIso) <= rangeEndDay) {
      var todayMark = el("div", "ppt-today-mark");
      todayMark.style.left = (LABEL_WIDTH + xFor(todayIso)) + "px";
      track.appendChild(todayMark);
    }

    container.appendChild(track);
  }

  global.PlutoTimelineRenderer = { render: render };
})(typeof window !== "undefined" ? window : globalThis);
