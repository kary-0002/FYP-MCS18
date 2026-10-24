import type { Channel, Recording, Signal, WindowData } from "./types";
const MONTAGE = [
  ["Outer right", "#d13d3d", ["Fp2-F8", "F8-T4", "T4-T6", "T6-O2"]],
  ["Outer left", "#2859b8", ["Fp1-F7", "F7-T3", "T3-T5", "T5-O1"]],
  ["Inner right", "#d13d3d", ["Fp2-F4", "F4-C4", "C4-P4", "P4-O2"]],
  ["Inner left", "#2859b8", ["Fp1-F3", "F3-C3", "C3-P3", "P3-O1"]],
  ["Center", "#111827", ["Fz-Cz", "Cz-Pz"]],
] as const;
const field = (b: Uint8Array, s: number, n: number) =>
  new TextDecoder("ascii").decode(b.subarray(s, s + n)).trim();
const number = (b: Uint8Array, s: number, n: number) =>
  Number(field(b, s, n)) || 0;
const electrode = (v: string) =>
  v
    .toUpperCase()
    .replace(/^EEG/, "")
    .replace(/[^A-Z0-9]/g, "");
export async function parseEDF(file: File): Promise<Recording> {
  const base = new Uint8Array(await file.slice(0, 256).arrayBuffer());
  if (base.length < 256)
    throw Error("This file is too small to be an EDF recording.");
  const count = number(base, 252, 4),
    header = number(base, 184, 8);
  if (
    !Number.isInteger(count) ||
    count <= 0 ||
    header < 256 + count * 256 ||
    header > file.size
  )
    throw Error("Invalid or unsupported EDF header.");
  const h = new Uint8Array(await file.slice(0, header).arrayBuffer());
  let o = 256;
  const read = (n: number) => {
    const a = Array.from({ length: count }, (_, i) => field(h, o + i * n, n));
    o += count * n;
    return a;
  };
  const labels = read(16),
    _transducers = read(80),
    _dimensions = read(8),
    pmin = read(8).map(Number),
    pmax = read(8).map(Number),
    dmin = read(8).map(Number),
    dmax = read(8).map(Number);
  read(80);
  const samples = read(8).map(Number);
  read(32);
  const recordDuration = number(base, 244, 8) || 1;
  let recordCount = Number(field(base, 236, 8));
  const bytesPerRecord = samples.reduce((a, b) => a + b, 0) * 2;
  if (!Number.isFinite(bytesPerRecord) || bytesPerRecord <= 0)
    throw Error("The EDF header does not contain any readable signal samples.");
  const availableRecords = Math.floor((file.size - header) / bytesPerRecord);
  if (availableRecords <= 0)
    throw Error("The EDF file contains a header but no complete data records.");
  if (!Number.isFinite(recordCount) || recordCount <= 0)
    recordCount = availableRecords;
  else recordCount = Math.min(recordCount, availableRecords);
  let offset = 0;
  const signals: Signal[] = labels.map((label, i) => {
    const signal = {
      index: i,
      label: label || `Signal ${i + 1}`,
      physicalMin: pmin[i],
      physicalMax: pmax[i],
      digitalMin: dmin[i],
      digitalMax: dmax[i],
      samplesPerRecord: samples[i],
      sampleRate: samples[i] / recordDuration,
      recordByteOffset: offset,
    };
    offset += samples[i] * 2;
    return signal;
  });
  return {
    headerBytes: header,
    recordCount,
    recordDuration,
    bytesPerRecord,
    duration: recordCount * recordDuration,
    signals,
    patient: field(base, 8, 80),
    startDate: field(base, 168, 8),
    startTime: field(base, 176, 8),
  };
}
export function makeChannels(signals: Signal[]): Channel[] {
  const usable = signals.filter(
    (s) => s.samplesPerRecord > 0 && !/annotation/i.test(s.label),
  );
  const find = (name: string) =>
    usable.find((s) =>
      new RegExp(
        `^${electrode(name)}(?:REF|REFERENCE|AVG|A1|A2|M1|M2|LE|RE|GND)?$`,
        "i",
      ).test(electrode(s.label)),
    );
  const out: Channel[] = [];
  for (const [group, color, pairs] of MONTAGE)
    for (const pair of pairs) {
      const [a, b] = pair.split("-");
      const left = find(a),
        right = find(b);
      if (left && right)
        out.push({
          id: `calculated:${pair}`,
          label: pair,
          group,
          color,
          kind: "calculated",
          left,
          right,
        });
    }
  for (const signal of usable) {
    if (
      MONTAGE.some(([, , pairs]) =>
        pairs.some((p) => electrode(p) === electrode(signal.label)),
      )
    )
      continue;
    const name = electrode(signal.label),
      ep = name.match(/^(?:FP[12]|[FTCP][1-8]|O[12]|[A-Z]Z)/)?.[0] || name;
    const color = /Z$/.test(ep)
      ? "#111827"
      : /(FP2|[FTCP][2468]|O2)$/.test(ep)
        ? "#d13d3d"
        : /(FP1|[FTCP][1357]|O1)$/.test(ep)
          ? "#2859b8"
          : "#176b59";
    const group =
      color === "#d13d3d"
        ? "Right hemisphere"
        : color === "#2859b8"
          ? "Left hemisphere"
          : color === "#111827"
            ? "Midline"
            : "Other / auxiliary";
    out.push({
      id: `individual:${signal.index}`,
      label: signal.label,
      group,
      color,
      kind: "individual",
      signal,
    });
  }
  return out;
}
async function readSignal(
  file: File,
  edf: Recording,
  s: Signal,
  start: number,
  duration: number,
): Promise<WindowData> {
  const first = Math.max(0, Math.floor(start / edf.recordDuration)),
    last = Math.min(
      edf.recordCount - 1,
      Math.floor((start + duration - 1e-9) / edf.recordDuration),
    );
  if (last < first) return { times: [], values: [] };
  const buf = await file
      .slice(
        edf.headerBytes + first * edf.bytesPerRecord,
        edf.headerBytes + (last + 1) * edf.bytesPerRecord,
      )
      .arrayBuffer(),
    view = new DataView(buf),
    times: number[] = [],
    values: number[] = [],
    scale =
      (s.physicalMax - s.physicalMin) / (s.digitalMax - s.digitalMin || 1),
    offset = s.physicalMin - s.digitalMin * scale;
  for (let r = 0; r <= last - first; r++)
    for (let j = 0; j < s.samplesPerRecord; j++) {
      const t = (first + r) * edf.recordDuration + j / s.sampleRate;
      if (t >= start && t <= start + duration) {
        times.push(t);
        values.push(
          view.getInt16(
            r * edf.bytesPerRecord + s.recordByteOffset + j * 2,
            true,
          ) *
            scale +
            offset,
        );
      }
    }
  return { times, values };
}
const interpolate = (t: number[], v: number[], x: number) => {
  if (!v.length) return 0;
  if (x <= t[0]) return v[0];
  let i = 1;
  while (i < t.length && t[i] < x) i++;
  if (i === t.length) return v.at(-1)!;
  const q = (x - t[i - 1]) / (t[i] - t[i - 1] || 1);
  return v[i - 1] + (v[i] - v[i - 1]) * q;
};
export async function readChannel(
  file: File,
  edf: Recording,
  c: Channel,
  start: number,
  duration: number,
): Promise<WindowData> {
  if (c.kind === "individual")
    return readSignal(file, edf, c.signal!, start, duration);
  const [a, b] = await Promise.all([
    readSignal(file, edf, c.left!, start, duration),
    readSignal(file, edf, c.right!, start, duration),
  ]);
  return {
    times: a.times,
    values: a.values.map(
      (v, i) => v - interpolate(b.times, b.values, a.times[i]),
    ),
  };
}
