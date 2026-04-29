"use client"

import { useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Upload, Video, X, Play, Loader2, Scan } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"

export function VideoUploader() {
  const router = useRouter()
  const [isDragging, setIsDragging] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const droppedFile = e.dataTransfer.files[0]
    if (droppedFile && droppedFile.type.startsWith("video/")) {
      setFile(droppedFile)
    }
  }, [])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile && selectedFile.type.startsWith("video/")) {
      setFile(selectedFile)
    }
  }

  const handleAnalyze = async () => {
    if (!file) return
    setIsAnalyzing(true)
    // Simulate analysis delay
    await new Promise((resolve) => setTimeout(resolve, 2500))
    router.push("/results")
  }

  const removeFile = () => {
    setFile(null)
  }

  return (
    <div className="space-y-6">
      <Card
        className={cn(
          "border-2 border-dashed transition-all duration-300 cursor-pointer",
          isDragging
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/50 hover:bg-card/80",
          file && "border-solid border-accent"
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <label className="block p-12 cursor-pointer">
          <input
            type="file"
            accept="video/*"
            onChange={handleFileChange}
            className="hidden"
          />
          {!file ? (
            <div className="flex flex-col items-center gap-4">
              <div className="w-20 h-20 rounded-2xl bg-secondary flex items-center justify-center">
                <Upload className="w-10 h-10 text-muted-foreground" />
              </div>
              <div className="text-center">
                <p className="text-lg font-medium text-foreground">
                  Drop your video here
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  or click to browse files
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Video className="w-4 h-4" />
                <span>Supports MP4, MOV, AVI, WebM</span>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-xl bg-accent/10 flex items-center justify-center">
                <Play className="w-8 h-8 text-accent" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-foreground font-medium truncate">{file.name}</p>
                <p className="text-sm text-muted-foreground">
                  {(file.size / (1024 * 1024)).toFixed(2)} MB
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.preventDefault()
                  removeFile()
                }}
                className="shrink-0"
              >
                <X className="w-5 h-5" />
              </Button>
            </div>
          )}
        </label>
      </Card>

      <Button
        onClick={handleAnalyze}
        disabled={!file || isAnalyzing}
        className="w-full h-12 text-base font-medium"
        size="lg"
      >
        {isAnalyzing ? (
          <>
            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
            Analyzing Video...
          </>
        ) : (
          <>
            <Scan className="w-5 h-5 mr-2" />
            Analyze Patterns
          </>
        )}
      </Button>
    </div>
  )
}
