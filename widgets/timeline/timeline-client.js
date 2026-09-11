/*!
 * Pluto Phases Timeline — Client (Version 1, public, non-proprietary)
 * ----------------------------------------------------------------
 * Talks only to the Cloudflare Worker (WORKER_URL) for the computed
 * 3-year timeline, and to JotForm for the paid 100-Year Timeline purchase.
 * Contains no astrology logic, era table, or interpretation text.
 */
(function () {
  "use strict";

  // ---- REQUIRED: your deployed Cloudflare Worker URL ----
  var WORKER_URL = "https://pluto-timeline-widget.sanjupaison.workers.dev/";

  // ---- JotForm (same form used by the original widget; a "Time zone at
  // birth place" dropdown and a 100-Year Timeline checkbox option have both
  // been added to it) ----
  var JOTFORM_ID = "262381784349064";
  var JOTFORM_FIELDS = {
    birthDateMonth: "q2_datetime0[month]",
    birthDateDay: "q2_datetime0[day]",
    birthDateYear: "q2_datetime0[year]",
    birthTimeInput: "q3_time1[timeInput]",
    birthTimeAmpm: "q3_time1[ampm]",
    birthPlace: "q4_textbox2",
    gender: "q5_radio3",
    email: "q6_email4",
    service: "q7_checkbox5",
    // TODO: the "Time zone at birth place" field was added to the JotForm
    // after the fields above were created, so its internal field name isn't
    // predictable the way the others are. In the JotForm Form Builder, open
    // the field's Advanced properties (or Settings > Prefill) to find its
    // real name (something like "q9_timeZone"), then paste it here. Until
    // then, this one value is simply left for the visitor to pick manually
    // on the JotForm page — everything else still prefills correctly.
    timezone: null
  };
  var TIMELINE_SERVICE_LABEL = "100-Year Pluto Phases Timeline ($60)";

  // Keep this list's labels identical to the option text added to the
  // JotForm "Time zone at birth place" dropdown, so prefilling (once
  // JOTFORM_FIELDS.timezone is set above) matches exactly.
  var TIMEZONES = [
    { label: "UTC-12 \u2014 International Date Line West", offset: -12 },
    { label: "UTC-11 \u2014 Midway Island, Samoa", offset: -11 },
    { label: "UTC-10 \u2014 Hawaii", offset: -10 },
    { label: "UTC-9 \u2014 Alaska", offset: -9 },
    { label: "UTC-8 \u2014 Los Angeles, Vancouver", offset: -8 },
    { label: "UTC-7 \u2014 Denver, Phoenix", offset: -7 },
    { label: "UTC-6 \u2014 Chicago, Mexico City", offset: -6 },
    { label: "UTC-5 \u2014 New York, Toronto", offset: -5 },
    { label: "UTC-4 \u2014 Halifax, Santiago", offset: -4 },
    { label: "UTC-3 \u2014 Buenos Aires, Sao Paulo", offset: -3 },
    { label: "UTC-2 \u2014 Mid-Atlantic", offset: -2 },
    { label: "UTC-1 \u2014 Azores, Cape Verde", offset: -1 },
    { label: "UTC+0 \u2014 London, Lisbon, Accra", offset: 0 },
    { label: "UTC+1 \u2014 Paris, Berlin, Lagos", offset: 1 },
    { label: "UTC+2 \u2014 Athens, Cairo, Johannesburg", offset: 2 },
    { label: "UTC+3 \u2014 Moscow, Istanbul, Nairobi", offset: 3 },
    { label: "UTC+4 \u2014 Dubai, Abu Dhabi", offset: 4 },
    { label: "UTC+5 \u2014 Karachi, Tashkent", offset: 5 },
    { label: "UTC+5:30 \u2014 Mumbai, New Delhi, Colombo", offset: 5.5 },
    { label: "UTC+6 \u2014 Dhaka, Almaty", offset: 6 },
    { label: "UTC+7 \u2014 Bangkok, Jakarta", offset: 7 },
    { label: "UTC+8 \u2014 Beijing, Singapore, Hong Kong", offset: 8 },
    { label: "UTC+9 \u2014 Tokyo, Seoul", offset: 9 },
    { label: "UTC+9:30 \u2014 Adelaide", offset: 9.5 },
    { label: "UTC+10 \u2014 Sydney, Melbourne", offset: 10 },
    { label: "UTC+11 \u2014 Solomon Islands", offset: 11 },
    { label: "UTC+12 \u2014 Auckland, Fiji", offset: 12 }
  ];

  var timezoneSelect = document.getElementById("ptw-timezone");
  TIMEZONES.forEach(function (tz) {
    var opt = document.createElement("option");
    opt.value = tz.offset;
    opt.dataset.label = tz.label;
    opt.textContent = tz.label;
    if (tz.offset === 5.5) opt.selected = true;
    timezoneSelect.appendChild(opt);
  });

  // Populate the birth-time hour/minute/AM-PM selects (replaces the native
  // <input type="time">, which could crash in-app-browser WebViews).
  (function populateTimeSelects() {
    var hourSel = document.getElementById("ptw-hour");
    var minuteSel = document.getElementById("ptw-minute");
    var ampmSel = document.getElementById("ptw-ampm");
    for (var h = 1; h <= 12; h++) {
      var opt = document.createElement("option");
      opt.value = h; opt.textContent = (h < 10 ? "0" + h : h);
      hourSel.appendChild(opt);
    }
    for (var m = 0; m <= 59; m++) {
      var opt = document.createElement("option");
      opt.value = m; opt.textContent = (m < 10 ? "0" + m : m);
      minuteSel.appendChild(opt);
    }
    ["AM", "PM"].forEach(function (p) {
      var opt = document.createElement("option");
      opt.value = p; opt.textContent = p;
      ampmSel.appendChild(opt);
    });
    // Matches the old default of value="14:30" on the native time input.
    hourSel.value = "2";
    minuteSel.value = "30";
    ampmSel.value = "PM";
  })();

  // ---- Birth place geocoding (same approach as the "What Was Happening?"
  // widget: free-text place name -> OpenStreetMap Nominatim -> lat/lon).
  // This is optional; it only unlocks the Ascendant & Midheaven rows. ----
  var placeInput = document.getElementById("ptw-place");
  var locateBtn = document.getElementById("ptw-locate-btn");
  var geoStatus = document.getElementById("ptw-geo-status");
  // Default resolved location for the pre-filled "Kolkata, India" birth place,
  // so the initial auto-run (see bottom of file) doesn't need a network round
  // trip to Nominatim just to show its default timeline including Ascendant/
  // Midheaven. Editing the place field clears this, same as any other typed edit.
  var resolvedLat = 22.5726, resolvedLon = 88.3639, resolvedPlaceName = "Kolkata, India";
  geoStatus.textContent = "\u2713 " + resolvedPlaceName;
  geoStatus.className = "ptw-geo-ok";

  function geocodePlace(placeName) {
    var url = "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" + encodeURIComponent(placeName);
    return fetch(url, { headers: { "Accept": "application/json" } })
      .then(function (r) { return r.json(); })
      .then(function (results) {
        if (!results || results.length === 0) {
          throw new Error("Could not find that place. Try a nearby larger city.");
        }
        return { latitude: parseFloat(results[0].lat), longitude: parseFloat(results[0].lon), displayName: results[0].display_name };
      });
  }

  locateBtn.addEventListener("click", function () {
    var place = placeInput.value.trim();
    if (!place) {
      geoStatus.textContent = "Enter a place first.";
      geoStatus.className = "ptw-geo-err";
      return;
    }
    geoStatus.textContent = "Locating\u2026";
    geoStatus.className = "ptw-geo-pending";
    locateBtn.disabled = true;
    geocodePlace(place).then(function (loc) {
      resolvedLat = loc.latitude; resolvedLon = loc.longitude; resolvedPlaceName = loc.displayName;
      geoStatus.textContent = "\u2713 " + loc.displayName;
      geoStatus.className = "ptw-geo-ok";
    }).catch(function (err) {
      resolvedLat = null; resolvedLon = null; resolvedPlaceName = null;
      geoStatus.textContent = err.message || "Could not find that place.";
      geoStatus.className = "ptw-geo-err";
    }).finally(function () {
      locateBtn.disabled = false;
    });
  });

  // If they edit the place text after locating, the old lat/lon no longer
  // applies to what's currently typed — clear it so we don't silently use a
  // stale location.
  placeInput.addEventListener("input", function () {
    if (resolvedLat !== null) {
      resolvedLat = null; resolvedLon = null; resolvedPlaceName = null;
      geoStatus.textContent = "";
      geoStatus.className = "";
    }
  });

  var form = document.getElementById("ptw-form");
  var errorEl = document.getElementById("ptw-error");
  var timelineEl = document.getElementById("ptw-timeline");
  var legendEl = document.getElementById("ptw-legend");
  var detailEl = document.getElementById("ptw-detail");
  var detailTitle = document.getElementById("ptw-detail-title");
  var detailText = document.getElementById("ptw-detail-text");
  var buyBtn = document.getElementById("ptw-buy-btn");
  var submitBtn = document.getElementById("ptw-submit");

  var lastBirthInput = null;

  function pad2(n) { n = String(n); return n.length < 2 ? "0" + n : n; }

  function buildJotformUrl(input) {
    var hour24 = input.birthHour, minute = input.birthMinute;
    var hour12 = hour24 % 12; if (hour12 === 0) hour12 = 12;
    var ampm = hour24 >= 12 ? "PM" : "AM";
    var params = [];
    function add(name, val) { if (name) params.push(encodeURIComponent(name) + "=" + encodeURIComponent(val)); }
    add(JOTFORM_FIELDS.birthDateMonth, input.birthMonth);
    add(JOTFORM_FIELDS.birthDateDay, input.birthDay);
    add(JOTFORM_FIELDS.birthDateYear, input.birthYear);
    add(JOTFORM_FIELDS.birthTimeInput, hour12 + ":" + pad2(minute));
    add(JOTFORM_FIELDS.birthTimeAmpm, ampm);
    add(JOTFORM_FIELDS.gender, input.gender);
    add(JOTFORM_FIELDS.service, TIMELINE_SERVICE_LABEL);
    if (JOTFORM_FIELDS.timezone) add(JOTFORM_FIELDS.timezone, input.timezoneLabel);
    if (JOTFORM_FIELDS.birthPlace && input.birthPlaceName) add(JOTFORM_FIELDS.birthPlace, input.birthPlaceName);
    return "https://form.jotform.com/" + JOTFORM_ID + "?" + params.join("&");
  }

  function showDetail(detail) {
    detailTitle.textContent = detail.title;
    detailText.textContent = detail.text || "No interpretation available.";
  }

  // Picks the current calendar year's entry out of the payload's yearRow so
  // the interpretation box always shows something relevant by default,
  // rather than sitting empty until the visitor clicks a bar.
  function showDefaultDetail(timeline) {
    var thisYear = new Date().getUTCFullYear();
    var entry = (timeline.yearRow || []).find(function (yr) { return yr.startYear === thisYear; });
    if (entry) {
      showDetail({
        title: entry.startYear + " \u2014 " + entry.label + " (reduced digit " + entry.digit + ")",
        text: entry.description
      });
    } else if (timeline.yearRow && timeline.yearRow.length) {
      var mid = timeline.yearRow[Math.floor(timeline.yearRow.length / 2)];
      showDetail({ title: mid.startYear + " \u2014 " + mid.label + " (reduced digit " + mid.digit + ")", text: mid.description });
    }
  }

  function renderLegend() {
    var items = [
      { label: "Conjunct", color: "#c084fc" },
      { label: "Sextile", color: "#67e8f9" },
      { label: "Square", color: "#f87171" },
      { label: "Trine", color: "#4ade80" },
      { label: "Opposite", color: "#fbbf24" }
    ];
    legendEl.innerHTML = "";
    items.forEach(function (it) {
      var wrap = document.createElement("span");
      wrap.className = "ppt-legend-item";
      var dot = document.createElement("span");
      dot.className = "ppt-legend-dot";
      dot.style.background = it.color;
      wrap.appendChild(dot);
      wrap.appendChild(document.createTextNode(it.label));
      legendEl.appendChild(wrap);
    });
    legendEl.style.display = "flex";
  }

  function runTimeline(input) {
    errorEl.textContent = "";
    lastBirthInput = input;

    submitBtn.disabled = true;
    submitBtn.textContent = "Calculating\u2026";

    return fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    }).then(function (r) {
      return r.json().then(function (body) {
        if (!r.ok) throw new Error(body.message || body.error || "The timeline service returned an error.");
        return body;
      });
    }).then(function (body) {
      renderLegend();
      PlutoTimelineRenderer.render(timelineEl, body.result.timeline, { onSelect: showDetail });
      showDefaultDetail(body.result.timeline);
    }).catch(function (err) {
      errorEl.textContent = err.message || "Something went wrong. Please try again.";
      timelineEl.innerHTML = '<div class="ppt-root" style="text-align:center;padding:30px 12px;color:var(--text-lo);font-size:13px;">Couldn\u2019t load the timeline.</div>';
    }).finally(function () {
      submitBtn.disabled = false;
      submitBtn.textContent = "Show My Timeline";
    });
  }

  function readFormInput() {
    var year = parseInt(document.getElementById("ptw-year").value, 10);
    var month = parseInt(document.getElementById("ptw-month").value, 10);
    var day = parseInt(document.getElementById("ptw-day").value, 10);
    var hourSel = document.getElementById("ptw-hour");
    var minuteSel = document.getElementById("ptw-minute");
    var ampmSel = document.getElementById("ptw-ampm");
    var gender = document.getElementById("ptw-gender").value;
    var tzOption = timezoneSelect.options[timezoneSelect.selectedIndex];
    var utcOffsetHours = parseFloat(tzOption.value);

    if (!year || !month || !day || !hourSel.value || !minuteSel.value || !ampmSel.value) return null;
    var hour24 = parseInt(hourSel.value, 10) % 12;
    if (ampmSel.value === "PM") hour24 += 12;

    return {
      birthYear: year, birthMonth: month, birthDay: day,
      birthHour: hour24, birthMinute: parseInt(minuteSel.value, 10),
      utcOffsetHours: utcOffsetHours, gender: gender,
      timezoneLabel: tzOption.dataset.label,
      // Optional — only present if "Locate" successfully resolved a birth place.
      // Enables the Ascendant/Midheaven rows; everything else works without it.
      latitude: resolvedLat, longitude: resolvedLon, birthPlaceName: resolvedPlaceName
    };
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var input = readFormInput();
    if (!input) {
      errorEl.textContent = "Please fill in your full birth date and time.";
      return;
    }
    runTimeline(input);
  });

  // "100 Years ($60)" opens JotForm pre-filled with whatever's currently in
  // the form (falls back to a bare JotForm link if nothing's been entered yet,
  // though in practice the auto-filled defaults mean lastBirthInput always
  // exists by the time this is clickable).
  buyBtn.addEventListener("click", function () {
    var url = lastBirthInput ? buildJotformUrl(lastBirthInput) : "https://form.jotform.com/" + JOTFORM_ID;
    window.open(url, "_blank", "noopener");
  });

  // Show a live example immediately on load, using whatever's already filled
  // into the form (see the "value" attributes in index.html) — no blank
  // placeholder, no "fill this in first" instructions. Visitors can then
  // change any field and tap "Show My Timeline" to see their own.
  runTimeline(readFormInput());
})();
