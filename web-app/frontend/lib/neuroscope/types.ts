export type Signal = {
  index: number;
  label: string;
  physicalMin: number;
  physicalMax: number;
  digitalMin: number;
  digitalMax: number;
  samplesPerRecord: number;
  sampleRate: number;
  recordByteOffset: number;
};
export type Recording = {
  headerBytes: number;
  recordCount: number;
  recordDuration: number;
  bytesPerRecord: number;
  duration: number;
  signals: Signal[];
  patient: string;
  startDate: string;
  startTime: string;
};
export type Channel = {
  id: string;
  label: string;
  group: string;
  color: string;
  kind: "individual" | "calculated";
  signal?: Signal;
  left?: Signal;
  right?: Signal;
};
export type Annotation = {
  id: string;
  startSec: number;
  endSec: number;
  label: string;
  notes: string;
  channels: string[];
  origin?: string;
  rejected?: boolean;
  model?: {
    meanProbability?: number | null;
    maxProbability?: number | null;
    durationSeconds?: number;
  };
  createdAt?: string;
  updatedAt?: string;
};
export type WindowData = { times: number[]; values: number[] };
