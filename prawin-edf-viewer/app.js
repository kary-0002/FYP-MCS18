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
function fingerprint() {
  return `neuroscope:${state.file.name}:${state.file.size}:${state.file.lastModified}`;
}
function saveLocal() {}
function loadLocal() {
  state.annotations = [];
}
function toast(message) {
  const t = $("#toast");
  t.textContent = message;
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), 1800);
}

async function openFile(file) {
  try {
    $("#emptyState").classList.add("hidden");
    $("#workspace").classList.remove("hidden");
    $("#loading").classList.remove("hidden");
    state.file = file;
    state.edf = await parseEDF(file);

    // Run seizure detection separately so it does not block the EDF viewer
    try {
      const formData = new FormData();
      formData.append("veeg", file);

      const response = await fetch("http://127.0.0.1:8000/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Seizure detection failed:", errorText);
      } else {
        const detectionResult = await response.json();
        state.seizureDetection = detectionResult;
        console.log("Seizure detection result:", detectionResult);
      }
    } catch (err) {
      console.error("Seizure detection error:", err);
    }

    state.start = 0;
    state.selection = null;
    const usable = state.edf.signals.filter(
      (s) => s.samplesPerRecord > 0 && !/annotation/i.test(s.label),
    );
    state.channels = usable
      .slice(0, Math.min(24, usable.length))
      .map((s) => s.index);
    loadLocal();
    renderChannelList();
    renderAnnotations();
    $("#fileMeta").textContent =
      `${file.name} · ${usable.length} signals · ${fmt(state.edf.duration)} · ${(file.size / 1073741824).toFixed(2)} GB`;
    $("#duration").textContent = `/ ${fmt(state.edf.duration)}`;
    $("#timelineEnd").textContent = fmt(state.edf.duration);
    $("#exportButton").disabled = false;
    await render();
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
      c.fillText(a.label, x1 + 5, top + 11);
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
function renderAnnotations() {
  const box = $("#annotationList");
  $("#annotationCount").textContent = state.annotations.length;
  if (!state.annotations.length) {
    box.innerHTML =
      '<div class="aside-empty">Select a region of the waveform to add a clinical annotation.</div>';
    return;
  }
  box.innerHTML = "";
  [...state.annotations]
    .sort((a, b) => a.startSec - b.startSec)
    .forEach((a) => {
      const el = document.createElement("div");
      el.className = "annotation";
      el.style.borderLeftColor = colors[a.label] || colors.Other;
      el.innerHTML = `<div class="annotation-top"><span class="annotation-label"></span><span class="annotation-actions"><button class="mini edit" title="Edit">✎</button><button class="mini delete" title="Delete">×</button></span></div><div class="annotation-time">${fmt(a.startSec, true)} — ${fmt(a.endSec, true)}</div><div class="annotation-note"></div>`;
      el.querySelector(".annotation-label").textContent = a.label;
      el.querySelector(".annotation-note").textContent = a.notes || "No notes";
      el.onclick = () => {
        state.start = Math.max(0, a.startSec - state.window * 0.15);
        render();
      };
      el.querySelector(".edit").onclick = (e) => {
        e.stopPropagation();
        openAnnotationDialog(a);
      };
      el.querySelector(".delete").onclick = (e) => {
        e.stopPropagation();
        if (confirm(`Delete “${a.label}” annotation?`)) {
          state.annotations = state.annotations.filter((x) => x.id !== a.id);
          saveLocal();
          renderAnnotations();
          draw();
          toast("Annotation deleted");
        }
      };
      box.append(el);
    });
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
    author: "",
    createdAt: range.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (state.editing)
    state.annotations = state.annotations.map((a) =>
      a.id === state.editing ? item : a,
    );
  else state.annotations.push(item);
  saveLocal();
  renderAnnotations();
  draw();
  $("#annotationDialog").close();
  clearSelection();
  toast(state.editing ? "Annotation updated" : "Annotation saved");
};
$("#exportButton").onclick = () => {
  const payload = {
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
    annotations: state.annotations,
    seizureDetection: state.seizureDetection,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    }),
    a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${state.file.name.replace(/\.edf$/i, "")}.annotations.json`;
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
    annotations: state.annotations,
  };
  const formData = new FormData();
  formData.append("veeg", state.file);
  formData.append("seizure_results_json", JSON.stringify(state.seizureDetection));
  formData.append("annotation_results_json", JSON.stringify(annotationResults));
  try {
    const response = await fetch("http://127.0.0.1:8000/report", {
      method: "POST",
      body: formData,
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || "Report generation failed.");
    }
    const pdfBlob = await response.blob();
    const url = URL.createObjectURL(pdfBlob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${state.file.name.replace(/\.edf$/i, "")}_report.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast("Report generated");
  } catch (err) {
    console.error("Report generation error:", err);
    alert(err.message || "Could not generate report.");
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
};
$("#importButton").onclick = () => $("#annotationInput").click();
$("#annotationInput").onchange = async (e) => {
  try {
    const json = JSON.parse(await e.target.files[0].text());
    if (!Array.isArray(json.annotations)) throw new Error();
    state.annotations = json.annotations;
    saveLocal();
    renderAnnotations();
    draw();
    toast(`Imported ${state.annotations.length} annotations`);
  } catch {
    alert(
      "Invalid annotation JSON file. Expected an object with an annotations array.",
    );
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
    const response = await fetch(event.data.url);
    if (!response.ok)
      throw new Error("The saved EDF file could not be downloaded.");
    const blob = await response.blob();
    const file = new File([blob], event.data.name || "recording.edf", {
      type: "application/octet-stream",
      lastModified: Date.now(),
    });
    await openFile(file);
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
