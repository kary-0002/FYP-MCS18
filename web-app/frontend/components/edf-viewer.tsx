"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { EDF } from "edfjs";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
    buildStoragePath,
    FILE_BUCKET,
    MAX_FILE_BYTES,
} from "@/lib/files";
import { Button } from "@/components/ui/button";

// Plotly must only be loaded in the browser.
const Plot = dynamic(() => import("react-plotly.js"), {
    ssr: false,
});

interface EDFSignal {
    label: string;
    samples: number[];
    sampleRate: number;
    unit?: string;
}

interface ParsedEDF {
    signals: EDFSignal[];
    duration: number;
    fileName: string;
}

export default function EDFViewer() {
    const router = useRouter();
    const [edf, setEdf] = useState<ParsedEDF | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saveMessage, setSaveMessage] = useState<string | null>(null);
    const selectedFileRef = useRef<File | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);

    async function handleFile(file: File) {
        setLoading(true);
        setError(null);
        setEdf(null);
        setSaveMessage(null);
        selectedFileRef.current = file;

        try {
            if (!file.name.toLowerCase().endsWith(".edf")) {
                throw new Error("Please select an .edf file.");
            }

            const buffer = await file.arrayBuffer();

            const parser = new EDF();

            parser.read_buffer(buffer);

            /*
             * edfjs exposes the parsed data through its EDF instance.
             *
             * Different releases expose slightly different internal
             * property names, so inspect the object here if your EDF
             * version differs.
             */
            const parsed = extractSignals(parser);

            if (parsed.signals.length === 0) {
                throw new Error(
                    "No signals were found in the EDF file."
                );
            }

            const duration = Math.max(
                ...parsed.signals.map(
                    (signal) =>
                        signal.samples.length / signal.sampleRate
                )
            );

            setEdf({
                signals: parsed.signals,
                duration,
                fileName: file.name,
            });
        } catch (err) {
            console.error(err);

            setError(
                err instanceof Error
                    ? err.message
                    : "Failed to read EDF file."
            );
        } finally {
            setLoading(false);
        }
    }

    function handleFileInput(
        event: React.ChangeEvent<HTMLInputElement>
    ) {
        const file = event.target.files?.[0];

        if (file) {
            void handleFile(file);
        }
    }

    function handleDrop(event: React.DragEvent<HTMLDivElement>) {
        event.preventDefault();

        const file = event.dataTransfer.files?.[0];

        if (file) {
            void handleFile(file);
        }
    }

    function handleDragOver(
        event: React.DragEvent<HTMLDivElement>
    ) {
        event.preventDefault();
    }

    function openFilePicker() {
        fileInputRef.current?.click();
    }

    async function saveToAccount() {
        const file = selectedFileRef.current;
        if (!file) return;

        setSaveMessage(null);

        if (file.size > MAX_FILE_BYTES) {
            setSaveMessage("File is larger than the 500 MB storage limit.");
            return;
        }

        let supabase;
        try {
            supabase = createClient();
        } catch {
            setSaveMessage("Supabase is not configured yet.");
            return;
        }

        const {
            data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
            router.push("/login?next=/edf-reader");
            return;
        }

        setSaving(true);
        const storagePath = buildStoragePath(user.id, "edf", file.name);

        try {
            const { error: uploadError } = await supabase.storage
                .from(FILE_BUCKET)
                .upload(storagePath, file, {
                    contentType: "application/octet-stream",
                    upsert: false,
                });

            if (uploadError) throw uploadError;

            const { error: insertError } = await supabase.from("user_files").insert({
                user_id: user.id,
                kind: "edf",
                original_name: file.name,
                storage_path: storagePath,
                size_bytes: file.size,
            });

            if (insertError) throw insertError;

            setSaveMessage("Saved to My files.");
        } catch (err) {
            setSaveMessage(
                err instanceof Error ? err.message : "Could not save this file.",
            );
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="w-full space-y-6">
            {/* File upload */}
            <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onClick={openFilePicker}
                className="
                    flex
                    min-h-40
                    cursor-pointer
                    flex-col
                    items-center
                    justify-center
                    rounded-xl
                    border-2
                    border-dashed
                    border-gray-300
                    bg-gray-50
                    p-8
                    text-center
                    transition
                    hover:border-gray-400
                    hover:bg-gray-100
                "
            >
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".edf"
                    onChange={handleFileInput}
                    className="hidden"
                />

                {loading ? (
                    <>
                        <div className="mb-3 text-lg font-medium">
                            Reading EDF file...
                        </div>

                        <div className="text-sm text-gray-500">
                            Please wait.
                        </div>
                    </>
                ) : (
                    <>
                        <div className="mb-2 text-lg font-medium">
                            Upload EDF file
                        </div>

                        <div className="text-sm text-gray-500">
                            Click or drag an .edf file here
                        </div>
                    </>
                )}
            </div>

            {/* Error */}
            {error && (
                <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700">
                    <strong>Error:</strong> {error}
                </div>
            )}

            {/* EDF information */}
            {edf && (
                <>
                    <div className="rounded-lg border bg-white p-4">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                            <div className="text-lg font-semibold">
                                {edf.fileName}
                            </div>
                            <Button
                                type="button"
                                size="sm"
                                onClick={() => void saveToAccount()}
                                disabled={saving}
                            >
                                {saving ? "Saving..." : "Save to my files"}
                            </Button>
                        </div>
                        {saveMessage && (
                            <p className="mb-3 text-sm text-muted-foreground">
                                {saveMessage}
                            </p>
                        )}

                        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                            <Info
                                label="Channels"
                                value={edf.signals.length}
                            />

                            <Info
                                label="Duration"
                                value={formatTime(edf.duration)}
                            />

                            <Info
                                label="File"
                                value={edf.fileName}
                            />
                        </div>
                    </div>

                    {/* Waveforms */}
                    <div className="space-y-4">
                        {edf.signals.map((signal, index) => (
                            <SignalChart
                                key={`${signal.label}-${index}`}
                                signal={signal}
                                duration={edf.duration}
                            />
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}

/* -------------------------------------------------------------------------- */
/* Signal chart                                                               */
/* -------------------------------------------------------------------------- */

interface SignalChartProps {
    signal: EDFSignal;
    duration: number;
}

function SignalChart({
    signal,
    duration,
}: SignalChartProps) {
    /*
     * Construct the time axis.

     * If sampleRate = 256:
     *
     * sample 0 -> 0.000 s
     * sample 1 -> 0.0039 s
     * sample 2 -> 0.0078 s
     * ...
     */
    const time = useMemo(() => {
        return signal.samples.map(
            (_, index) => index / signal.sampleRate
        );
    }, [signal.samples, signal.sampleRate]);

    /*
     * Large EDF files can contain millions of samples.

     * Plotting every single sample can make the browser extremely slow.
     *
     * This limits the waveform to roughly 10,000 points while preserving
     * the overall shape.
     */
    const displayData = useMemo(() => {
        const MAX_POINTS = 10_000;

        if (signal.samples.length <= MAX_POINTS) {
            return {
                x: time,
                y: signal.samples,
            };
        }

        const step =
            signal.samples.length / MAX_POINTS;

        const x: number[] = [];
        const y: number[] = [];

        for (
            let i = 0;
            i < signal.samples.length;
            i += step
        ) {
            const index = Math.floor(i);

            x.push(time[index]);
            y.push(signal.samples[index]);
        }

        return { x, y };
    }, [signal.samples, time]);

    return (
        <div className="overflow-hidden rounded-lg border bg-white">
            {/* Channel header */}
            <div className="flex items-center justify-between border-b bg-gray-50 px-4 py-3">
                <div>
                    <div className="font-semibold">
                        {signal.label}
                    </div>

                    <div className="text-xs text-gray-500">
                        {signal.sampleRate} Hz
                        {signal.unit
                            ? ` • ${signal.unit}`
                            : ""}
                    </div>
                </div>

                <div className="text-xs text-gray-500">
                    {signal.samples.length.toLocaleString()} samples
                </div>
            </div>

            {/* Chart */}
            <div className="h-64 w-full">
                <Plot
                    data={[
                        {
                            x: displayData.x,
                            y: displayData.y,
                            type: "scattergl",
                            mode: "lines",
                            line: {
                                width: 1,
                            },
                            hovertemplate:
                                "%{x:.3f} s<br>%{y}<extra></extra>",
                        },
                    ]}
                    layout={{
                        autosize: true,

                        margin: {
                            l: 60,
                            r: 20,
                            t: 10,
                            b: 45,
                        },

                        xaxis: {
                            title: {
                                text: "Time (seconds)",
                            },

                            range: [
                                0,
                                Math.min(duration, 10),
                            ],

                            fixedrange: false,

                            showgrid: true,

                            zeroline: false,
                        },

                        yaxis: {
                            title: {
                                text: signal.unit
                                    ? signal.unit
                                    : "Amplitude",
                            },

                            autorange: true,

                            fixedrange: false,

                            showgrid: true,

                            zeroline: true,
                        },

                        dragmode: "pan",

                        showlegend: false,

                        hovermode: "x unified",
                    }}
                    config={{
                        responsive: true,

                        displaylogo: false,

                        scrollZoom: true,

                        modeBarButtonsToRemove: [
                            "lasso2d",
                            "select2d",
                        ],
                    }}
                    style={{
                        width: "100%",
                        height: "100%",
                    }}
                    useResizeHandler
                />
            </div>
        </div>
    );
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function Info({
    label,
    value,
}: {
    label: string;
    value: string | number;
}) {
    return (
        <div>
            <div className="text-xs uppercase tracking-wide text-gray-500">
                {label}
            </div>

            <div className="mt-1 font-medium">
                {value}
            </div>
        </div>
    );
}

function formatTime(seconds: number) {
    if (!Number.isFinite(seconds)) {
        return "-";
    }

    const hours = Math.floor(seconds / 3600);

    const minutes = Math.floor(
        (seconds % 3600) / 60
    );

    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
        return `${hours}h ${minutes}m ${secs}s`;
    }

    if (minutes > 0) {
        return `${minutes}m ${secs}s`;
    }

    return `${seconds.toFixed(2)}s`;
}

/* -------------------------------------------------------------------------- */
/* EDF parser adapter                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Converts the EDF parser's representation into the format
 * used by our React component.
 *
 * This function is intentionally isolated from the UI.
 *
 * If you switch EDF libraries later, only this function needs
 * to change.
 */
function extractSignals(parser: any): {
    signals: EDFSignal[];
} {
    /*
     * edfjs versions expose their decoded information differently.
     *
     * Try the common structures first.
     */

    const rawSignals =
        parser.signals ??
        parser.signal ??
        parser.data?.signals ??
        parser.header?.signals ??
        [];

    if (!Array.isArray(rawSignals)) {
        console.log("EDF parser object:", parser);

        throw new Error(
            "Could not find signal data in the EDF parser. " +
                "Check the EDF library version/API."
        );
    }

    const signals = rawSignals
        .map((signal: any, index: number): EDFSignal | null => {
            const samples =
                signal.samples ??
                signal.data ??
                signal.values ??
                [];

            const sampleRate =
                Number(
                    signal.sampleRate ??
                        signal.samplingRate ??
                        signal.sample_frequency ??
                        signal.frequency
                ) || 1;

            const label =
                signal.label ??
                signal.name ??
                signal.signalLabel ??
                `Channel ${index + 1}`;

            const unit =
                signal.unit ??
                signal.physicalDimension ??
                signal.dimension;

            if (!Array.isArray(samples)) {
                return null;
            }

            return {
                label: String(label),
                samples: samples.map(Number),
                sampleRate,
                unit: unit
                    ? String(unit)
                    : undefined,
            };
        })
        .filter(
            (signal): signal is EDFSignal =>
                signal !== null &&
                signal.samples.length > 0
        );

    return { signals };
}