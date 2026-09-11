/*!
 * Pluto Phases — Client Helper (public, non-proprietary)
 * -------------------------------------------------------
 * This file intentionally contains NO astrology logic, no era table, no
 * house content, and no interpretation text. All of that lives server-side
 * in the Cloudflare Worker (cloudflare-worker.js) and is never shipped to
 * the browser. This file only handles:
 *   - geocoding a birth place (OpenStreetMap Nominatim)
 *   - calling the Worker to get a computed reading
 *   - formatting a plain-text lead summary for the email step
 */
(function () {
  "use strict";

  function geocodePlace(placeName) {
    var url = "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" + encodeURIComponent(placeName);
    return fetch(url, { headers: { "Accept": "application/json" } })
      .then(function (r) { return r.json(); })
      .then(function (results) {
        if (!results || results.length === 0) {
          throw new Error("Could not find that location. Try a nearby larger city, or enter coordinates directly.");
        }
        return { latitude: parseFloat(results[0].lat), longitude: parseFloat(results[0].lon), displayName: results[0].display_name };
      });
  }

  function pad2(n) { n = String(n); return n.length < 2 ? "0" + n : n; }

  function buildLeadSummary(input, result, interestLabel, placeDisplayName) {
    var lines = [];
    lines.push("Interested in: " + interestLabel);
    lines.push("");
    lines.push("Birth date: " + input.birthYear + "-" + pad2(input.birthMonth) + "-" + pad2(input.birthDay));
    lines.push("Birth time: " + pad2(input.birthHour) + ":" + pad2(input.birthMinute) +
      (input.birthTimeUnknown ? " (marked as unknown/approximate)" : ""));
    lines.push("Birth place: " + (placeDisplayName || "(lat " + input.latitude + ", lon " + input.longitude + ")"));
    lines.push("UTC offset used: " + input.utcOffsetHours);
    lines.push("Gender: " + input.gender);
    lines.push("");
    lines.push("Event date: " + input.eventYear + "-" + pad2(input.eventMonth) + "-" + pad2(input.eventDay));
    lines.push("Event description: " + (input.description || "(none provided)"));
    lines.push("");
    if (result) {
      lines.push("Computed Pluto Phase era: " + result.era.sign + " (" + result.era.startYear + "\u2013" + result.era.endYear + ")");
      lines.push("Person sign used: " + result.personSign);
      lines.push("1st house sign: " + result.houses.firstHouseSign + " / 10th house sign: " + result.houses.tenthHouseSign);
      if (result.hits && result.hits.length) {
        lines.push("Top active aspect: " + result.hits[0].aspectLabel + " natal " + result.hits[0].natalPointName +
          " (exact " + result.hits[0].date.toISOString().slice(0, 10) + ")");
      }
    }
    return lines.join("\n");
  }

  // Calls the Cloudflare Worker and reconstructs Date objects from the
  // ISO strings the Worker returns (JSON has no native date type).
  function explainEventViaWorker(input, workerUrl) {
    return fetch(workerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    }).then(function (r) {
      return r.json().then(function (body) {
        if (!r.ok) {
          var err = new Error(body.message || body.error || "The reading service returned an error.");
          err.status = r.status;
          err.rateLimited = body.error === "rate_limited";
          throw err;
        }
        return body;
      });
    }).then(function (body) {
      var result = body.result;
      result.eventDate = new Date(result.eventDate);
      result.hits.forEach(function (h) {
        h.date = new Date(h.date);
        h.windowStartDate = new Date(h.windowStartDate);
        h.windowEndDate = new Date(h.windowEndDate);
      });
      result.remaining = body.remaining;
      return result;
    });
  }

  window.PlutoPhasesClient = {
    geocodePlace: geocodePlace,
    buildLeadSummary: buildLeadSummary,
    explainEventViaWorker: explainEventViaWorker
  };
})();
