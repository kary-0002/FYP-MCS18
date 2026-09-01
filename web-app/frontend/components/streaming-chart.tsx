"use client";

import { useEffect, useRef, useState } from "react";
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    ChartOptions,
} from "chart.js";
import { Line } from "react-chartjs-2";

ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend
);

export default function StreamingChart() {
    // ==========================================
    // State
    // ==========================================

    const [numbers, setNumbers] = useState<number[]>([]);
    const [streamedData, setStreamedData] = useState<number[]>([]);
    const [isStreaming, setIsStreaming] = useState(false);

    // Delay between streamed values
    const [speed, setSpeed] = useState(6);

    // Reference to the scrollable chart container
    const chartScrollRef = useRef<HTMLDivElement>(null);

    // Keeps track of which number we're streaming
    const streamIndex = useRef(0);

    // ==========================================
    // Calculate Y-axis range
    // ==========================================

    const dataMin =
        numbers.length > 0
            ? Math.min(...numbers)
            : 0;

    const dataMax =
        numbers.length > 0
            ? Math.max(...numbers)
            : 100;

    // Add 10% padding
    const range = dataMax - dataMin;

    const padding = range === 0
        ? Math.max(Math.abs(dataMin) * 0.1, 1)
        : range * 0.1;

    const yMin = dataMin - padding;
    const yMax = dataMax + padding;

    // ==========================================
    // File upload
    // ==========================================

    const handleFileUpload = (
        event: React.ChangeEvent<HTMLInputElement>
    ) => {
        const file = event.target.files?.[0];

        if (!file) return;

        const reader = new FileReader();

        reader.onload = (e) => {
            const text = e.target?.result;

            if (typeof text !== "string") return;

            const parsedNumbers = text
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter((line) => line !== "")
                .map(Number)
                .filter((value) => Number.isFinite(value));

            setNumbers(parsedNumbers);
            setStreamedData([]);

            streamIndex.current = 0;
            setIsStreaming(false);
        };

        reader.readAsText(file);
    };

    // ==========================================
    // Start streaming
    // ==========================================

    const startStreaming = () => {
        if (numbers.length === 0) return;

        setStreamedData([]);

        streamIndex.current = 0;

        setIsStreaming(true);
    };

    // ==========================================
    // Stop streaming
    // ==========================================

    const stopStreaming = () => {
        setIsStreaming(false);
    };

    // ==========================================
    // Streaming simulation
    // ==========================================

    useEffect(() => {
        if (!isStreaming) return;

        // We've reached the end of the file
        if (streamIndex.current >= numbers.length) {
            setIsStreaming(false);
            return;
        }

        const timer = setTimeout(() => {
            const nextValue =
                numbers[streamIndex.current];

            setStreamedData((previous) => [
                ...previous,
                nextValue,
            ]);

            streamIndex.current++;
        }, speed);

        return () => {
            clearTimeout(timer);
        };
    }, [
        isStreaming,
        streamedData,
        numbers,
        speed,
    ]);

    // ==========================================
    // Automatically scroll to newest point
    // ==========================================

    useEffect(() => {
        const container = chartScrollRef.current;

        if (!container) return;

        container.scrollLeft =
            container.scrollWidth -
            container.clientWidth;
    }, [streamedData]);

    // ==========================================
    // Chart data
    // ==========================================

    const SAMPLE_RATE = 173.61;

    const chartData = {
        datasets: [
            {
                label: "Streamed value",

                data: streamedData.map((value, index) => ({
                    x: index / SAMPLE_RATE,
                    y: value,
                })),

                borderColor: "#3b82f6",
                borderWidth: 2,

                pointRadius: 2,
                pointHoverRadius: 5,

                tension: 0.2,
            },
        ],
    };

    // ==========================================
    // Chart options
    // ==========================================

    const chartOptions: ChartOptions<"line"> = {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,

        scales: {
            x: {
                type: "linear",

                title: {
                    display: true,
                    text: "Time (seconds)",
                    color: "#fff",
                },

                ticks: {
                    color: "#aaa",

                    // Display seconds with 1 decimal place
                    callback: (value) => {
                        return `${Number(value).toFixed(1)}s`;
                    },
                },

                grid: {
                    color: "rgba(255, 255, 255, 0.08)",
                },
            },

            y: {
                min: yMin,
                max: yMax,

                ticks: {
                    color: "#fff",
                },

                grid: {
                    color: "rgba(255, 255, 255, 0.1)",
                },

                title: {
                    display: true,
                    text: "Value",
                    color: "#fff",
                },
            },
        },
    };

    const elapsedSeconds =
    streamedData.length / SAMPLE_RATE;

    const chartWidth = Math.max(
        800,
        elapsedSeconds * 200
    );

    // ==========================================
    // Render
    // ==========================================

    return (
        <div
            style={{
                width: "100%",
                maxWidth: "1200px",
                margin: "0 auto",
                padding: "24px",

                backgroundColor: "#111",
                color: "white",

                borderRadius: "12px",

                boxSizing: "border-box",
            }}
        >
            {/* ================================= */}
            {/* Header */}
            {/* ================================= */}

            <h2
                style={{
                    marginTop: 0,
                    marginBottom: "20px",
                }}
            >
                Data Streaming Simulator
            </h2>

            {/* ================================= */}
            {/* File upload */}
            {/* ================================= */}

            <div
                style={{
                    marginBottom: "20px",
                }}
            >
                <label
                    htmlFor="file-upload"
                    style={{
                        display: "block",
                        marginBottom: "8px",
                    }}
                >
                    Select TXT file
                </label>

                <input
                    id="file-upload"
                    type="file"
                    accept=".txt"
                    onChange={handleFileUpload}
                />
            </div>

            {/* ================================= */}
            {/* File information */}
            {/* ================================= */}

            {numbers.length > 0 && (
                <div
                    style={{
                        display: "flex",
                        gap: "24px",
                        marginBottom: "20px",

                        fontSize: "14px",

                        color: "#ccc",
                    }}
                >
                    <span>
                        Points:{" "}
                        <strong>
                            {numbers.length}
                        </strong>
                    </span>

                    <span>
                        Min:{" "}
                        <strong>
                            {dataMin}
                        </strong>
                    </span>

                    <span>
                        Max:{" "}
                        <strong>
                            {dataMax}
                        </strong>
                    </span>
                </div>
            )}

            {/* ================================= */}
            {/* Streaming controls */}
            {/* ================================= */}

            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "16px",

                    marginBottom: "24px",

                    flexWrap: "wrap",
                }}
            >
                <button
                    onClick={startStreaming}
                    disabled={
                        numbers.length === 0 ||
                        isStreaming
                    }
                    style={{
                        padding: "8px 16px",

                        border: "none",
                        borderRadius: "6px",

                        cursor:
                            numbers.length === 0 ||
                            isStreaming
                                ? "not-allowed"
                                : "pointer",

                        backgroundColor:
                            numbers.length === 0 ||
                            isStreaming
                                ? "#444"
                                : "#2563eb",

                        color: "white",
                    }}
                >
                    Start
                </button>

                <button
                    onClick={stopStreaming}
                    disabled={!isStreaming}
                    style={{
                        padding: "8px 16px",

                        border: "none",
                        borderRadius: "6px",

                        cursor:
                            !isStreaming
                                ? "not-allowed"
                                : "pointer",

                        backgroundColor:
                            !isStreaming
                                ? "#444"
                                : "#dc2626",

                        color: "white",
                    }}
                >
                    Stop
                </button>

                {/* Speed */}
                <label
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                    }}
                >
                    Speed:

                    <input
                        type="range"
                        min="10"
                        max="1000"
                        step="10"
                        value={speed}
                        onChange={(e) =>
                            setSpeed(
                                Number(
                                    e.target.value
                                )
                            )
                        }
                    />

                    <span
                        style={{
                            minWidth: "60px",
                        }}
                    >
                        {speed} ms
                    </span>
                </label>
            </div>

            {/* ================================= */}
            {/* Streaming progress */}
            {/* ================================= */}

            {numbers.length > 0 && (
                <div
                    style={{
                        marginBottom: "12px",

                        color: "#aaa",

                        fontSize: "14px",
                    }}
                >
                    Streaming{" "}
                    <strong>
                        {streamedData.length}
                    </strong>{" "}
                    / {numbers.length}
                </div>
            )}

            {/* ================================= */}
            {/* Chart */}
            {/* ================================= */}

            <div
                ref={chartScrollRef}
                style={{
                    width: "100%",

                    height: "400px",

                    overflowX: "auto",
                    overflowY: "hidden",

                    backgroundColor: "#181818",

                    borderRadius: "8px",
                }}
            >
                <div
    style={{
        width: `${chartWidth}px`,
        height: "100%",
    }}
>
    <Line
        data={chartData}
        options={chartOptions}
    />
</div>
            </div>
        </div>
    );
}