const $ = (s) => document.querySelector(s);
const state = {
  file: null,
  edf: null,
  start: 0,
  window: 10,
  gain: 1,
  channels: [],
  data: [],
  selection: null,
  annotations: [],
  seizureDetection: null,
  seizureDetectionStatus: null,
  seizureDetectionRunAt: null,
  backgroundAnalysis: null,
  backgroundAnalysisStatus: null,
  backgroundAnalysisRunAt: null,
  recordingMetadata: null,
  sourceFileName: null,
  sourceFileSize: null,
  reportGeneratedAt: null,
  reportOutOfDate: false,
  analysisSessionId: null,
  analysisSourceUrl: null,
  editing: null,
  playing: null,
  readToken: 0,
};
const colors = {
  Seizure: "#d75a54",
  Spike: "#f1a55b",
  Artifact: "#8d78bc",
  "Eye movement": "#5797c7",
  "Sleep event": "#248b78",
  "Technical issue": "#7b8582",
  Other: "#bd7a9c",
};

// const API_BASE_URL = "https://fyp-api.azutoro.com";
const API_BASE_URL =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1"
    ? "http://127.0.0.1:8000"
    : "https://fyp-api.azutoro.com";


async function createAnalysisSession(file) {
  const formData = new FormData();
  formData.append("veeg", file);
  const response = await fetch(`${API_BASE_URL}/upload`, { method: "POST", body: formData });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || "Could not upload EEG recording.");
  }
  return response.json();
}

async function createAnalysisSessionFromUrl(url, filename) {
  const response = await fetch(
    `${API_BASE_URL}/open-saved-recording`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, filename })
    }
  );
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || "Could not open saved EEG recording for analysis.");
  }
  return response.json();
}

async function fetchSessionEDF(sessionId, filename) {
  const response = await fetch(`${API_BASE_URL}/edf/${sessionId}`);
  if (!response.ok) {
    throw new Error("The converted EDF recording could not be downloaded.");
  }
  const blob = await response.blob();
  return new File(
    [blob],
    filename || "recording.edf",
    {
      type: "application/octet-stream",
      lastModified: Date.now()
    }
  );
}

async function ensureAnalysisSession() {
  if (state.analysisSessionId) return state.analysisSessionId;
  let result;
  if (state.analysisSourceUrl) {
    result = await createAnalysisSessionFromUrl(
      state.analysisSourceUrl,
      state.sourceFileName || state.file?.name || "recording.edf"
    );
  } else {
    result = await createAnalysisSession(state.file);
  }
  state.analysisSessionId = result.session_id;
  state.recordingMetadata = result.recording_metadata ?? state.recordingMetadata;
  return state.analysisSessionId;
}

function text(bytes) {
  return new TextDecoder("ascii").decode(bytes);
}
function field(bytes, start, len) {
  return text(bytes.subarray(start, start + len)).trim();
}
function numberField(bytes, start, len) {
  return Number(field(bytes, start, len)) || 0;
}
async function parseEDF(file) {
  const base = new Uint8Array(await file.slice(0, 256).arrayBuffer());
  if (base.length < 256)
    throw new Error("This file is too small to be an EDF recording.");
  const signalCount = numberField(base, 252, 4),
    headerBytes = numberField(base, 184, 8);
  if (!signalCount || headerBytes < 256 + signalCount * 256)
    throw new Error("Invalid or unsupported EDF header.");
  const h = new Uint8Array(await file.slice(0, headerBytes).arrayBuffer()),
    readArray = (offset, width) =>
      Array.from({ length: signalCount }, (_, i) =>
        field(h, offset + i * width, width),
      );
  let o = 256;
  const labels = readArray(o, 16);
  o += 16 * signalCount;
  const transducers = readArray(o, 80);
  o += 80 * signalCount;
  const dimensions = readArray(o, 8);
  o += 8 * signalCount;
  const physicalMin = readArray(o, 8).map(Number);
  o += 8 * signalCount;
  const physicalMax = readArray(o, 8).map(Number);
  o += 8 * signalCount;
  const digitalMin = readArray(o, 8).map(Number);
  o += 8 * signalCount;
  const digitalMax = readArray(o, 8).map(Number);
  o += 8 * signalCount;
  const prefilters = readArray(o, 80);
  o += 80 * signalCount;
  const samplesPerRecord = readArray(o, 8).map(Number);
  o += 8 * signalCount;
  const reservedSignals = readArray(o, 32);
  const recordDuration = numberField(base, 244, 8) || 1;
  let recordCount = Number(field(base, 236, 8));
  const bytesPerRecord = samplesPerRecord.reduce((a, b) => a + b, 0) * 2;
  if (recordCount < 0 || !recordCount)
    recordCount = Math.floor((file.size - headerBytes) / bytesPerRecord);
  let byteOffset = 0;
  const signals = labels.map((label, i) => {
    const s = {
      index: i,
      label: label || `Signal ${i + 1}`,
      transducer: transducers[i],
      dimension: dimensions[i],
      physicalMin: physicalMin[i],
      physicalMax: physicalMax[i],
      digitalMin: digitalMin[i],
      digitalMax: digitalMax[i],
      prefilter: prefilters[i],
      samplesPerRecord: samplesPerRecord[i],
      sampleRate: samplesPerRecord[i] / recordDuration,
      recordByteOffset: byteOffset,
      reserved: reservedSignals[i],
    };
    byteOffset += s.samplesPerRecord * 2;
    return s;
  });
  return {
    version: field(base, 0, 8),
    patient: field(base, 8, 80),
    recording: field(base, 88, 80),
    startDate: field(base, 168, 8),
    startTime: field(base, 176, 8),
    headerBytes,
    recordCount,
    recordDuration,
    bytesPerRecord,
    duration: recordCount * recordDuration,
    signals,
  };
}
async function readSignalWindow(signal, start, duration, token) {
  const e = state.edf,
    first = Math.max(0, Math.floor(start / e.recordDuration)),
    last = Math.min(
      e.recordCount - 1,
      Math.floor((start + duration - 1e-9) / e.recordDuration),
    );
  const count = Math.max(0, last - first + 1);
  if (!count) return { times: [], values: [] };
  const buffer = await state.file
    .slice(
      e.headerBytes + first * e.bytesPerRecord,
      e.headerBytes + (last + 1) * e.bytesPerRecord,
    )
    .arrayBuffer();
  if (token !== state.readToken) return null;
  const view = new DataView(buffer),
    times = [],
    values = [],
    scale =
      (signal.physicalMax - signal.physicalMin) /
      (signal.digitalMax - signal.digitalMin || 1),
    offset = signal.physicalMin - signal.digitalMin * scale;
  for (let r = 0; r < count; r++) {
    for (let j = 0; j < signal.samplesPerRecord; j++) {
      const t = (first + r) * e.recordDuration + j / signal.sampleRate;
      if (t >= start && t <= start + duration) {
        const pos = r * e.bytesPerRecord + signal.recordByteOffset + j * 2;
        times.push(t);
        values.push(view.getInt16(pos, true) * scale + offset);
      }
    }
  }
  return { times, values };
}
function fmt(seconds, ms = false) {
  seconds = Math.max(0, seconds || 0);
  const h = Math.floor(seconds / 3600),
    m = Math.floor((seconds % 3600) / 60),
    s = Math.floor(seconds % 60),
    tail = ms
      ? `.${String(Math.floor((seconds % 1) * 1000)).padStart(3, "0")}`
      : "";
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}${tail}`;
}
function getPatientId(patientField) {
  if (!patientField) return null;
  const value = patientField.trim().split(/\s+/)[0];
  if (!value || value === "X") return null;
  return value;
}
function fingerprint() {
  const name = state.sourceFileName || state.file?.name || "recording";
  const size = state.sourceFileSize ?? state.file?.size ?? 0;
  const startDate = state.edf?.startDate ?? "";
  const startTime = state.edf?.startTime ?? "";
  return `neuroscope:${name}:${size}:${startDate}:${startTime}`;
}
function buildRecordingState() {
  return {
    schemaVersion: "2.0",
    exportedAt: new Date().toISOString(),
    recording: {
      fileName: state.file?.name ?? null,
      fileSize: state.file?.size ?? null,
      lastModified: state.file ? new Date(state.file.lastModified).toISOString() : null,
      durationSec: state.edf?.duration ?? null,
      startDate: state.edf?.startDate ?? null,
      startTime: state.edf?.startTime ?? null
    },
    metadata: state.recordingMetadata,
    annotations: state.annotations,
    seizureDetection: {
      status: state.seizureDetectionStatus,
      runAt: state.seizureDetectionRunAt,
      results: state.seizureDetection
    },
    backgroundAnalysis: {
      status: state.backgroundAnalysisStatus,
      runAt: state.backgroundAnalysisRunAt,
      summary: state.backgroundAnalysis?.summary ?? null,
      metrics: state.backgroundAnalysis?.metrics ?? null
    },
    report: {
      generatedAt: state.reportGeneratedAt,
      outOfDate: state.reportOutOfDate
    }
  };
}
function markReportOutOfDate() {
  if (state.reportGeneratedAt) state.reportOutOfDate = true;
}
function saveLocal() {
  if (!state.file || !state.edf) return;
  const recordingState = buildRecordingState();
  localStorage.setItem(fingerprint(), JSON.stringify(recordingState));
  if (window.parent !== window) {
    window.parent.postMessage(
      {
        type: "neuroscope:recording-state",
        state: recordingState
      },
      window.location.origin
    );
  }
}
function restoreRecordingState(saved) {
  state.annotations = saved?.annotations || [];
  state.recordingMetadata = saved?.metadata || null;
  state.seizureDetection = saved?.seizureDetection?.results ?? null;
  state.seizureDetectionStatus = saved?.seizureDetection?.status ?? null;
  state.seizureDetectionRunAt = saved?.seizureDetection?.runAt ?? null;
  if (saved?.backgroundAnalysis) {
    state.backgroundAnalysis = {
      summary: saved.backgroundAnalysis.summary ?? null,
      metrics: saved.backgroundAnalysis.metrics ?? null
    };
    state.backgroundAnalysisStatus = saved.backgroundAnalysis.status ?? null;
    state.backgroundAnalysisRunAt = saved.backgroundAnalysis.runAt ?? null;
  } else {
    state.backgroundAnalysis = null;
    state.backgroundAnalysisStatus = null;
    state.backgroundAnalysisRunAt = null;
  }
  state.reportGeneratedAt = saved?.report?.generatedAt ?? null;
  state.reportOutOfDate = saved?.report?.outOfDate ?? false;
}
function loadLocal() {
  const stored = localStorage.getItem(fingerprint());
  if (!stored) {
    restoreRecordingState(null);
    return;
  }
  try {
    restoreRecordingState(JSON.parse(stored));
  } catch (err) {
    console.error("Could not restore recording state:", err);
    restoreRecordingState(null);
  }
}
function toast(message) {
  const t = $("#toast");
  t.textContent = message;
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), 1800);
}

async function runSeizureDetection() {
  if (!state.file || state.seizureDetectionStatus === "running") return;
  markReportOutOfDate();
  state.seizureDetectionStatus = "running";
  saveLocal();
  renderDetectedSeizures();
  try {
    await ensureAnalysisSession();
    const response = await fetch(`${API_BASE_URL}/seizure-detection/${state.analysisSessionId}`, { method: "POST" });
    if (!response.ok) throw new Error(await response.text());
    const result = await response.json();
    if (result.status !== "completed") throw new Error("Seizure detection failed.");
    state.seizureDetection = result.seizure_detection;
    state.seizureDetectionStatus = "completed";
    state.seizureDetectionRunAt = new Date().toISOString();
    // Successful rerun replaces all previous automated candidates.
    syncAutomatedSeizureAnnotations();
    saveLocal();
    renderDetectedSeizures();
    renderAnnotations();
    draw();
    toast("Seizure detection completed");
  } catch (err) {
    console.error("Seizure detection error:", err);
    state.seizureDetection = null;
    state.seizureDetectionStatus = "failed";
    state.seizureDetectionRunAt = new Date().toISOString();
    // A failed rerun must not leave old model candidates looking current.
    state.annotations = state.annotations.filter((annotation) => annotation.origin !== "automated");
    saveLocal();
    renderDetectedSeizures();
    renderAnnotations();
    draw();
    toast("Seizure detection failed");
  }
}

async function runBackgroundAnalysis() {
  if (!state.file || state.backgroundAnalysisStatus === "running") return;
  markReportOutOfDate();
  state.backgroundAnalysisStatus = "running";
  saveLocal();
  renderBackgroundAnalysisStatus();
  const reportButton = $("#generateReport");
  reportButton.disabled = true;
  reportButton.textContent = "Analysing EEG...";
  try {
    await ensureAnalysisSession();
    const response = await fetch(`${API_BASE_URL}/background-analysis/${state.analysisSessionId}`, { method: "POST" });
    if (!response.ok) throw new Error(await response.text());
    const result = await response.json();
    if (result.status !== "completed") throw new Error(result.detail || "Background analysis failed.");
    state.backgroundAnalysis = result.background_analysis;
    state.backgroundAnalysisStatus = "completed";
    state.backgroundAnalysisRunAt = new Date().toISOString();
    state.recordingMetadata = result.recording_metadata ?? state.recordingMetadata;
    saveLocal();
    renderBackgroundAnalysisStatus();
    reportButton.disabled = false;
    reportButton.textContent = state.reportGeneratedAt && state.reportOutOfDate ? "Regenerate Report" : "Generate Report";
    toast("Background analysis completed");
  } catch (err) {
    console.error("Background analysis error:", err);
    state.backgroundAnalysis = null;
    state.backgroundAnalysisStatus = "failed";
    state.backgroundAnalysisRunAt = new Date().toISOString();
    saveLocal();
    renderBackgroundAnalysisStatus();
    reportButton.disabled = true;
    reportButton.textContent = "Background Analysis Failed";
    toast("Background analysis failed");
  }
}

async function openFile(file, restoredState = null, analysisSourceUrl = null) {
  try {
    const reportButton = $("#generateReport");
    reportButton.disabled = true;
    reportButton.textContent = "Loading EEG...";
    $("#emptyState").classList.add("hidden");
    $("#workspace").classList.remove("hidden");
    $("#loading").classList.remove("hidden");
    const uploadedFile = file;
    state.sourceFileName = uploadedFile.name;
    state.sourceFileSize = uploadedFile.size;
    const isNicolet = /\.e$/i.test(file.name);
    state.seizureDetection = null;
    state.seizureDetectionStatus = null;
    state.analysisSessionId = null;
    state.analysisSourceUrl = analysisSourceUrl;
    state.recordingMetadata = null;
    let uploadResult = null;
    // Nicolet .e files must be converted before the viewer can parse them.
    if (isNicolet) {
      uploadResult = await createAnalysisSession(uploadedFile);
      state.analysisSessionId = uploadResult.session_id;
      file = await fetchSessionEDF(state.analysisSessionId, uploadResult.edf_filename);
    }
    state.file = file;
    state.edf = await parseEDF(file);
    reportButton.disabled = true;
    reportButton.textContent = "Analysing EEG...";
    state.start = 0;
    state.selection = null;
    const usable = state.edf.signals.filter(
      (s) => s.samplesPerRecord > 0 && !/annotation/i.test(s.label),
    );
    state.channels = usable
      .slice(0, Math.min(24, usable.length))
      .map((s) => s.index);
    if (restoredState) {
      restoreRecordingState(restoredState);
    } else {
      loadLocal();
    }
    ensureAutomatedSeizureAnnotations();
    if (uploadResult?.recording_metadata) {
      state.recordingMetadata = uploadResult.recording_metadata;
      saveLocal();
    }
    const hasStoredSeizureState = state.seizureDetectionStatus === "completed" || state.seizureDetectionStatus === "failed";
    const hasStoredBackgroundState = state.backgroundAnalysisStatus === "completed" || state.backgroundAnalysisStatus === "failed";
    if (hasStoredBackgroundState) {
      if (state.backgroundAnalysisStatus === "completed") {
        reportButton.disabled = false;
        reportButton.textContent = state.reportGeneratedAt ? "Regenerate Report" : "Generate Report";
      } else {
        reportButton.disabled = true;
        reportButton.textContent = "Background Analysis Failed";
      }
    }
    renderChannelList();
    renderAnnotations();
    renderDetectedSeizures();
    renderBackgroundAnalysisStatus();
    const edfPatientId = getPatientId(state.edf.patient);
    const nicolet = state.recordingMetadata?.nicolet || {};
    const patient = nicolet.patient || {};
    const study = nicolet.study?.mapped || {};
    const patientId = patient.altID || state.recordingMetadata?.patient_id || edfPatientId;
    const testId = study.test_id || null;
    const identifiers = [
      patientId ? `Patient ID: ${patientId}` : null,
      testId ? `Test ID: ${testId}` : null
    ].filter(Boolean);
    const details = [
      `${usable.length}\u00A0channels`,
      fmt(state.edf.duration),
      `${(file.size / 1073741824).toFixed(2)}\u00A0GB`
    ];
    if (!identifiers.length) { details.unshift(file.name); }
    $("#fileMeta").textContent = [...identifiers, details.join(" · ")].join("\n");
    $("#duration").textContent = `/ ${fmt(state.edf.duration)}`;
    $("#timelineEnd").textContent = fmt(state.edf.duration);
    $("#exportButton").disabled = false;
    await render();
    // Run seizure detection separately so it does not block the EDF viewer
    // Create an analysis session if not already created for this recording
    const shouldRunSeizure = !hasStoredSeizureState;
    const shouldRunBackground = !hasStoredBackgroundState;
    try {
      if (shouldRunSeizure) await runSeizureDetection();
      if (shouldRunBackground) await runBackgroundAnalysis();
    } catch (err) {
      console.error("EEG analysis error:", err);
    }
  } catch (err) {
    $("#emptyState").classList.remove("hidden");
    $("#workspace").classList.add("hidden");
    alert(err.message);
  } finally {
    $("#loading").classList.add("hidden");
  }
}
function renderChannelList(filter = "") {
  const box = $("#channelList"),
    q = filter.toLowerCase();
  box.innerHTML = "";
  state.edf.signals
    .filter(
      (s) =>
        s.samplesPerRecord &&
        !/annotation/i.test(s.label) &&
        s.label.toLowerCase().includes(q),
    )
    .forEach((s) => {
      const label = document.createElement("label");
      label.className = "channel";
      label.innerHTML = `<input type="checkbox" ${state.channels.includes(s.index) ? "checked" : ""}><span class="channel-name" title="${s.label}">${s.label}</span><span class="channel-rate">${s.sampleRate} Hz</span>`;
      label.querySelector("input").onchange = (e) => {
        state.channels = e.target.checked
          ? [...state.channels, s.index]
          : state.channels.filter((x) => x !== s.index);
        render();
      };
      box.append(label);
    });
}
async function render() {
  if (!state.edf) return;
  state.start = Math.max(
    0,
    Math.min(state.start, Math.max(0, state.edf.duration - state.window)),
  );
  const token = ++state.readToken;
  $("#loading").classList.remove("hidden");
  $("#currentTime").textContent = fmt(state.start, true);
  $("#scrubber").value =
    state.edf.duration <= state.window
      ? 0
      : Math.round((state.start / (state.edf.duration - state.window)) * 1000);
  clearSelection();
  const signals = state.channels.map((i) => state.edf.signals[i]);
  try {
    const data = await Promise.all(
      signals.map((s) => readSignalWindow(s, state.start, state.window, token)),
    );
    if (token !== state.readToken) return;
    state.data = data;
    draw();
  } finally {
    if (token === state.readToken) $("#loading").classList.add("hidden");
  }
}
function draw() {
  const canvas = $("#eegCanvas"),
    rect = canvas.getBoundingClientRect(),
    dpr = devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const c = canvas.getContext("2d");
  c.scale(dpr, dpr);
  const w = rect.width,
    h = rect.height,
    left = 72,
    top = 18,
    right = 12,
    bottom = 28,
    pw = w - left - right,
    ph = h - top - bottom;
  c.fillStyle = "#fbfcfa";
  c.fillRect(0, 0, w, h);
  c.font = "9px JetBrains Mono";
  c.textAlign = "center";
  c.strokeStyle = "#e4eae7";
  c.lineWidth = 1;
  for (let sec = 0; sec <= state.window; sec++) {
    const x = left + (sec / state.window) * pw;
    c.beginPath();
    c.moveTo(x, top);
    c.lineTo(x, h - bottom);
    c.stroke();
    c.fillStyle = "#7b8985";
    c.fillText(`${(state.start + sec).toFixed(0)}s`, x, h - 9);
  }
  if (!state.data.length) {
    c.fillStyle = "#6d7c78";
    c.font = "13px DM Sans";
    c.fillText("Select one or more channels to display", w / 2, h / 2);
    return;
  }
  const row = ph / state.data.length;
  state.data.forEach((d, i) => {
    const sig = state.edf.signals[state.channels[i]],
      mid = top + row * (i + 0.5);
    c.strokeStyle = "#dce4e0";
    c.beginPath();
    c.moveTo(left, mid);
    c.lineTo(w - right, mid);
    c.stroke();
    c.fillStyle = "#40534f";
    c.textAlign = "right";
    c.font = "10px JetBrains Mono";
    c.fillText(sig.label, left - 8, mid + 3);
    if (!d?.values.length) return;
    const sorted = [...d.values].sort((a, b) => a - b),
      p05 = sorted[Math.floor(sorted.length * 0.05)],
      p95 = sorted[Math.floor(sorted.length * 0.95)],
      amp = Math.max(Math.abs(p95 - p05) / 2, 1e-6) / state.gain,
      center = (p05 + p95) / 2;
    c.strokeStyle = "#176b59";
    c.lineWidth = 1;
    c.beginPath();
    let lastX = -1,
      lastY = 0;
    for (let j = 0; j < d.values.length; j++) {
      const x = left + ((d.times[j] - state.start) / state.window) * pw,
        y =
          mid -
          Math.max(
            -row * 0.43,
            Math.min(row * 0.43, ((d.values[j] - center) / amp) * row * 0.35),
          );
      if (x - lastX < 0.6 && j < d.values.length - 1) {
        lastY = y;
        continue;
      }
      if (lastX < 0) c.moveTo(x, y);
      else c.lineTo(x, lastY || y);
      lastX = x;
      lastY = y;
    }
    c.stroke();
  });
  drawAnnotations(c, left, top, pw, ph);
}
function drawAnnotations(c, left, top, pw, ph) {
  state.annotations
    .filter((a) => !(a.origin === "automated" && a.rejected))
    .filter(
      (a) =>
        a.endSec >= state.start && a.startSec <= state.start + state.window,
    )
    .forEach((a) => {
      const x1 =
          left +
          ((Math.max(a.startSec, state.start) - state.start) / state.window) *
            pw,
        x2 =
          left +
          ((Math.min(a.endSec, state.start + state.window) - state.start) /
            state.window) *
            pw;
      c.fillStyle = (colors[a.label] || colors.Other) + "25";
      c.fillRect(x1, top, Math.max(2, x2 - x1), ph);
      c.fillStyle = colors[a.label] || colors.Other;
      c.fillRect(x1, top, 3, ph);
      c.font = "9px DM Sans";
      c.textAlign = "left";
      const displayLabel = a.origin === "automated" ? "Seizure candidate" : a.label;
      c.fillText(displayLabel, x1 + 5, top + 11);
    });
}
function clearSelection() {
  state.selection = null;
  $("#selection").classList.add("hidden");
  $("#newAnnotation").disabled = true;
}
function setSelection(a, b) {
  const rect = $("#plotWrap").getBoundingClientRect(),
    left = 72,
    right = 12,
    lo = Math.max(left, Math.min(a, b)),
    hi = Math.min(rect.width - right, Math.max(a, b));
  if (hi - lo < 3) {
    clearSelection();
    return;
  }
  const start =
      state.start + ((lo - left) / (rect.width - left - right)) * state.window,
    end =
      state.start + ((hi - left) / (rect.width - left - right)) * state.window;
  state.selection = { startSec: start, endSec: end };
  const el = $("#selection");
  el.style.left = `${lo}px`;
  el.style.width = `${hi - lo}px`;
  el.classList.remove("hidden");
  $("#selectionLabel").textContent = `${(end - start).toFixed(2)}s`;
  $("#newAnnotation").disabled = false;
}
function syncAutomatedSeizureAnnotations() {
  const seizures = state.seizureDetection?.seizures || [];
  // A fresh detection run replaces the previous automated candidates.
  state.annotations = state.annotations.filter(
    (annotation) => annotation.origin !== "automated"
  );
  const runAt = state.seizureDetectionRunAt || new Date().toISOString();
  seizures.forEach((seizure, index) => {
    const startSec = seizure.start_time ?? seizure.start_seconds;
    const endSec = seizure.end_time ?? seizure.end_seconds;
    if (startSec == null || endSec == null) return;
    state.annotations.push({
      id: `automated-seizure-${runAt}-${index}`,
      startSec,
      endSec,
      label: "Seizure",
      notes: "",
      channels: [],
      origin: "automated",
      rejected: false,
      model: {
        meanProbability: seizure.mean_probability ?? null,
        maxProbability: seizure.max_probability ?? null,
        durationSeconds: seizure.duration ?? seizure.duration_seconds ?? (endSec - startSec),
      },
      createdAt: runAt,
      updatedAt: runAt
    });
  });
  state.annotations.sort((a, b) => a.startSec - b.startSec);
}
function ensureAutomatedSeizureAnnotations() {
  const hasAutomated = state.annotations.some(
    (annotation) => annotation.origin === "automated"
  );
  if (
    !hasAutomated &&
    state.seizureDetectionStatus === "completed" &&
    (state.seizureDetection?.seizures || []).length
  ) {
    syncAutomatedSeizureAnnotations();
  }
}
function renderDetectedSeizures() {
  let section = $("#detectedSeizures");
  if (!section) {
    section = document.createElement("div");
    section.id = "detectedSeizures";
    const annotationList = $("#annotationList");
    annotationList.parentElement.insertBefore(section, annotationList);
  }
  const status = state.seizureDetectionStatus;
  if (!status) {
    section.innerHTML = "";
    return;
  }
  if (status === "running") {
    section.innerHTML = `
      <div class="analysis-status-row">
        <span>Seizure detection in progress...</span>
      </div>
    `;
    return;
  }
  if (status === "failed") {
    section.innerHTML = `
      <div class="analysis-status-row">
        <span>Seizure detection failed.</span>
        <button id="retrySeizureDetection" class="analysis-action-button">
          Retry
        </button>
      </div>
    `;
    $("#retrySeizureDetection").onclick = runSeizureDetection;
    return;
  }
  section.innerHTML = `
    <div class="analysis-status-row">
      <span>Seizure detection completed.</span>
      <button id="rerunSeizureDetection" class="analysis-action-button">
        Re-run
      </button>
    </div>
  `;
  $("#rerunSeizureDetection").onclick = runSeizureDetection;
}
function renderBackgroundAnalysisStatus() {
  let section = $("#backgroundAnalysisStatus");
  if (!section) {
    section = document.createElement("div");
    section.id = "backgroundAnalysisStatus";
    const detectedSeizures = $("#detectedSeizures");
    const annotationList = $("#annotationList");
    if (detectedSeizures) {
      detectedSeizures.parentElement.insertBefore(section, detectedSeizures);
    } else {
      annotationList.parentElement.insertBefore(section, annotationList);
    }
  }
  const status = state.backgroundAnalysisStatus;
  if (!status) {
    section.innerHTML = "";
    return;
  }
  if (status === "running") {
    section.innerHTML = `
      <div class="analysis-status-row">
        <span>Background analysis in progress...</span>
      </div>
    `;
    return;
  }
  if (status === "failed") {
    section.innerHTML = `
      <div class="analysis-status-row">
        <span>Background analysis failed.</span>
        <button id="retryBackgroundAnalysis" class="analysis-action-button">
          Retry
        </button>
      </div>
    `;
    $("#retryBackgroundAnalysis").onclick = runBackgroundAnalysis;
    return;
  }
  section.innerHTML = `
    <div class="analysis-status-row">
      <span>Background analysis completed.</span>
      <button id="rerunBackgroundAnalysis" class="analysis-action-button">
        Re-run
      </button>
    </div>
  `;
  $("#rerunBackgroundAnalysis").onclick = runBackgroundAnalysis;
}
function renderAnnotations() {
  const box = $("#annotationList");
  const annotations = state.annotations
    .filter((annotation) => !(annotation.origin === "automated" && annotation.rejected))
    .sort((a, b) => a.startSec - b.startSec);
  $("#annotationCount").textContent = annotations.length;
  if (!annotations.length) {
    box.innerHTML = '<div class="aside-empty">Select a region of the waveform to add a clinical annotation.</div>';
    return;
  }
  box.innerHTML = "";
  annotations.forEach((a) => {
    const origin = a.origin || "reviewer";
    const automated = origin === "automated";
    const el = document.createElement("div");
    el.className = "annotation";
    el.style.borderLeftColor = colors[a.label] || colors.Other;
    el.innerHTML = `
      <div class="annotation-top">
        <span class="annotation-label"></span>
        <span class="annotation-actions">
          ${automated ? "" : '<button class="mini edit" title="Edit">✎</button>'}
          <button class="mini delete" title="${automated ? "Reject" : "Delete"}">×</button>
        </span>
      </div>
      <div class="annotation-time">
        ${fmt(a.startSec, true)} — ${fmt(a.endSec, true)}
      </div>
      <div class="annotation-note"></div>
    `;
    el.querySelector(".annotation-label").textContent = automated ? "Seizure candidate" : a.label;
    if (automated) {
      const mean = a.model?.meanProbability;
      const max = a.model?.maxProbability;
      const details = [
        mean != null ? `Mean probability: ${(Number(mean) * 100).toFixed(1)}%` : null,
        max != null ? `Max probability: ${(Number(max) * 100).toFixed(1)}%` : null
      ].filter(Boolean);
      const note = el.querySelector(".annotation-note");
      note.textContent = details.join("\n");
      note.style.whiteSpace = "pre-line";
    } else {
      el.querySelector(".annotation-note").textContent = a.notes || "No notes";
    }
    el.onclick = () => {
      state.start = Math.max(0, a.startSec - state.window * 0.15);
      render();
    };
    const editButton = el.querySelector(".edit");
    if (editButton) {
      editButton.onclick = (e) => {
        e.stopPropagation();
        openAnnotationDialog(a);
      };
    }
    el.querySelector(".delete").onclick = (e) => {
      e.stopPropagation();
      if (automated) {
        if (!confirm("Reject this automated seizure candidate?")) return;
        state.annotations = state.annotations.map((annotation) => 
          annotation.id === a.id
            ? {
                ...annotation,
                rejected: true,
                updatedAt: new Date().toISOString()
              }
            : annotation
        );
        markReportOutOfDate();
        saveLocal();
        renderAnnotations();
        draw();
        toast("Seizure candidate rejected");
        return;
      }
      if (confirm(`Delete this reviewer annotation?`)) {
        state.annotations = state.annotations.filter((x) => x.id !== a.id);
        markReportOutOfDate();
        saveLocal();
        renderAnnotations();
        draw();
        toast("Reviewer annotation deleted");
      }
    };
    box.append(el);
  })
}
function buildReportSeizureDetection() {
  if (!state.seizureDetection) return null;
  const candidates = state.annotations.filter(
    (annotation) => annotation.origin === "automated" && !annotation.rejected
  );
  return {
    ...state.seizureDetection,
    seizure_count: candidates.length,
    seizures: candidates.map((annotation) => ({
      start_time: annotation.startSec,
      end_time: annotation.endSec,
      duration: annotation.model?.durationSeconds ?? (annotation.endSec - annotation.startSec),
      mean_probability: annotation.model?.meanProbability ?? null,
      max_probability: annotation.model?.maxProbability ?? null
    }))
  };
}
function openAnnotationDialog(annotation = null) {
  const range = annotation || state.selection;
  if (!range) return;
  state.editing = annotation?.id || null;
  $("#dialogTitle").textContent = annotation
    ? "Edit annotation"
    : "New annotation";
  $("#dialogRange").textContent =
    `${fmt(range.startSec, true)} — ${fmt(range.endSec, true)} (${(range.endSec - range.startSec).toFixed(3)} sec)`;
  $("#annotationLabel").value = annotation?.label || "Seizure";
  $("#annotationNotes").value = annotation?.notes || "";
  $("#annotationChannels").value = (
    annotation?.channels ||
    state.channels.map((i) => state.edf.signals[i].label)
  ).join(", ");
  $("#annotationDialog").showModal();
}

$("#edfInput").onchange = (e) =>
  e.target.files[0] && openFile(e.target.files[0]);
$("#channelSearch").oninput = (e) => renderChannelList(e.target.value);
$("#windowSize").onchange = (e) => {
  state.window = Number(e.target.value);
  render();
};
$("#gain").onchange = (e) => {
  state.gain = Number(e.target.value);
  draw();
};
$("#backButton").onclick = () => {
  state.start -= state.window * 0.8;
  render();
};
$("#forwardButton").onclick = () => {
  state.start += state.window * 0.8;
  render();
};
$("#fitButton").onclick = () => {
  state.gain = 1;
  $("#gain").value = "1";
  draw();
};
$("#scrubber").oninput = (e) => {
  state.start =
    (Number(e.target.value) / 1000) *
    Math.max(0, state.edf.duration - state.window);
  render();
};
$("#newAnnotation").onclick = () => openAnnotationDialog();
$("#toggleAll").onclick = () => {
  const usable = state.edf.signals.filter(
    (s) => s.samplesPerRecord && !/annotation/i.test(s.label),
  );
  state.channels = state.channels.length
    ? []
    : usable.slice(0, 24).map((s) => s.index);
  renderChannelList($("#channelSearch").value);
  render();
};
$("#playButton").onclick = () => {
  if (state.playing) {
    clearInterval(state.playing);
    state.playing = null;
    $("#playButton").textContent = "▶";
  } else {
    state.playing = setInterval(() => {
      state.start += state.window * 0.2;
      if (state.start >= state.edf.duration - state.window) {
        clearInterval(state.playing);
        state.playing = null;
        $("#playButton").textContent = "▶";
      }
      render();
    }, 1000);
    $("#playButton").textContent = "❚❚";
  }
};
const plot = $("#plotWrap");
let drag = null;
plot.onpointerdown = (e) => {
  drag = e.clientX - plot.getBoundingClientRect().left;
  plot.setPointerCapture(e.pointerId);
};
plot.onpointermove = (e) => {
  if (drag !== null)
    setSelection(drag, e.clientX - plot.getBoundingClientRect().left);
};
plot.onpointerup = () => {
  drag = null;
};
plot.onwheel = (e) => {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) {
    const options = [5, 10, 20, 30, 60],
      i = options.indexOf(state.window),
      next =
        options[
          Math.max(0, Math.min(options.length - 1, i + (e.deltaY > 0 ? 1 : -1)))
        ];
    state.window = next;
    $("#windowSize").value = next;
  } else state.start += Math.sign(e.deltaY) * state.window * 0.25;
  render();
};
$("#saveAnnotation").onclick = (e) => {
  e.preventDefault();
  const range = state.editing
    ? state.annotations.find((a) => a.id === state.editing)
    : state.selection;
  if (!range) return;
  const item = {
    id: state.editing || crypto.randomUUID(),
    startSec: range.startSec,
    endSec: range.endSec,
    label: $("#annotationLabel").value,
    notes: $("#annotationNotes").value.trim(),
    channels: $("#annotationChannels")
      .value.split(",")
      .map((x) => x.trim())
      .filter(Boolean),
    origin: range.origin || "reviewer",
    author: "",
    createdAt: range.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (state.editing)
    state.annotations = state.annotations.map((a) =>
      a.id === state.editing ? item : a,
    );
  else state.annotations.push(item);
  markReportOutOfDate();
  saveLocal();
  renderAnnotations();
  draw();
  $("#annotationDialog").close();
  clearSelection();
  toast(state.editing ? "Annotation updated" : "Annotation saved");
};
$("#exportButton").onclick = () => {
  const payload = buildRecordingState();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${state.file.name.replace(/\.edf$/i, "")}.recording-state.json`;
  a.click();
  URL.revokeObjectURL(a.href);
};
$("#generateReport").onclick = async () => {
  if (!state.file) return;
  const button = $("#generateReport");
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Generating...";
  toast("Generating report...");
  const annotationResults = {
    schemaVersion: "1.0",
    exportedAt: new Date().toISOString(),
    recording: {
      fileName: state.file.name,
      fileSize: state.file.size,
      lastModified: new Date(state.file.lastModified).toISOString(),
      durationSec: state.edf.duration,
      startDate: state.edf.startDate,
      startTime: state.edf.startTime,
    },
    annotations: state.annotations.filter(
      (annotation) => annotation.origin !== "automated"
    )
  };
  try {
    await ensureAnalysisSession();
    const formData = new FormData();
    formData.append("session_id", state.analysisSessionId);
    formData.append("seizure_results_json", JSON.stringify(buildReportSeizureDetection()));
    formData.append("annotation_results_json", JSON.stringify(annotationResults));
    formData.append("seizure_detection_status", state.seizureDetectionStatus);
    const response = await fetch(`${API_BASE_URL}/report`, {
      method: "POST",
      body: formData,
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || "Report generation failed.");
    }
    const pdfBlob = await response.blob();
    const reportName = `${state.file.name.replace(/\.edf$/i, "")}_report.pdf`;
    if (window.parent !== window) {
      window.parent.postMessage(
        {
          type: "seizureai:report-generated",
          blob: pdfBlob,
          name: reportName,
        },
        window.location.origin,
      );
    } else {
      const url = URL.createObjectURL(pdfBlob);
      const link = document.createElement("a");
      link.href = url;
      link.download = reportName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    }
    state.reportGeneratedAt = new Date().toISOString();
    state.reportOutOfDate = false;
    saveLocal();
    toast("Report generated");
  } catch (err) {
    console.error("Report generation error:", err);
    alert(err.message || "Could not generate report.");
  } finally {
    button.disabled = false;
    button.textContent = state.reportGeneratedAt ? "Regenerate Report" : "Generate Report";
  }
};
$("#importButton").onclick = () => $("#annotationInput").click();
$("#annotationInput").onchange = async (e) => {
  try {
    const file = e.target.files[0];
    if (!file) return;
    const json = JSON.parse(await file.text());
    if (!Array.isArray(json.annotations)) {
      throw new Error("Recording state does not contain annotations.");
    }
    if (json.recording?.fileName && json.recording.fileName !== state.file.name) {
      throw new Error("This recording state belongs to a different EEG file.");
    }
    state.annotations = json.annotations;
    state.recordingMetadata = json.metadata ?? null;
    if (json.seizureDetection?.results !== undefined) {
      state.seizureDetection = json.seizureDetection.results;
      state.seizureDetectionStatus = json.seizureDetection.status ?? null;
      state.seizureDetectionRunAt = json.seizureDetection.runAt ?? null;
    } else {
      // Backwards compatibility with old schema 1.0 exports.
      state.seizureDetection = json.seizureDetection ?? null;
      state.seizureDetectionStatus = json.seizureDetection ? "completed" : null;
    }
    if (json.backgroundAnalysis) {
      state.backgroundAnalysis = {
        summary: json.backgroundAnalysis.summary ?? null,
        metrics: json.backgroundAnalysis.metrics ?? null
      };
      state.backgroundAnalysisStatus = json.backgroundAnalysis.status ?? null;
      state.backgroundAnalysisRunAt = json.backgroundAnalysis.runAt ?? null;
    }
    state.reportGeneratedAt = json.report?.generatedAt ?? null;
    state.reportOutOfDate = json.report?.outOfDate ?? false;
    ensureAutomatedSeizureAnnotations();
    saveLocal();
    renderAnnotations();
    renderDetectedSeizures();
    draw();
    toast("Recording state imported");
  } catch (err) {
    alert(err.message || "Invalid recording-state JSON file.");
  } finally {
    e.target.value = "";
  }
};
window.onresize = () => state.edf && draw();
document.addEventListener("keydown", (e) => {
  if (!state.edf || $("#annotationDialog").open) return;
  if (e.key === "ArrowLeft") {
    state.start -= state.window * 0.25;
    render();
  }
  if (e.key === "ArrowRight") {
    state.start += state.window * 0.25;
    render();
  }
  if (e.key === "a" && state.selection) openAnnotationDialog();
});

window.addEventListener("message", async (event) => {
  if (event.origin !== window.location.origin) return;
  if (event.data?.type === "seizureai:theme") {
    document.body.classList.toggle("dark-mode", event.data.dark);
    if (state.edf) draw();
    return;
  }
  if (event.data?.type !== "neuroscope:open-edf") return;
  try {
    $("#emptyState").classList.add("hidden");
    $("#workspace").classList.remove("hidden");
    $("#loading").classList.remove("hidden");
    const reportButton = $("#generateReport");
    reportButton.disabled = true;
    reportButton.textContent = "Loading EEG...";
    const response = await fetch(event.data.url);
    if (!response.ok)
      throw new Error("The saved EDF file could not be downloaded.");
    const blob = await response.blob();
    const file = new File([blob], event.data.name || "recording.edf", {
      type: "application/octet-stream",
      lastModified: Date.now(),
    });
    await openFile(file, event.data.recordingState ?? null, event.data.url ?? null);
  } catch (err) {
    $("#emptyState").classList.remove("hidden");
    $("#workspace").classList.add("hidden");
    alert(err.message || "Could not open the saved EDF file.");
  } finally {
    $("#loading").classList.add("hidden");
  }
});

window.parent.postMessage(
  { type: "seizureai:viewer-ready" },
  window.location.origin,
);
