"use client"

import { useState, useCallback } from "react"
import { Upload, Video, X, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"

interface VideoUploadProps {
  onUpload: (file: File) => void
  isAnalyzing: boolean
}

export function VideoUpload({ onUpload, isAnalyzing }: VideoUploadProps) {
  const [dragActive, setDragActive] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true)
    } else if (e.type === "dragleave") {
      setDragActive(false)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0]
      if (file.type.startsWith("video/")) {
        setSelectedFile(file)
        setPreview(URL.createObjectURL(file))
      }
    }
  }, [])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault()
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0]
      setSelectedFile(file)
      setPreview(URL.createObjectURL(file))
    }
  }, [])

  const handleRemove = useCallback(() => {
    setSelectedFile(null)
    if (preview) {
      URL.revokeObjectURL(preview)
      setPreview(null)
    }
  }, [preview])

  const handleAnalyze = useCallback(() => {
    if (selectedFile) {
      onUpload(selectedFile)
    }
  }, [selectedFile, onUpload])

  return (
    <div className="w-full max-w-2xl mx-auto">
      {!selectedFile ? (
        <Card
          className={cn(
            "relative border-2 border-dashed transition-all duration-300 cursor-pointer",
            "hover:border-primary/50 hover:bg-primary/5",
            dragActive && "border-primary bg-primary/10",
            "p-12"
          )}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
        >
          <input
            type="file"
            accept="video/*"
            onChange={handleChange}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="p-4 rounded-full bg-primary/10">
              <Upload className="w-8 h-8 text-primary" />
            </div>
            <div>
              <p className="text-lg font-medium text-foreground">
                Drop your video here
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                or click to browse
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              Supports MP4, MOV, AVI, WebM
            </p>
          </div>
        </Card>
      ) : (
        <Card className="p-6">
          <div className="flex flex-col gap-4">
            <div className="relative aspect-video rounded-lg overflow-hidden bg-secondary">
              {preview && (
                <video
                  src={preview}
                  className="w-full h-full object-contain"
                  controls
                />
              )}
              <button
                onClick={handleRemove}
                className="absolute top-2 right-2 p-1.5 rounded-full bg-background/80 hover:bg-background transition-colors"
                disabled={isAnalyzing}
              >
                <X className="w-4 h-4 text-foreground" />
              </button>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Video className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground truncate max-w-xs">
                    {selectedFile.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB
                  </p>
                </div>
              </div>
              <Button onClick={handleAnalyze} disabled={isAnalyzing}>
                {isAnalyzing ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Analyzing...
                  </>
                ) : (
                  "Analyze Video"
                )}
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}
