"use strict";

const $ = (id) => document.getElementById(id);
const state = {files: [], fileId: null, eventId: null, revision: -1, status: "idle", wave: null, request: 0, controller: null, serverErrors: ""};
const colors = ["#39765f", "#588db0", "#9e81b1", "#b48b39", "#778f40", "#b36c88"];
const fmt = (n, digits = 0) => Number(n).toLocaleString(undefined, {minimumFractionDigits: digits, maximumFractionDigits: digits});
const file = () => state.files.find((item) => item.id === state.fileId);
const event = () => file()?.events.find((item) => item.id === state.eventId);
const selections = new Map();
let exporting = false;
let exported = null;
const selectedIds = () => selections.get(state.fileId) || new Set();
const repairPreview = () => $("preview-repair").checked && state.wave?.repaired_channels;
let view = "home", pendingReview = false;

function toggleRepair(id, checked) {
  const selected = new Set(selectedIds());
  if (checked) selected.add(id); else selected.delete(id);
  selections.set(state.fileId, selected);
  exported = null;
  renderCandidates();renderRepairPanel();
}

function renderRepairPanel() {
  const recording = file();
  $("repair-panel").classList.toggle("hidden", !recording);
  const count = selectedIds().size;
  $("selection-summary").textContent = count ? `${count} candidate${count === 1 ? "" : "s"} selected for repair` : "No candidates selected";
  $("repair-scope").textContent = recording?.repair_error || `${(recording?.events.length || 0) - count} left unchanged in this recording. Selections include candidates hidden by filters.`;
  $("repair-export").disabled = !count || exporting || state.status === "scanning" || !!recording?.repair_error;
  $("repair-export").textContent = exporting ? "Exporting & verifying…" : "Export repaired copy";
  $("select-shown").disabled = exporting || !visibleEvents().some(item => !item.repair_error);
  $("clear-selection").disabled = exporting || !count;
  $("quick-start").disabled = exporting || state.status === "scanning" || !visibleEvents().length;
  $("continue-review").classList.toggle("hidden", !recording);
  $("repair-result").classList.toggle("hidden", !exported || exported.fileId !== state.fileId);
  if (exported?.fileId === state.fileId) {
    const result = $("repair-result");
    result.replaceChildren(textNode("strong", "", `Saved ${exported.repaired_candidates} repairs to a new ${exported.format} file.`), textNode("span", "output-path", exported.output), textNode("p", "", "Verified: original checksum unchanged; every byte outside the selected repairs is identical."));
    for (const [label, href] of [["Download repaired audio", exported.download_url], ["Download verification report", exported.report_url]]) {
      const link = textNode("a", "", label);link.href = href;link.download = "";result.append(link);
    }
  }
}

function visibleEvents() {
  const confidence = $("confidence-filter").value;
  const events = (file()?.events || []).filter((item) => confidence === "all" || item.level === confidence);
  return events.sort($("sort-order").value === "score" ? (a, b) => b.confidence - a.confidence || a.sample_index - b.sample_index : (a, b) => a.sample_index - b.sample_index);
}

async function api(url, options) {
  const response = await fetch(url, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
  return result;
}

function showError(message) {
  $("error").textContent = message;
  $("error").classList.toggle("hidden", !message);
}

function textNode(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function renderFiles() {
  $("file-count").textContent = state.files.length;
  $("files").replaceChildren();
  for (const item of state.files) {
    const button = document.createElement("button");
    button.className = `file-button ${item.id === state.fileId ? "selected" : ""}`;
    button.setAttribute("aria-pressed", String(item.id === state.fileId));
    button.title = item.path;
    button.append(textNode("span", "file-name", item.name), textNode("span", "file-meta", `${item.events.length} candidates · ${fmt(item.stats.sample_rate / 1000, 1)} kHz · ${item.stats.channels === 1 ? "Mono" : `${item.stats.channels} channels`}`));
    button.addEventListener("click", () => selectFile(item.id));
    $("files").append(button);
  }
  if (!state.files.length) $("files").append(textNode("p", "sidebar-empty", state.status === "scanning" ? "Analysing the waveform…" : "Your scanned recordings will appear here."));
  const enabled = state.files.length > 0;
  $("export").classList.toggle("disabled", !enabled);
  $("export").setAttribute("aria-disabled", String(!enabled));
}

function renderCandidates() {
  const events = visibleEvents();
  $("candidate-count").textContent = events.length;
  $("candidates").replaceChildren();
  for (const item of events) {
    const row = textNode("div", `candidate-row ${selectedIds().has(item.id) ? "chosen" : ""}`, "");
    const button = document.createElement("button");
    button.className = `candidate-button ${item.id === state.eventId ? "selected" : ""}`;
    button.setAttribute("aria-pressed", String(item.id === state.eventId));
    button.setAttribute("aria-label", `${item.timestamp}, ${item.level} confidence ${item.confidence.toFixed(3)}`);
    const top = textNode("span", "candidate-top", "");
    top.append(textNode("span", "candidate-time", item.timestamp), textNode("span", `candidate-score ${item.level}`, item.confidence.toFixed(3)));
    const bottom = textNode("span", "candidate-bottom", "");
    bottom.append(textNode("span", "", item.kind === "exact-zero dropout" ? "Zero-sample dropout" : "Short discontinuity"), textNode("span", "mono", `${item.duration_ms.toFixed(3)} ms`));
    button.append(top, bottom);
    button.addEventListener("click", () => selectEvent(item.id));
    const check = document.createElement("input");
    check.type = "checkbox";check.className = "candidate-check";check.checked = selectedIds().has(item.id);
    check.disabled = !!item.repair_error || exporting;
    check.setAttribute("aria-label", `Repair candidate at ${item.timestamp}`);
    check.title = item.repair_error || "Check to include this candidate in the repaired copy";
    check.addEventListener("change", () => toggleRepair(item.id, check.checked));
    row.append(button, check);$("candidates").append(row);
  }
  if (!events.length) $("candidates").append(textNode("p", "sidebar-empty", file() ? "No candidates match this view." : "Select a recording to inspect its candidates."));
  renderRepairPanel();
}

function selectFile(id) {
  state.fileId = id;
  const events = visibleEvents();
  // Start at the strongest candidate; keep the list chronological by default.
  state.eventId = [...events].sort((a, b) => b.confidence - a.confidence)[0]?.id ?? null;
  renderFiles();
  renderCandidates();
  renderDetail();
  loadWaveform();
}

function selectEvent(id) {
  state.eventId = id;
  renderCandidates();
  renderDetail();
  loadWaveform();
}

function renderDetail() {
  const recording = file();
  const item = event();
  $("preview-repair").disabled = !item || !!item.repair_error;
  if (item?.repair_error) $("preview-repair").checked = false;
  $("detail").classList.toggle("hidden", !item);
  $("empty-state").classList.toggle("hidden", !!item);
  const audio = $("audio-preview");
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  if (!item) {
    const heading = $("empty-state").querySelector("h2");
    const description = $("empty-state").querySelector("p:not(.eyebrow)");
    heading.textContent = recording ? (recording.events.length ? "No candidates in this view." : "A clean view at this sensitivity.") : "Bring a recording into focus.";
    description.textContent = recording ? (recording.events.length ? "Choose another confidence level to inspect more candidates." : `${recording.name} has no reported candidates. If you hear a fault, try normal sensitivity or use a known timestamp to guide further analysis.`) : "Enter a local audio path above. Select a candidate to see its waveform, inspect individual samples, and listen to the surrounding audio.";
    return;
  }
  const stats = recording.stats;
  $("recording-name").textContent = recording.name;
  $("recording-meta").textContent = `${fmt(stats.sample_rate)} Hz · ${stats.bit_depth ? `${stats.bit_depth}-bit` : stats.subtype} · ${stats.channels === 1 ? "Mono" : `${stats.channels} channels`} · ${fmt(stats.duration_seconds, 2)} s · Peak ${stats.peak_dbfs.toFixed(2)} dBFS`;
  $("event-time").textContent = item.timestamp;
  $("copy-time").textContent = "Copy";
  $("event-sample").textContent = `Sample ${fmt(item.sample_index)} · zero-based`;
  $("event-confidence").replaceChildren(textNode("span", "mono", item.confidence.toFixed(3)), textNode("span", "level-tag", item.level.toUpperCase()));
  $("event-duration").textContent = `${item.duration_ms.toFixed(3)} ms`;
  $("event-length").textContent = `${item.duration_samples} sample${item.duration_samples === 1 ? "" : "s"}`;
  $("event-channels").textContent = item.channels.join(", ");
  $("event-kind").textContent = item.kind;
  const events = visibleEvents();
  const position = events.findIndex((candidate) => candidate.id === item.id);
  $("position").textContent = `${position + 1} / ${events.length}`;
  $("previous").disabled = position <= 0;
  $("next").disabled = position >= events.length - 1;
  audio.src = `/api/audio?${new URLSearchParams({file: recording.id, event: item.id, repaired: $("preview-repair").checked ? "1" : "0"})}`;
  $("repair-preview-note").textContent = item.repair_error || ($("preview-repair").checked ? "Proposed repair in colour · original in grey" : "Original waveform");
  document.querySelector(".listen-card .fine-print").textContent = $("preview-repair").checked ? "Proposed repair preview with 10 ms edge fades. Export uses exactly the checked candidates, without fades." : "Original audio with 10 ms preview-only edge fades. No normalization.";
  $("channel-legend").replaceChildren(...Array.from({length: stats.channels}, (_, index) => textNode("span", `channel-key c${index % colors.length}`, `Ch ${index + 1}`)));
  $("evidence").replaceChildren();
  const measures = [
    ["zero_run_samples", "Exact zero run", (n) => `${n} samples`],
    ["interpolation_residual_mad", "Interpolation residual", (n) => `${n.toFixed(1)} MAD`],
    ["neighbour_discontinuity_mad", "Neighbour discontinuity", (n) => `${n.toFixed(1)} MAD`],
    ["isolation_score", "Curvature isolation", (n) => `${n.toFixed(1)}×`],
    ["curvature_concentration", "Curvature concentration", (n) => `${(100 * n).toFixed(1)}%`],
    ["hf_burst_db", "HF energy vs. surroundings", (n) => `${n >= 0 ? "+" : ""}${n.toFixed(1)} dB`],
  ];
  for (const [key, label, format] of measures) {
    if (item.evidence[key] === undefined) continue;
    const row = textNode("div", "evidence-row", "");
    row.append(textNode("dt", "", label), textNode("dd", "", format(Number(item.evidence[key]))));
    $("evidence").append(row);
  }
}

async function loadWaveform() {
  state.controller?.abort();
  state.controller = new AbortController();
  const request = ++state.request;
  state.wave = null;
  drawCharts();
  const recording = file(), item = event();
  if (!item) return;
  $("plot-status").textContent = "Loading waveform…";
  try {
    const params = new URLSearchParams({file: recording.id, event: item.id, context: $("context-size").value});
    const result = await api(`/api/waveform?${params}`, {signal: state.controller.signal});
    if (request !== state.request) return;
    state.wave = result;
    $("plot-status").textContent = result.repair_error || "";
    if (result.repair_error) {item.repair_error = result.repair_error;$("preview-repair").checked = false;renderCandidates();renderDetail();}
    drawCharts();
  } catch (error) {
    if (error.name !== "AbortError" && request === state.request) $("plot-status").textContent = `Could not load waveform: ${error.message}`;
  }
}

function chartGeometry(canvas, zoom) {
  const wave = state.wave;
  const width = canvas.clientWidth, height = canvas.clientHeight;
  if (!wave || !wave.channels.length || !width || !height) return null;
  const center = wave.center_sample - wave.start_sample;
  const radius = Number($("sample-zoom").value);
  const first = zoom ? Math.max(0, center - radius) : 0;
  const last = zoom ? Math.min(wave.channels[0].length - 1, center + radius) : wave.channels[0].length - 1;
  if (last <= first) return null;
  let min = 0, max = 0;
  for (const channel of wave.channels) for (let i = first; i <= last; i++) {min = Math.min(min, channel[i]); max = Math.max(max, channel[i]);}
  const margin = Math.max((max - min) * .18, 0.00001);
  min -= margin; max += margin;
  const left = 58, right = width - 18, top = 15, bottom = height - 37;
  return {width, height, center, first, last, min, max, left, right, top, bottom,
    x: (i) => left + (i - first) / (last - first) * (right - left),
    y: (value) => bottom - (value - min) / (max - min) * (bottom - top)};
}

function drawChart(id, zoom, hoverIndex = null, mode = "auto") {
  const canvas = $(id), ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth, height = canvas.clientHeight;
  canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const g = chartGeometry(canvas, zoom);
  if (!g || !event()) return;
  const {first, last, center, min, max, left, right, top, bottom, x, y} = g;
  ctx.font = '9px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.lineWidth = 1;
  for (let tick = 0; tick <= 4; tick++) {
    const value = min + (max - min) * tick / 4;
    const yy = y(value);
    ctx.strokeStyle = "#eef1e9";ctx.beginPath();ctx.moveTo(left, yy);ctx.lineTo(right, yy);ctx.stroke();
    ctx.fillStyle = "#89967f";ctx.textAlign = "right";
    ctx.fillText(value.toFixed(max - min < .003 ? 5 : 3), left - 9, yy + 3);
  }
  for (let tick = 0; tick <= 4; tick++) {
    const index = first + (last - first) * tick / 4;
    const xx = x(index);
    ctx.strokeStyle = "#f2f4ef";ctx.beginPath();ctx.moveTo(xx, top);ctx.lineTo(xx, bottom);ctx.stroke();
    ctx.fillStyle = "#89967f";ctx.textAlign = "center";
    const label = zoom ? String(Math.round(index - center)) : ((state.wave.start_sample + index) / state.wave.sample_rate).toFixed(3);
    ctx.fillText(label, xx, bottom + 17);
  }
  ctx.fillStyle = "#929d89";ctx.textAlign = "center";
  ctx.fillText(zoom ? "Samples relative to detection" : "Time in source file (seconds)", (left + right) / 2, height - 3);
  const item = event();
  ctx.save();ctx.beginPath();ctx.rect(left, top, right - left, bottom - top);ctx.clip();
  if (zoom) {
    ctx.fillStyle = "rgba(195,101,81,.11)";
    for (const [, start, end] of item.spans || [[0, item.sample_index, item.sample_index + item.duration_samples - 1]]) {
      const lo = start - state.wave.start_sample, hi = end - state.wave.start_sample;
      ctx.fillRect(x(lo), top, Math.max(2, x(hi) - x(lo)), bottom - top);
    }
  }
  const repaired = mode === "fixed" ? state.wave.repaired_channels : mode === "original" ? null : repairPreview();
  if (mode === "fixed" && !repaired) return;
  if (repaired) {
    ctx.strokeStyle = "#bbc4b7";ctx.lineWidth = 1;ctx.setLineDash([3, 3]);
    state.wave.channels.forEach(channel => {ctx.beginPath();for (let i = first; i <= last; i++) {if (i === first) ctx.moveTo(x(i), y(channel[i])); else ctx.lineTo(x(i), y(channel[i]));}ctx.stroke();});
    ctx.setLineDash([]);
  }
  (repaired || state.wave.channels).forEach((channel, channelIndex) => {
    ctx.strokeStyle = colors[channelIndex % colors.length];ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = zoom ? 1.5 : 1.2;ctx.beginPath();
    for (let i = first; i <= last; i++) {if (i === first) ctx.moveTo(x(i), y(channel[i])); else ctx.lineTo(x(i), y(channel[i]));}
    ctx.stroke();
    if (zoom && last - first <= 192) for (let i = first; i <= last; i++) {ctx.beginPath();ctx.arc(x(i), y(channel[i]), 2.1, 0, Math.PI * 2);ctx.fill();}
  });
  ctx.strokeStyle = "#c36551";ctx.lineWidth = 1;ctx.setLineDash([4, 3]);ctx.beginPath();ctx.moveTo(x(center), top);ctx.lineTo(x(center), bottom);ctx.stroke();ctx.setLineDash([]);
  if (hoverIndex !== null) {ctx.strokeStyle = "#86957c";ctx.beginPath();ctx.moveTo(x(hoverIndex), top);ctx.lineTo(x(hoverIndex), bottom);ctx.stroke();}
  ctx.restore();
}

function drawCharts() {
  drawChart("context-chart", false);drawChart("sample-chart", true);
  if (view === "quick") {
    drawChart("quick-chart", true, null, "original");drawChart("quick-fixed-chart", true, null, "fixed");
    $("quick-fix-note").textContent = state.wave?.repair_error || (!state.wave ? "Loading waveform…" : "Only the shaded samples change. Dashed line shows the original.");
  }
  $("sample-readout").textContent = "Hover to inspect a sample";
}

function navigate(delta) {
  const events = visibleEvents();
  const index = events.findIndex((item) => item.id === state.eventId);
  if (events[index + delta]) {
    selectEvent(events[index + delta].id);
    $("candidates").querySelector(".selected")?.scrollIntoView({block: "nearest"});
  }
}

async function refresh() {
  try {
    const snapshot = await api(`/api/state?revision=${state.revision}`);
    state.status = snapshot.status;
    $("scan-button").disabled = snapshot.status === "scanning";
    $("scan-status").textContent = snapshot.status === "scanning" ? `${snapshot.completed} / ${snapshot.total || "…"} files · ${snapshot.current}` : snapshot.status === "done" ? `${snapshot.completed} file${snapshot.completed === 1 ? "" : "s"} scanned · ${snapshot.sensitivity}` : snapshot.status === "error" ? "Scan needs attention" : "Ready to scan";
    if (snapshot.files) {
      state.revision = snapshot.revision;
      state.files = snapshot.files;
      if (!$("source-path").value && snapshot.path) {$("source-path").value = snapshot.path;$("sensitivity").value = snapshot.sensitivity;}
      if (!file()) selectFile(state.files[0]?.id ?? null);
      else renderFiles();
    }
    renderRepairPanel();
    if (pendingReview && snapshot.status !== "scanning") {
      pendingReview = false;
      $("import-status").textContent = file() ? "Recording ready." : snapshot.errors.join("\n") || "No audio could be analysed.";
      if (file()) startQuickReview();
    }
    const errors = snapshot.errors.join("\n");
    if (errors !== state.serverErrors) {state.serverErrors = errors;showError(errors);}
  } catch (error) {
    $("scan-status").textContent = "Connection lost. Is the local server running?";
  } finally {
    window.setTimeout(refresh, state.status === "scanning" ? 600 : 2000);
  }
}

$("scan-form").addEventListener("submit", async (submission) => {
  submission.preventDefault();
  $("scan-button").disabled = true;
  showError("");
  try {
    await api("/api/scan", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({path: $("source-path").value, sensitivity: $("sensitivity").value})});
    state.status = "scanning";
    state.files = [];state.fileId = null;state.eventId = null;state.revision = -1;
    selections.clear();exported = null;
    state.controller?.abort();state.request++;state.wave = null;
    renderFiles();renderCandidates();renderDetail();
    $("scan-status").textContent = "Scanning audio…";
    pendingReview = true;
  } catch (error) {showError(error.message);$("scan-button").disabled = false;}
});

for (const id of ["confidence-filter", "sort-order"]) $(id).addEventListener("change", () => {
  const events = visibleEvents();
  if (!events.some((item) => item.id === state.eventId)) selectEvent(events[0]?.id ?? null);
  else {renderCandidates();renderDetail();}
});
$("context-size").addEventListener("change", loadWaveform);
$("preview-repair").addEventListener("change", () => {renderDetail();drawCharts();});
$("select-shown").addEventListener("click", () => {
  const selected = new Set(selectedIds());
  for (const item of visibleEvents()) if (!item.repair_error) selected.add(item.id);
  selections.set(state.fileId, selected);exported = null;renderCandidates();
});
$("clear-selection").addEventListener("click", () => {selections.delete(state.fileId);exported = null;renderCandidates();});
$("repair-export").addEventListener("click", async () => {
  const recording = file(), selected = [...selectedIds()];
  if (!recording || !selected.length || exporting) return;
  exporting = true;showError("");renderCandidates();
  try {
    const report = await api("/api/repair", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({file:recording.id,selected})});
    exported = {...report,fileId:recording.id};
  } catch (error) {showError(error.message);}
  finally {exporting = false;renderCandidates();}
});
$("sample-zoom").addEventListener("change", drawCharts);
$("previous").addEventListener("click", () => navigate(-1));
$("next").addEventListener("click", () => navigate(1));
$("copy-time").addEventListener("click", async () => {
  if (!event()) return;
  try {await navigator.clipboard.writeText(event().timestamp);$("copy-time").textContent = "Copied";} catch {$("copy-time").textContent = "Select to copy";const range = document.createRange();range.selectNodeContents($("event-time"));window.getSelection().removeAllRanges();window.getSelection().addRange(range);}
});
document.addEventListener("keydown", (key) => {
  if (view === "quick") return;
  if (["INPUT", "SELECT", "TEXTAREA", "AUDIO", "BUTTON"].includes(document.activeElement.tagName) || key.altKey || key.ctrlKey || key.metaKey) return;
  if (key.key === "ArrowLeft" || key.key === "ArrowRight") {key.preventDefault();navigate(key.key === "ArrowLeft" ? -1 : 1);}
});
$("sample-chart").addEventListener("pointermove", (pointer) => {
  const canvas = $("sample-chart"), g = chartGeometry(canvas, true);
  if (!g) return;
  const xx = pointer.clientX - canvas.getBoundingClientRect().left;
  const index = Math.max(g.first, Math.min(g.last, Math.round(g.first + (xx - g.left) / (g.right - g.left) * (g.last - g.first))));
  drawChart("sample-chart", true, index);
  $("sample-readout").textContent = `Sample ${fmt(state.wave.start_sample + index)} · ${(repairPreview() || state.wave.channels).map((channel, i) => `Ch ${i + 1}: ${channel[index].toFixed(7)}`).join(" · ")}`;
});
$("sample-chart").addEventListener("pointerleave", () => {drawChart("sample-chart", true);$("sample-readout").textContent = "Hover to inspect a sample";});
$("audio-preview").addEventListener("error", () => {if (event()) $("plot-status").textContent = "Preview could not be loaded. The source may have moved or changed; try scanning again.";});
new ResizeObserver(() => drawCharts()).observe($("inspector"));
refresh();

// A frozen queue keeps filtering/sorting from changing a review in progress.
const quick = {queue: [], index: 0, generation: 0, context: null, source: null, gain: null, controller: null};
function stopQuickAudio() {
  quick.generation++;
  quick.controller?.abort();
  if (quick.source) {
    const source = quick.source, gain = quick.gain, now = quick.context.currentTime;
    // Advancing/replaying mid-preview also needs a soft stop, not a hard cut.
    gain.gain.cancelScheduledValues(now);gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + .010);
    source.onended = () => {source.disconnect();gain.disconnect();};
    source.stop(now + .010);quick.source = null;quick.gain = null;
  }
}
async function playQuick() {
  stopQuickAudio();
  const generation = quick.generation, item = quick.queue[quick.index];
  if (!item || view !== "quick") return;
  $("quick-status").textContent = "Loading original audio…";
  quick.controller = new AbortController();
  try {
    quick.context ||= new AudioContext();
    await quick.context.resume();
    const response = await fetch(`/api/audio?${new URLSearchParams({file: state.fileId, event: item.id, repaired: "0"})}`, {signal: quick.controller.signal});
    if (!response.ok) throw new Error("Audio could not be loaded; try rescanning the file.");
    const buffer = await quick.context.decodeAudioData(await response.arrayBuffer());
    if (generation !== quick.generation || view !== "quick") return;
    if (quick.context.state !== "running") throw new Error("Playback blocked. Press Replay to enable audio.");
    const source = quick.context.createBufferSource();
    const gain = quick.context.createGain();
    source.buffer = buffer;source.connect(gain);gain.connect(quick.context.destination);quick.source = source;quick.gain = gain;
    source.onended = () => {source.disconnect();gain.disconnect();if (generation === quick.generation) {quick.source = null;quick.gain = null;$("quick-status").textContent = "P to go back · Y to stage · N to ignore · M to replay";}};
    source.start();$("quick-status").textContent = "Playing original audio…";
  } catch (error) {
    if (generation === quick.generation && error.name !== "AbortError") $("quick-status").textContent = error.message;
  }
}
function showQuickCandidate() {
  const item = quick.queue[quick.index];
  $("quick-back").disabled = quick.index <= 0;
  $("quick-confidence").classList.toggle("hidden", !item);
  $("quick-duration").classList.toggle("hidden", !item);
  $("quick-chart").closest(".comparison-grid").classList.toggle("hidden", !item);
  if (!item) {
    stopQuickAudio();
    $("quick-progress").textContent = `Review complete · ${quick.queue.length} candidates reviewed`;
    $("quick-time").textContent = `${selectedIds().size} staged for repair`;
    $("quick-status").textContent = "All done. Export your selected repairs below as a separate copy. Nothing has been exported yet.";
    for (const id of ["quick-yes", "quick-no", "quick-replay"]) $(id).disabled = true;
    $("quick-restart").focus();return;
  }
  $("quick-progress").textContent = `${quick.index + 1} / ${quick.queue.length}`;
  $("quick-confidence").textContent = `${item.level} confidence · ${item.confidence.toFixed(3)}`;
  $("quick-confidence").dataset.confidence = item.level;
  $("quick-duration").textContent = `${item.duration_ms.toFixed(3)} ms · Ch ${item.channels.join(", ")}`;
  $("quick-time").textContent = item.timestamp;
  $("quick-yes").disabled = !!item.repair_error;
  $("quick-yes").title = item.repair_error || "Stage this candidate for repair";
  $("quick-no").disabled = false;$("quick-replay").disabled = false;
  selectEvent(item.id);playQuick();
  $("quick-no").focus({preventScroll:true});
}
function previousQuick() {
  if (view !== "quick" || quick.index <= 0) return;
  quick.index--;showQuickCandidate();
}
function decideQuick(stage) {
  const item = quick.queue[quick.index];
  if (!item) return;
  if (stage && item.repair_error) {$("quick-status").textContent = item.repair_error;return;}
  toggleRepair(item.id, stage);quick.index++;showQuickCandidate();
}
function startQuickReview() {
  quick.queue = [...visibleEvents()];quick.index = 0;
  if (!file() || exporting || state.status === "scanning") return;
  $("audio-preview").pause();$("preview-repair").checked = false;
  $("quick-recording").textContent = file().name;
  $("quick-filter").value = $("confidence-filter").value;
  setView("quick");showQuickCandidate();
}
$("quick-start").addEventListener("click", startQuickReview);
document.addEventListener("keydown", key => {
  if (view !== "quick" || ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName)) return;
  if (key.ctrlKey || key.metaKey || key.altKey || key.repeat) return;
  if (key.key.toLowerCase() === "p") {key.preventDefault();previousQuick();return;}
  if (key.key.toLowerCase() === "m" && quick.queue[quick.index]) {key.preventDefault();playQuick();return;}
  if (["y", "n"].includes(key.key.toLowerCase())) {key.preventDefault();decideQuick(key.key.toLowerCase() === "y");}
});
$("quick-yes").addEventListener("click", () => decideQuick(true));
$("quick-no").addEventListener("click", () => decideQuick(false));
$("quick-replay").addEventListener("click", playQuick);
$("quick-back").addEventListener("click", previousQuick);
new ResizeObserver(() => {if (view === "quick") drawCharts();}).observe($("quick-dialog"));

// Page navigation moves the shared export panel without duplicating selections.
$("view-nav").after($("quick-dialog"));
function setView(next) {
  stopQuickAudio();$("audio-preview").pause();
  view = next;document.body.dataset.view = next;
  for (const [id, page] of [["go-quick", "quick"], ["go-detail", "detail"]]) {
    $(id).classList.toggle("primary", next === page);$(id).classList.toggle("secondary", next !== page);
    $(id).setAttribute("aria-pressed", String(next === page));
  }
  if (next === "quick") $("quick-repair-slot").append($("repair-panel"));
  else $("inspector").prepend($("repair-panel"));
  drawCharts();
}
$("go-home").addEventListener("click", () => setView("home"));
document.querySelector(".brand").addEventListener("click", e => {e.preventDefault();setView("home");});
$("go-detail").addEventListener("click", () => setView("detail"));
$("advanced-open").addEventListener("click", () => setView("detail"));
$("go-quick").addEventListener("click", () => {
  if (!file()) {setView("home");return;}
  if (quick.queue.includes(event())) {setView("quick");showQuickCandidate();}
  else startQuickReview();
});
$("continue-review").addEventListener("click", startQuickReview);
$("quick-restart").addEventListener("click", startQuickReview);
$("quick-filter").addEventListener("change", () => {$("confidence-filter").value = $("quick-filter").value;startQuickReview();});
let importing = false;
async function importAudioFiles(files) {
  if (importing || state.status === "scanning") {$("import-status").textContent = "Please wait for the current import or scan to finish.";return;}
  const input = $("audio-file"), chosen = files[0];
  if (!chosen) return;
  if (files.length !== 1) {$("import-status").textContent = "Please choose one recording at a time.";input.value = "";return;}
  if (!/\.(aif|aiff|aifc|wav)$/i.test(chosen.name)) {$("import-status").textContent = "Choose an AIFF or WAV file.";input.value = "";return;}
  importing = true;
  $("file-drop-zone").setAttribute("aria-busy", "true");
  input.disabled = true;$("import-status").textContent = "Copying locally and preparing analysis…";
  try {
    if (chosen.size > 2 * 1024 ** 3) throw new Error("Choose a file smaller than 2 GiB.");
    const result = await api("/api/import", {method:"POST", headers:{"Content-Type":"application/octet-stream", "X-Filename":encodeURIComponent(chosen.name)}, body:chosen});
    selections.clear();exported = null;state.files = [];state.fileId = null;state.eventId = null;state.wave = null;state.revision = -1;state.status = "scanning";
    state.controller?.abort();state.request++;
    $("source-path").value = result.path;pendingReview = true;
    $("import-status").textContent = "Finding clicks and dropouts…";
  } catch (error) {$("import-status").textContent = error.message;}
  finally {importing = false;input.disabled = false;input.value = "";$("file-drop-zone").setAttribute("aria-busy", "false");}
}
$("audio-file").addEventListener("change", () => importAudioFiles($("audio-file").files));
let fileDragDepth = 0;
const isFileDrag = e => Array.from(e.dataTransfer?.types || []).includes("Files");
$("file-drop-zone").addEventListener("dragenter", e => {
  if (!isFileDrag(e)) return;
  e.preventDefault();fileDragDepth++;
  if (!importing && state.status !== "scanning") $("file-drop-zone").classList.add("drag-over");
});
$("file-drop-zone").addEventListener("dragleave", () => {
  fileDragDepth = Math.max(0, fileDragDepth - 1);
  if (!fileDragDepth) $("file-drop-zone").classList.remove("drag-over");
});
$("file-drop-zone").addEventListener("dragover", e => {
  if (!isFileDrag(e)) return;
  e.preventDefault();e.dataTransfer.dropEffect = importing || state.status === "scanning" ? "none" : "copy";
});
$("file-drop-zone").addEventListener("drop", e => {
  e.preventDefault();fileDragDepth = 0;$("file-drop-zone").classList.remove("drag-over");
  importAudioFiles(e.dataTransfer?.files || []);
});
// Prevent an accidental drop outside the target from replacing the app with a file.
for (const name of ["dragover", "drop"]) document.addEventListener(name, e => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  if (name === "drop") {fileDragDepth = 0;$("file-drop-zone").classList.remove("drag-over");}
});
