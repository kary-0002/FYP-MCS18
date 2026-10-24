"use client";
import { useEffect, useRef, useState } from "react";
import type {
  Annotation,
  Channel,
  Recording,
  WindowData,
} from "@/lib/neuroscope/types";
import { readChannel } from "@/lib/neuroscope/edf";

const ANNOTATION_COLORS: Record<string, string> = {
  Seizure: "#d75a54",
  Spike: "#e69536",
  Artifact: "#8d78bc",
  "Eye movement": "#5797c7",
  "Sleep event": "#248b78",
  "Technical issue": "#7b8582",
  Other: "#bd7a9c",
};

function getTimeTickStep(windowSeconds: number, plotWidth: number) {
  const targetTicks = Math.max(2, Math.floor(plotWidth / 85));
  const roughStep = windowSeconds / targetTicks;
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(roughStep, 1)));
  const normalized = roughStep / magnitude;
  const nice =
    normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return nice * magnitude;
}

export function UploadScreen({ onFile }: { onFile: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <section className="empty-state">
      <div className="upload-panel">
        <div className="signal-icon">
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>
        <span className="eyebrow">EEG signal review</span>
        <h1>Open an EEG recording</h1>
        <p>
          Choose an EDF or Nicolet .e recording to view its channels and create
          annotations.
        </p>
        <button
          className="button primary large"
          onClick={() => input.current?.click()}
        >
          Choose an EEG file
        </button>
        <input
          ref={input}
          hidden
          type="file"
          accept=".edf,.e,application/octet-stream"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) onFile(file);
          }}
        />
      </div>
      <div className="compatibility">
        <span>✓ EDF</span>
        <span>✓ Nicolet .e</span>
        <span>✓ Siena Scalp EEG</span>
      </div>
    </section>
  );
}

export function ViewerLoadingScreen({
  fileName,
  message,
}: {
  fileName: string;
  message: string;
}) {
  return (
    <main className="viewer-loading-screen" aria-live="polite">
      <section className="viewer-loading-card">
        <div className="loading-spinner" aria-hidden="true" />
        <span className="eyebrow">EEG signal review</span>
        <h1>{message}</h1>
        <p>{fileName}</p>
        <div className="loading-progress-track">
          <span />
        </div>
        <small>Large recordings can take a little while to prepare.</small>
      </section>
    </main>
  );
}

export function ChannelSidebar({
  channels,
  selected,
  onToggle,
  onToggleGroup,
  onToggleAll,
  recording,
  filter,
  onFilter,
}: {
  channels: Channel[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleGroup: (ids: string[]) => void;
  onToggleAll: () => void;
  recording: Recording;
  filter: string;
  onFilter: (v: string) => void;
}) {
  const filtered = channels.filter((c) =>
    c.label.toLowerCase().includes(filter.toLowerCase()),
  );
  const groups = Array.from(new Set(filtered.map((c) => c.group)));
  return (
    <aside className="sidebar">
      <div className="side-heading">
        <div>
          <span className="eyebrow">Signals</span>
          <h2>Channels</h2>
        </div>
        <button
          className="icon-button"
          title="Toggle all"
          onClick={onToggleAll}
        >
          ✓
        </button>
      </div>
      <div className="recording-meta">
        {recording.patient || "Recording"}
        <br />
        {channels.length} channels · {formatTime(recording.duration)}
      </div>
      <label className="search">
        <span>⌕</span>
        <input
          value={filter}
          onChange={(e) => onFilter(e.target.value)}
          placeholder="Filter channels"
        />
      </label>
      <div className="channel-list">
        {groups.map((group) => {
          const groupChannels = filtered.filter((c) => c.group === group);
          const selectedCount = groupChannels.filter((c) =>
            selected.has(c.id),
          ).length;
          return (
            <details className="channel-group" key={group} open>
              <summary className="channel-group-heading">
                <input
                  type="checkbox"
                  readOnly
                  aria-label={`Select all ${group} channels`}
                  checked={
                    groupChannels.length > 0 &&
                    selectedCount === groupChannels.length
                  }
                  ref={(element) => {
                    if (element)
                      element.indeterminate =
                        selectedCount > 0 &&
                        selectedCount < groupChannels.length;
                  }}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onToggleGroup(groupChannels.map((c) => c.id));
                  }}
                />
                {group} ({groupChannels.length})
              </summary>
              {groupChannels.map((c) => (
                <label
                  className="channel"
                  key={c.id}
                  style={{ "--channel-color": c.color } as React.CSSProperties}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(c.id)}
                    onChange={() => onToggle(c.id)}
                  />
                  <span className="channel-swatch" />
                  <span className="channel-name">{c.label}</span>
                  <span className="channel-rate">
                    {(c.signal || c.left)?.sampleRate} Hz
                  </span>
                </label>
              ))}
            </details>
          );
        })}
      </div>
    </aside>
  );
}

export function Waveform({
  file,
  recording,
  selected,
  start,
  duration,
  gain,
  annotations,
  selection,
  onSeek,
  onZoom,
  onSelect,
}: {
  file: File;
  recording: Recording;
  selected: Channel[];
  start: number;
  duration: number;
  gain: number;
  annotations: Annotation[];
  selection: { startSec: number; endSec: number } | null;
  onSeek: (n: number) => void;
  onZoom: (direction: number) => void;
  onSelect: (a: number, b: number) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    wrap = useRef<HTMLDivElement>(null),
    [data, setData] = useState<WindowData[]>([]),
    [loading, setLoading] = useState(false),
    [dragSelection, setDragSelection] = useState<{
      left: number;
      width: number;
    } | null>(null),
    [layoutVersion, setLayoutVersion] = useState(0),
    drag = useRef<number | null>(null);
  useEffect(() => {
    const element = wrap.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() =>
      setLayoutVersion((version) => version + 1),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all(
      selected.map((c) => readChannel(file, recording, c, start, duration)),
    )
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [file, recording, selected, start, duration]);
  useEffect(() => {
    const el = canvas.current,
      host = wrap.current;
    if (!el || !host) return;
    const width = host.clientWidth,
      height = Math.max(host.clientHeight, selected.length * 30 + 48),
      dpr = window.devicePixelRatio || 1;
    el.width = width * dpr;
    el.height = height * dpr;
    el.style.height = `${height}px`;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "#fbfcfa";
    ctx.fillRect(0, 0, width, height);
    const left = 72,
      right = 12,
      top = 18,
      bottom = 28,
      plotWidth = width - left - right,
      row = (height - top - bottom) / (selected.length || 1);
    ctx.font = "9px monospace";
    ctx.textAlign = "center";
    ctx.strokeStyle = "#e4eae7";
    const tickStep = getTimeTickStep(duration, plotWidth);
    for (let sec = 0; sec <= duration; sec += tickStep) {
      const x = left + (sec / duration) * plotWidth;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, height - bottom);
      ctx.stroke();
      ctx.fillStyle = "#7b8985";
      ctx.fillText(`${(start + sec).toFixed(0)}s`, x, height - 9);
    }
    selected.forEach((c, i) => {
      const d = data[i];
      const mid = top + row * (i + 0.5);
      ctx.strokeStyle = "#dce4e0";
      ctx.beginPath();
      ctx.moveTo(left, mid);
      ctx.lineTo(width - right, mid);
      ctx.stroke();
      ctx.fillStyle = c.color;
      ctx.textAlign = "right";
      ctx.font = "10px monospace";
      ctx.fillText(c.label, left - 8, mid + 3);
      if (!d?.values.length) return;
      const sorted = [...d.values].sort((a, b) => a - b),
        lo = sorted[Math.floor(sorted.length * 0.05)],
        hi = sorted[Math.floor(sorted.length * 0.95)],
        amp = Math.max((hi - lo) / 2, 1e-6) / Math.max(0.5, Math.min(4, gain)),
        center = (hi + lo) / 2,
        half = Math.min(row * 0.35, 30);
      ctx.strokeStyle = c.color;
      ctx.beginPath();
      d.values.forEach((v, j) => {
        const x = left + ((d.times[j] - start) / duration) * plotWidth,
          y =
            mid - Math.max(-half, Math.min(half, ((v - center) / amp) * half));
        if (j === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    });
    annotations
      .filter(
        (a) =>
          !(a.origin === "automated" && a.rejected) &&
          a.endSec >= start &&
          a.startSec <= start + duration,
      )
      .forEach((a) => {
        const color = ANNOTATION_COLORS[a.label] || ANNOTATION_COLORS.Other;
        ctx.fillStyle = `${color}40`;
        const x =
            left +
            ((Math.max(a.startSec, start) - start) / duration) * plotWidth,
          w = Math.max(
            2,
            ((Math.min(a.endSec, start + duration) -
              Math.max(a.startSec, start)) /
              duration) *
              plotWidth,
          );
        ctx.fillRect(x, 2, w, 14);
        ctx.fillStyle = color;
        ctx.fillText(a.label, x + 4, 12);
      });
  }, [data, selected, start, duration, gain, annotations, layoutVersion]);
  const timeFromX = (x: number) => {
    const rect = wrap.current!.getBoundingClientRect();
    const plotWidth = rect.width - 84;
    return start + Math.max(0, Math.min(1, (x - 72) / plotWidth)) * duration;
  };
  const plotWidth = Math.max(0, (wrap.current?.clientWidth ?? 84) - 84);
  const contentHeight = Math.max(
    wrap.current?.clientHeight ?? 0,
    selected.length * 30 + 48,
  );
  const visibleSelection = selection
    ? {
        start: Math.max(selection.startSec, start),
        end: Math.min(selection.endSec, start + duration),
      }
    : null;
  const selectedBand =
    visibleSelection && visibleSelection.end > visibleSelection.start
      ? {
          left: 72 + ((visibleSelection.start - start) / duration) * plotWidth,
          width:
            ((visibleSelection.end - visibleSelection.start) / duration) *
            plotWidth,
        }
      : null;
  useEffect(() => {
    const element = wrap.current;
    if (!element) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.ctrlKey || event.metaKey) {
        onZoom(event.deltaY > 0 ? 1 : -1);
        return;
      }
      onSeek(
        Math.max(
          0,
          Math.min(
            recording.duration - duration,
            start + Math.sign(event.deltaY) * duration * 0.25,
          ),
        ),
      );
    };
    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, [duration, onSeek, onZoom, recording.duration, start]);
  return (
    <div
      className="plot-wrap"
      ref={wrap}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        const rect = wrap.current!.getBoundingClientRect();
        drag.current = e.clientX - rect.left;
        setDragSelection({ left: drag.current, width: 0 });
        wrap.current?.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (drag.current === null) return;
        const x = e.clientX - wrap.current!.getBoundingClientRect().left;
        setDragSelection({
          left: Math.min(drag.current, x),
          width: Math.abs(x - drag.current),
        });
      }}
      onPointerUp={(e) => {
        if (drag.current !== null) {
          const rect = wrap.current!.getBoundingClientRect();
          const end = e.clientX - rect.left;
          if (Math.abs(end - drag.current) >= 3)
            onSelect(timeFromX(drag.current), timeFromX(end));
          drag.current = null;
          setDragSelection(null);
        }
      }}
      onPointerCancel={() => {
        drag.current = null;
        setDragSelection(null);
      }}
    >
      <canvas id="eegCanvas" ref={canvas} />
      {selectedBand && !dragSelection && (
        <div
          className="selection selection-persistent"
          style={{
            left: selectedBand.left,
            width: selectedBand.width,
            height: contentHeight,
          }}
        >
          <span>Selected</span>
        </div>
      )}
      {dragSelection && (
        <div
          className="selection"
          style={{
            left: dragSelection.left,
            width: dragSelection.width,
            height: contentHeight,
          }}
        />
      )}
      {loading && (
        <div className="loading">
          <span />
          Reading signal window…
        </div>
      )}
      <div className="plot-hint">Drag to select · Scroll to navigate</div>
    </div>
  );
}

export function AnnotationDialog({
  range,
  onClose,
  onSave,
  existing,
  defaultChannels,
}: {
  range: { startSec: number; endSec: number } | null;
  onClose: () => void;
  onSave: (annotation: Annotation) => void;
  existing?: Annotation;
  defaultChannels: string[];
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [label, setLabel] = useState(existing?.label || "Seizure"),
    [notes, setNotes] = useState(existing?.notes || ""),
    [channels, setChannels] = useState(
      existing ? existing.channels.join(", ") : defaultChannels.join(", "),
    ),
    [startSec, setStartSec] = useState(range?.startSec ?? 0),
    [endSec, setEndSec] = useState(range?.endSec ?? 0),
    [formError, setFormError] = useState("");
  useEffect(() => {
    setLabel(existing?.label || "Seizure");
    setNotes(existing?.notes || "");
    setChannels(
      existing ? existing.channels.join(", ") : defaultChannels.join(", "),
    );
    setStartSec(range?.startSec ?? 0);
    setEndSec(range?.endSec ?? 0);
    setFormError("");
  }, [existing, range, defaultChannels]);
  useEffect(() => {
    const element = dialog.current;
    if (range && element && !element.open) element.showModal();
  }, [range]);
  if (!range) return null;
  return (
    <dialog
      ref={dialog}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (
            !Number.isFinite(startSec) ||
            !Number.isFinite(endSec) ||
            endSec <= startSec
          ) {
            setFormError("End time must be later than start time.");
            return;
          }
          onSave({
            ...existing,
            id: existing?.id || crypto.randomUUID(),
            startSec,
            endSec,
            label,
            notes,
            channels: channels
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
            origin: existing?.origin || "reviewer",
            createdAt: existing?.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        }}
      >
        <div className="dialog-head">
          <div>
            <span className="eyebrow">Selected event</span>
            <h2>{existing ? "Edit annotation" : "New annotation"}</h2>
          </div>
          <button type="button" className="close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="range-card">
          <span>TIME RANGE</span>
          <div className="annotation-time-inputs">
            <label>
              Start (seconds)
              <input
                type="number"
                min="0"
                step="0.001"
                value={startSec}
                onChange={(e) => setStartSec(Number(e.target.value))}
              />
            </label>
            <label>
              End (seconds)
              <input
                type="number"
                min="0"
                step="0.001"
                value={endSec}
                onChange={(e) => setEndSec(Number(e.target.value))}
              />
            </label>
          </div>
          <small>
            {formatTime(startSec, true)} – {formatTime(endSec, true)}
          </small>
        </div>
        <label>
          Label
          <select value={label} onChange={(e) => setLabel(e.target.value)}>
            {[
              "Seizure",
              "Spike",
              "Artifact",
              "Eye movement",
              "Sleep event",
              "Technical issue",
              "Other",
            ].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label>
          Reviewer notes
          <textarea
            rows={4}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
        <label>
          Channels
          <input
            value={channels}
            onChange={(e) => setChannels(e.target.value)}
            placeholder="All visible channels"
          />
        </label>
        <div className="dialog-actions">
          <button type="button" className="button ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary">Save annotation</button>
        </div>
        {formError && (
          <p className="annotation-form-error" role="alert">
            {formError}
          </p>
        )}
      </form>
    </dialog>
  );
}
export function formatTime(seconds: number, ms = false) {
  seconds = Math.max(0, seconds || 0);
  const h = Math.floor(seconds / 3600),
    m = Math.floor((seconds % 3600) / 60),
    s = Math.floor(seconds % 60),
    tail = ms
      ? `.${String(Math.floor((seconds % 1) * 1000)).padStart(3, "0")}`
      : "";
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}${tail}`;
}
