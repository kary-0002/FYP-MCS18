"use client"

import { ArrowLeft, Clock, TrendingUp, AlertCircle, CheckCircle2, Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"

export interface PatternResult {
  id: string
  timestamp: string
  timestampSeconds: number
  pattern: string
  confidence: number
  category: string
}

interface AnalysisResultsProps {
  results: PatternResult[]
  videoName: string
  videoUrl: string | null
  onBack: () => void
}

function getConfidenceColor(confidence: number) {
  if (confidence >= 90) return "text-emerald-400"
  if (confidence >= 70) return "text-chart-4"
  if (confidence >= 50) return "text-chart-5"
  return "text-destructive"
}

function getConfidenceBg(confidence: number) {
  if (confidence >= 90) return "bg-emerald-400/10"
  if (confidence >= 70) return "bg-chart-4/10"
  if (confidence >= 50) return "bg-chart-5/10"
  return "bg-destructive/10"
}

function getConfidenceIcon(confidence: number) {
  if (confidence >= 70) return CheckCircle2
  return AlertCircle
}

export function AnalysisResults({ results, videoName, videoUrl, onBack }: AnalysisResultsProps) {
  const averageConfidence = results.length > 0
    ? Math.round(results.reduce((acc, r) => acc + r.confidence, 0) / results.length)
    : 0

  const highConfidenceCount = results.filter(r => r.confidence >= 70).length

  return (
    <div className="w-full max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div>
          <h2 className="text-2xl font-bold text-foreground">Analysis Results</h2>
          <p className="text-sm text-muted-foreground">{videoName}</p>
        </div>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <TrendingUp className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{results.length}</p>
              <p className="text-xs text-muted-foreground">Patterns Detected</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-400/10">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{highConfidenceCount}</p>
              <p className="text-xs text-muted-foreground">High Confidence</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className={cn("p-2 rounded-lg", getConfidenceBg(averageConfidence))}>
              <TrendingUp className={cn("w-5 h-5", getConfidenceColor(averageConfidence))} />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{averageConfidence}%</p>
              <p className="text-xs text-muted-foreground">Avg. Confidence</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Video Preview */}
      {videoUrl && (
        <Card className="p-4 mb-8">
          <div className="aspect-video rounded-lg overflow-hidden bg-secondary">
            <video
              src={videoUrl}
              className="w-full h-full object-contain"
              controls
            />
          </div>
        </Card>
      )}

      {/* Results Table */}
      <Card className="overflow-hidden">
        <div className="p-4 border-b border-border">
          <h3 className="font-semibold text-foreground">Detected Patterns</h3>
          <p className="text-sm text-muted-foreground">Click on a timestamp to jump to that moment in the video</p>
        </div>
        <div className="divide-y divide-border">
          {results.map((result) => {
            const Icon = getConfidenceIcon(result.confidence)
            return (
              <div
                key={result.id}
                className="p-4 hover:bg-secondary/50 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 transition-colors">
                      <Play className="w-3 h-3 text-primary" />
                      <span className="text-sm font-mono text-primary">{result.timestamp}</span>
                    </button>
                    <div>
                      <p className="font-medium text-foreground">{result.pattern}</p>
                      <p className="text-xs text-muted-foreground">{result.category}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Icon className={cn("w-4 h-4", getConfidenceColor(result.confidence))} />
                    <div className={cn(
                      "px-3 py-1 rounded-full text-sm font-medium",
                      getConfidenceBg(result.confidence),
                      getConfidenceColor(result.confidence)
                    )}>
                      {result.confidence}%
                    </div>
                  </div>
                </div>
                {/* Confidence Bar */}
                <div className="mt-3 h-1.5 bg-secondary rounded-full overflow-hidden">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all duration-500",
                      result.confidence >= 90 ? "bg-emerald-400" :
                      result.confidence >= 70 ? "bg-chart-4" :
                      result.confidence >= 50 ? "bg-chart-5" : "bg-destructive"
                    )}
                    style={{ width: `${result.confidence}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </Card>
    </div>
  )
}
