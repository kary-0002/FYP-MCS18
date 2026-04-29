"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Button } from "@/components/ui/button"
import { Clock, AlertTriangle, CheckCircle2, Eye, Download, ArrowLeft } from "lucide-react"
import Link from "next/link"
import { cn } from "@/lib/utils"

// Mock data for detected patterns
const detectedPatterns = [
  {
    id: 1,
    timestamp: "00:00:12",
    timestampSeconds: 12,
    pattern: "Motion Detection",
    description: "Rapid movement detected in frame center",
    confidence: 94,
    severity: "high",
  },
  {
    id: 2,
    timestamp: "00:00:45",
    timestampSeconds: 45,
    pattern: "Object Recognition",
    description: "Vehicle identified entering scene",
    confidence: 87,
    severity: "medium",
  },
  {
    id: 3,
    timestamp: "00:01:23",
    timestampSeconds: 83,
    pattern: "Anomaly Detection",
    description: "Unusual activity pattern in monitored zone",
    confidence: 76,
    severity: "high",
  },
  {
    id: 4,
    timestamp: "00:02:05",
    timestampSeconds: 125,
    pattern: "Face Detection",
    description: "Human presence confirmed",
    confidence: 92,
    severity: "low",
  },
  {
    id: 5,
    timestamp: "00:02:34",
    timestampSeconds: 154,
    pattern: "Gesture Recognition",
    description: "Hand gesture detected",
    confidence: 68,
    severity: "low",
  },
  {
    id: 6,
    timestamp: "00:03:18",
    timestampSeconds: 198,
    pattern: "Scene Change",
    description: "Significant lighting change detected",
    confidence: 89,
    severity: "medium",
  },
]

const stats = {
  totalPatterns: detectedPatterns.length,
  avgConfidence: Math.round(
    detectedPatterns.reduce((acc, p) => acc + p.confidence, 0) / detectedPatterns.length
  ),
  highSeverity: detectedPatterns.filter((p) => p.severity === "high").length,
  videoDuration: "03:45",
}

function getConfidenceColor(confidence: number) {
  if (confidence >= 85) return "text-accent"
  if (confidence >= 70) return "text-chart-3"
  return "text-muted-foreground"
}

function getSeverityBadge(severity: string) {
  switch (severity) {
    case "high":
      return (
        <Badge variant="destructive" className="text-xs">
          <AlertTriangle className="w-3 h-3 mr-1" />
          High Priority
        </Badge>
      )
    case "medium":
      return (
        <Badge variant="secondary" className="text-xs bg-chart-3/20 text-chart-3 hover:bg-chart-3/30">
          <Eye className="w-3 h-3 mr-1" />
          Medium
        </Badge>
      )
    default:
      return (
        <Badge variant="secondary" className="text-xs">
          <CheckCircle2 className="w-3 h-3 mr-1" />
          Low
        </Badge>
      )
  }
}

export function ResultsDisplay() {
  return (
    <div className="space-y-6">
      {/* Stats Overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-card/50">
          <CardContent className="pt-6">
            <p className="text-2xl font-bold text-foreground">{stats.totalPatterns}</p>
            <p className="text-sm text-muted-foreground">Patterns Detected</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50">
          <CardContent className="pt-6">
            <p className="text-2xl font-bold text-accent">{stats.avgConfidence}%</p>
            <p className="text-sm text-muted-foreground">Avg. Confidence</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50">
          <CardContent className="pt-6">
            <p className="text-2xl font-bold text-destructive">{stats.highSeverity}</p>
            <p className="text-sm text-muted-foreground">High Priority</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50">
          <CardContent className="pt-6">
            <p className="text-2xl font-bold text-foreground">{stats.videoDuration}</p>
            <p className="text-sm text-muted-foreground">Video Duration</p>
          </CardContent>
        </Card>
      </div>

      {/* Patterns List */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg font-semibold">Detected Patterns</CardTitle>
          <Button variant="outline" size="sm">
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {detectedPatterns.map((pattern) => (
              <div
                key={pattern.id}
                className="flex items-start gap-4 p-4 rounded-lg bg-secondary/50 hover:bg-secondary/80 transition-colors"
              >
                <div className="shrink-0 w-20 text-center">
                  <div className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-primary/10 text-primary text-sm font-mono">
                    <Clock className="w-3 h-3" />
                    {pattern.timestamp}
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-medium text-foreground">{pattern.pattern}</h3>
                    {getSeverityBadge(pattern.severity)}
                  </div>
                  <p className="text-sm text-muted-foreground">{pattern.description}</p>
                </div>
                <div className="shrink-0 w-24 text-right">
                  <p className={cn("text-lg font-bold", getConfidenceColor(pattern.confidence))}>
                    {pattern.confidence}%
                  </p>
                  <Progress value={pattern.confidence} className="h-1.5 mt-1" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex items-center justify-between pt-4">
        <Button variant="ghost" asChild>
          <Link href="/">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Analyze Another Video
          </Link>
        </Button>
        <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
          Generate Full Report
        </Button>
      </div>
    </div>
  )
}
