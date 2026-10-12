"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, ChartNoAxesCombined, Gauge, ShieldCheck, Waves } from "lucide-react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { FILE_BUCKET, getRecordingPathsFromEdfPath } from "@/lib/files";

export interface TrendRecording {
  id: string;
  original_name: string;
  storage_path: string;
  created_at: string;
}

interface BackgroundMetrics {
  dominant_frequency_hz?: {
    left?: number | null;
    right?: number | null;
  };
  relative_band_power?: {
    delta?: number | null;
    theta?: number | null;
    alpha?: number | null;
    beta?: number | null;
  };
  amplitude_uv?: {
    delta?: number | null;
    theta?: number | null;
    alpha?: number | null;
    beta?: number | null;
  };
  slow_wave_ratio_percent?: {
    left?: number | null;
    right?: number | null;
    total?: number | null;
  };
  removed_epoch_percent?: number | null;
  bad_channels?: string[];
  technical_quality?: string | null;
}

interface TrendPoint {
  id: string;
  fileName: string;
  date: string;
  timestamp: number;
  dominantLeft: number | null;
  dominantRight: number | null;
  deltaPower: number | null;
  thetaPower: number | null;
  alphaPower: number | null;
  betaPower: number | null;
  alphaAmplitude: number | null;
  slowWaveRatio: number | null;
  removedEpochPercent: number | null;
  badChannelCount: number;
  badChannels: string[];
  durationMinutes: number | null;
  technicalQuality: string | null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatTrendDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }
  return new Intl.DateTimeFormat(
    "en-GB",
    {day: "numeric", month: "short", year: "numeric"}
  ).format(date);
}

function recordingDateFromState(state: Record<string, any>, fallback: string) {
  const metadataDate = state.metadata?.recording_start;
  if (typeof metadataDate === "string" && !Number.isNaN(new Date(metadataDate).getTime())) {
    return metadataDate;
  }
  const startDate = state.recording?.startDate;
  const startTime = state.recording?.startTime;
  if (typeof startDate === "string" && startDate.trim()) {
    const combined = typeof startTime === "string" && startTime.trim()
      ? `${startDate}T${startTime}`
      : startDate;
    if (!Number.isNaN(new Date(combined).getTime())) {
      return combined;
    }
  }
  return fallback;
}

function asPercentage(value: number | null) {
  return value == null ? null : value * 100;
}

function formatNumber(value: number | null | undefined, digits = 1) {
  if (value == null || !Number.isFinite(value)) {
    return "—";
  }
  return value.toFixed(digits);
}

function meanAvailable(left: number | null, right: number | null) {
  if (left != null && right != null) {
    return (left + right) / 2;
  }
  return left ?? right ?? null;
}

function percentile(values: number[], p: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) {
    return sorted[0];
  }
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) {
    return sorted[lower];
  }
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

interface DescriptiveStats {
  count: number;
  mean: number;
  median: number;
  min: number;
  max: number;
  q1: number;
  q3: number;
}

function calculateStats(values: Array<number | null>): DescriptiveStats | null {
  const valid = values.filter(
    (value): value is number => value != null && Number.isFinite(value)
  );
  if (valid.length === 0) {
    return null;
  }
  const sorted = [...valid].sort((a, b) => a - b);
  const q1 = percentile(sorted, 0.25);
  const median = percentile(sorted, 0.5);
  const q3 = percentile(sorted, 0.75);
  if (q1 == null || median == null || q3 == null) {
    return null;
  }
  return {
    count: sorted.length,
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    median,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    q1,
    q3
  };
}

function statRange(stats: DescriptiveStats | null, suffix = "") {
  if (!stats) return "—";
  return `${formatNumber(stats.min)}–${formatNumber(stats.max)}${suffix}`;
}

function statIqr(stats: DescriptiveStats | null, suffix = "") {
  if (!stats) return "—";
  return `${formatNumber(stats.q1)}–${formatNumber(stats.q3)}${suffix}`;
}

export function PatientTrends({ recordings }: { recordings: TrendRecording[]; }) {
  const supabase = useMemo(() => createClient(), []);
  const [points, setPoints] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadTrends() {
      setLoading(true);
      setError(null);

      try {
        const loaded = await Promise.all(
          recordings.map(async (recording) => {
            const paths = getRecordingPathsFromEdfPath(recording.storage_path);
            if (!paths) {
              return null;
            }

            const { data: stateBlob, error: stateError } = await supabase.storage
              .from(FILE_BUCKET)
              .download(paths.state);
            if (stateError || !stateBlob) {
              return null;
            }

            let state: Record<string, any>;
            try {
              state = JSON.parse(await stateBlob.text());
            } catch {
              return null;
            }
            if (state.backgroundAnalysis?.status !== "completed" || !state.backgroundAnalysis?.metrics) {
              return null;
            }

            const metrics = state.backgroundAnalysis.metrics as BackgroundMetrics;
            const recordingDate = recordingDateFromState(state, recording.created_at);
            const timestamp = new Date(recordingDate).getTime();
            const relativePower = metrics.relative_band_power;
            const badChannels = Array.isArray(metrics.bad_channels)
              ? metrics.bad_channels.filter((channel): channel is string => typeof channel === "string")
              : [];
            const durationSeconds =
              finiteNumber(state.metadata?.duration_seconds) ??
              finiteNumber(state.recording?.durationSec);
            const durationMinutes = durationSeconds == null ? null : durationSeconds / 60;

            return {
              id: recording.id,
              fileName: recording.original_name,
              date: formatTrendDate(recordingDate),
              timestamp: Number.isFinite(timestamp) ? timestamp : new Date(recording.created_at).getTime(),
              dominantLeft: finiteNumber(metrics.dominant_frequency_hz?.left),
              dominantRight: finiteNumber(metrics.dominant_frequency_hz?.right),
              deltaPower: asPercentage(finiteNumber(relativePower?.delta)),
              thetaPower: asPercentage(finiteNumber(relativePower?.theta)),
              alphaPower: asPercentage(finiteNumber(relativePower?.alpha)),
              betaPower: asPercentage(finiteNumber(relativePower?.beta)),
              alphaAmplitude: finiteNumber(metrics.amplitude_uv?.alpha),
              slowWaveRatio: finiteNumber(metrics.slow_wave_ratio_percent?.total),
              removedEpochPercent: finiteNumber(metrics.removed_epoch_percent),
              badChannelCount: badChannels.length,
              badChannels,
              durationMinutes,
              technicalQuality: metrics.technical_quality ?? null,
            } satisfies TrendPoint;
          })
        );

        if (cancelled) return;
        const validPoints = loaded
          .filter((point): point is TrendPoint => point !== null)
          .sort((a, b) => a.timestamp - b.timestamp);
        setPoints(validPoints);

      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load patient statistics.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadTrends();
    return () => {
      cancelled = true;
    };
  }, [recordings, supabase]);

  const latest = points.length > 0 ? points[points.length - 1] : null;
  const latestDominant = latest?.dominantLeft != null && latest?.dominantRight != null
    ? ((latest.dominantLeft + latest.dominantRight) / 2)
    : latest?.dominantLeft ?? latest?.dominantRight ?? null;

  const dominantFrequencyStats = calculateStats(
    points.map((point) => meanAvailable(point.dominantLeft, point.dominantRight))
  );
  const slowWaveStats = calculateStats(points.map((point) => point.slowWaveRatio));
  const alphaAmplitudeStats = calculateStats(points.map((point) => point.alphaAmplitude));
  const deltaPowerStats = calculateStats(points.map((point) => point.deltaPower));
  const thetaPowerStats = calculateStats(points.map((point) => point.thetaPower));
  const alphaPowerStats = calculateStats(points.map((point) => point.alphaPower));
  const betaPowerStats = calculateStats(points.map((point) => point.betaPower));
  const durationStats = calculateStats(points.map((point) => point.durationMinutes));

  if (loading) {
    return (
      <Card className="p-8 text-center">
        <Activity className="mx-auto h-10 w-10 animate-pulse text-muted-foreground" />
        <p className="mt-3 text-sm text-muted-foreground">
          Loading stored EEG statistics...
        </p>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="p-8 text-center">
        <p className="text-sm text-destructive">
          {error}
        </p>
      </Card>
    );
  }

  if (points.length === 0) {
    return (
      <Card className="p-8 text-center">
        <ChartNoAxesCombined className="mx-auto h-12 w-12 text-muted-foreground" />
        <h2 className="mt-3 font-semibold">
          No Analysed Recordings Yet
        </h2>
        <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
          Run background analysis on an EEG recording assigned to this patient.
          <br />
          Stored results will appear here automatically.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-semibold">
          Longitudinal EEG Statistics
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {points.length} of {recordings.length}{" "}
          {recordings.length === 1 ? "recording has" : "recordings have"}{" "}
          stored background-analysis results.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="gap-0 p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Waves className="h-4 w-4" />
            Dominant Frequency
          </div>
          <p className="mt-2 text-2xl font-semibold">
            {formatNumber(latestDominant)} Hz
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Latest recording, mean of available left and right estimates.
          </p>
        </Card>
        <Card className="gap-0 p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Activity className="h-4 w-4" />
            Slow-Wave Ratio
          </div>
          <p className="mt-2 text-2xl font-semibold">
            {formatNumber(latest?.slowWaveRatio)}%
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Proportion of slow-wave activity reported by background analysis.
          </p>
        </Card>
        <Card className="gap-0 p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Gauge className="h-4 w-4" />
            Alpha Amplitude
          </div>
          <p className="mt-2 text-2xl font-semibold">
            {formatNumber(latest?.alphaAmplitude)} µV
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Estimated alpha-band amplitude in the latest analysed recording.
          </p>
        </Card>
        <Card className="gap-0 p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ShieldCheck className="h-4 w-4" />
            Technical Quality
          </div>
          <p className="mt-2 text-2xl font-semibold">
            {latest?.technicalQuality ?? "—"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {latest?.removedEpochPercent != null
              ? `${formatNumber(latest.removedEpochPercent)}% of epochs removed during preprocessing.`
              : "Latest automated signal-quality assessment."}
          </p>
        </Card>
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="gap-0 p-5">
          <div>
            <h3 className="font-semibold">
              Dominant Background Frequency
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Estimated dominant frequency for the left and right hemispheres across recording dates.
            </p>
          </div>
          <div className="mt-5 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points} margin={{ left: 4, right: 8, bottom: 4, top: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false}/>
                <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} padding={{ left: 12, right: 12 }}/>
                <YAxis unit=" Hz" tickLine={false} axisLine={false} width={55}/>
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="dominantLeft" name="Left" stroke="var(--chart-1)" strokeWidth={2} connectNulls/>
                <Line type="monotone" dataKey="dominantRight" name="Right" stroke="var(--chart-2)" strokeWidth={2} connectNulls/>
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="gap-0 p-5">
          <div>
            <h3 className="font-semibold">
              Relative Band Power
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Relative contribution of delta, theta, alpha and beta activity within the analysed 1–30 Hz spectrum.
            </p>
          </div>
          <div className="mt-5 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points} margin={{ left: 4, right: 8, bottom: 4, top: 4 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false}/>
                <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} padding={{ left: 12, right: 12 }}/>
                <YAxis unit="%" tickLine={false} axisLine={false} width={48}/>
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="deltaPower" name="Delta" stroke="var(--chart-1)" strokeWidth={2} connectNulls/>
                <Line type="monotone" dataKey="thetaPower" name="Theta" stroke="var(--chart-2)" strokeWidth={2} connectNulls/>
                <Line type="monotone" dataKey="alphaPower" name="Alpha" stroke="var(--chart-3)" strokeWidth={2} connectNulls/>
                <Line type="monotone" dataKey="betaPower" name="Beta" stroke="var(--chart-4)" strokeWidth={2} connectNulls/>
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
      <Card className="gap-0 overflow-hidden py-0">
        <div className="border-b px-5 py-4">
          <h3 className="font-semibold">
            Descriptive Statistics
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Summary statistics across analysed recordings for this patient.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b bg-muted/30 text-left">
              <tr>
                <th className="px-5 py-3 font-medium">Metric</th>
                <th className="px-4 py-3 font-medium">Count</th>
                <th className="px-4 py-3 font-medium">Mean</th>
                <th className="px-4 py-3 font-medium">Median</th>
                <th className="px-4 py-3 font-medium">Range</th>
                <th className="px-4 py-3 font-medium">IQR</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              <tr>
                <td className="px-5 py-3.5 font-medium">Dominant Frequency</td>
                <td className="px-4 py-3.5">{dominantFrequencyStats?.count ?? "—"}</td>
                <td className="px-4 py-3.5">{dominantFrequencyStats ? `${formatNumber(dominantFrequencyStats.mean)} Hz` : "—"}</td>
                <td className="px-4 py-3.5">{dominantFrequencyStats ? `${formatNumber(dominantFrequencyStats.median)} Hz` : "—"}</td>
                <td className="px-4 py-3.5">{statRange(dominantFrequencyStats, " Hz")}</td>
                <td className="px-4 py-3.5">{statIqr(dominantFrequencyStats, " Hz")}</td>
              </tr>
              <tr>
                <td className="px-5 py-3.5 font-medium">Slow-Wave Ratio</td>
                <td className="px-4 py-3.5">{slowWaveStats?.count ?? "—"}</td>
                <td className="px-4 py-3.5">{slowWaveStats ? `${formatNumber(slowWaveStats.mean)}%` : "—"}</td>
                <td className="px-4 py-3.5">{slowWaveStats ? `${formatNumber(slowWaveStats.median)}%` : "—"}</td>
                <td className="px-4 py-3.5">{statRange(slowWaveStats, "%")}</td>
                <td className="px-4 py-3.5">{statIqr(slowWaveStats, "%")}</td>
              </tr>
              <tr>
                <td className="px-5 py-3.5 font-medium">Alpha Amplitude</td>
                <td className="px-4 py-3.5">{alphaAmplitudeStats?.count ?? "—"}</td>
                <td className="px-4 py-3.5">{alphaAmplitudeStats ? `${formatNumber(alphaAmplitudeStats.mean)} µV` : "—"}</td>
                <td className="px-4 py-3.5">{alphaAmplitudeStats ? `${formatNumber(alphaAmplitudeStats.median)} µV` : "—"}</td>
                <td className="px-4 py-3.5">{statRange(alphaAmplitudeStats, " µV")}</td>
                <td className="px-4 py-3.5">{statIqr(alphaAmplitudeStats, " µV")}</td>
              </tr>
              <tr>
                <td className="px-5 py-3.5 font-medium">Recording Duration</td>
                <td className="px-4 py-3.5">{durationStats?.count ?? "—"}</td>
                <td className="px-4 py-3.5">{durationStats ? `${formatNumber(durationStats.mean)} min` : "—"}</td>
                <td className="px-4 py-3.5">{durationStats ? `${formatNumber(durationStats.median)} min` : "—"}</td>
                <td className="px-4 py-3.5">{statRange(durationStats, " min")}</td>
                <td className="px-4 py-3.5">{statIqr(durationStats, " min")}</td>
              </tr>
              <tr>
                <td className="px-5 py-3.5 font-medium">Delta Power</td>
                <td className="px-4 py-3.5">{deltaPowerStats?.count ?? "—"}</td>
                <td className="px-4 py-3.5">{deltaPowerStats ? `${formatNumber(deltaPowerStats.mean)}%` : "—"}</td>
                <td className="px-4 py-3.5">{deltaPowerStats ? `${formatNumber(deltaPowerStats.median)}%` : "—"}</td>
                <td className="px-4 py-3.5">{statRange(deltaPowerStats, "%")}</td>
                <td className="px-4 py-3.5">{statIqr(deltaPowerStats, "%")}</td>
              </tr>
              <tr>
                <td className="px-5 py-3.5 font-medium">Theta Power</td>
                <td className="px-4 py-3.5">{thetaPowerStats?.count ?? "—"}</td>
                <td className="px-4 py-3.5">{thetaPowerStats ? `${formatNumber(thetaPowerStats.mean)}%` : "—"}</td>
                <td className="px-4 py-3.5">{thetaPowerStats ? `${formatNumber(thetaPowerStats.median)}%` : "—"}</td>
                <td className="px-4 py-3.5">{statRange(thetaPowerStats, "%")}</td>
                <td className="px-4 py-3.5">{statIqr(thetaPowerStats, "%")}</td>
              </tr>
              <tr>
                <td className="px-5 py-3.5 font-medium">Alpha Power</td>
                <td className="px-4 py-3.5">{alphaPowerStats?.count ?? "—"}</td>
                <td className="px-4 py-3.5">{alphaPowerStats ? `${formatNumber(alphaPowerStats.mean)}%` : "—"}</td>
                <td className="px-4 py-3.5">{alphaPowerStats ? `${formatNumber(alphaPowerStats.median)}%` : "—"}</td>
                <td className="px-4 py-3.5">{statRange(alphaPowerStats, "%")}</td>
                <td className="px-4 py-3.5">{statIqr(alphaPowerStats, "%")}</td>
              </tr>
              <tr>
                <td className="px-5 py-3.5 font-medium">Beta Power</td>
                <td className="px-4 py-3.5">{betaPowerStats?.count ?? "—"}</td>
                <td className="px-4 py-3.5">{betaPowerStats ? `${formatNumber(betaPowerStats.mean)}%` : "—"}</td>
                <td className="px-4 py-3.5">{betaPowerStats ? `${formatNumber(betaPowerStats.median)}%` : "—"}</td>
                <td className="px-4 py-3.5">{statRange(betaPowerStats, "%")}</td>
                <td className="px-4 py-3.5">{statIqr(betaPowerStats, "%")}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
      <Card className="gap-0 overflow-hidden py-0">
        <div className="border-b px-5 py-4">
          <h3 className="font-semibold">
            Recording Quality
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Signal-quality information from each completed background analysis.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="border-b bg-muted/30 text-left">
              <tr>
                <th className="px-5 py-3 font-medium">Recording</th>
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Quality</th>
                <th className="px-4 py-3 font-medium">Removed Epochs</th>
                <th className="px-4 py-3 font-medium">Bad Channels</th>
                <th className="px-4 py-3 font-medium">Duration</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {points.map((point) => (
                <tr key={point.id}>
                  <td className="max-w-[220px] px-5 py-3.5">
                    <span className="block truncate font-medium" title={point.fileName}>{point.fileName}</span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3.5 text-muted-foreground">{point.date}</td>
                  <td className="px-4 py-3.5">{point.technicalQuality ?? "—"}</td>
                  <td className="px-4 py-3.5">{point.removedEpochPercent != null ? `${formatNumber(point.removedEpochPercent)}%` : "—"}</td>
                  <td className="max-w-[220px] px-4 py-3.5">
                    {point.badChannels.length > 0 ? (
                      <span className="block truncate" title={point.badChannels.join(", ")}>
                        {point.badChannelCount} (
                        {point.badChannels.join(", ")})
                      </span>
                    ) : ("None flagged")}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3.5">
                    {point.durationMinutes != null ? `${formatNumber(point.durationMinutes)} min` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card className="gap-0 p-5">
        <h3 className="font-semibold">About These Metrics</h3>
        <div className="mt-3 grid gap-3 text-sm text-muted-foreground md:grid-cols-2">
          <p>
            <span className="font-medium text-foreground">
              Dominant frequency:
            </span>{" "}
            estimated prevailing background rhythm, reported separately for the left and right hemispheres.
          </p>
          <p>
            <span className="font-medium text-foreground">
              Relative band power:
            </span>{" "}
            percentage of analysed 1–30 Hz spectral power contributed by delta, theta, alpha and beta bands.
          </p>
          <p>
            <span className="font-medium text-foreground">
              Slow-wave ratio:
            </span>{" "}
            proportion of slower EEG activity calculated by automated background-analysis pipeline.
          </p>
          <p>
            <span className="font-medium text-foreground">
              Alpha amplitude:
            </span>{" "}
            estimated amplitude of alpha-band activity, measured in microvolts.
          </p>
          <p>
            <span className="font-medium text-foreground">
              Technical quality:
            </span>{" "}
            automated assessment based partly on the amount of unusable EEG data identified during preprocessing.
          </p>
          <p>
            <span className="font-medium text-foreground">
              Removed epochs:
            </span>{" "}
            percentage of analysed EEG epochs excluded during automated preprocessing.
          </p>
          <p>
            <span className="font-medium text-foreground">
              Bad channels:
            </span>{" "}
            channels flagged by the automated signal-quality process. This does not identify the specific cause of the signal problem.
          </p>
          <p>
            <span className="font-medium text-foreground">
              Descriptive statistics:
            </span>{" "}
            summaries of this patient's available analysed recordings. They describe variation across recordings and are not, by themselves, a clinical diagnosis.
          </p>
        </div>
      </Card>
    </div>
  );
}