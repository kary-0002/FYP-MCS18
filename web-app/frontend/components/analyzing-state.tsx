"use client"

import { useEffect, useState } from "react"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"

const analysisSteps = [
  "Extracting video frames...",
  "Processing video data...",
  "Running pattern detection...",
  "Analyzing temporal sequences...",
  "Computing confidence scores...",
  "Generating results..."
]

export function AnalyzingState() {
  const [currentStep, setCurrentStep] = useState(0)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    const stepInterval = setInterval(() => {
      setCurrentStep((prev) => (prev + 1) % analysisSteps.length)
    }, 2000)

    const progressInterval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 95) return prev
        return prev + Math.random() * 3
      })
    }, 200)

    return () => {
      clearInterval(stepInterval)
      clearInterval(progressInterval)
    }
  }, [])

  return (
    <Card className="w-full max-w-md mx-auto p-8">
      <div className="flex flex-col items-center gap-6">
        {/* Animated Logo */}
        <div className="relative">
          <div className="w-20 h-20 rounded-full border-4 border-primary/20" />
          <div className="absolute inset-0 w-20 h-20 rounded-full border-4 border-transparent border-t-primary animate-spin" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-8 h-8 rounded-full bg-primary/20 animate-pulse" />
          </div>
        </div>

        {/* Status Text */}
        <div className="text-center">
          <h3 className="text-lg font-semibold text-foreground mb-2">
            Analyzing Video
          </h3>
          <p className="text-sm text-muted-foreground h-5 transition-all duration-300">
            {analysisSteps[currentStep]}
          </p>
        </div>

        {/* Progress Bar */}
        <div className="w-full">
          <div className="flex justify-between text-xs text-muted-foreground mb-2">
            <span>Progress</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <div className="h-2 bg-secondary rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Step Indicators */}
        <div className="flex gap-2">
          {analysisSteps.map((_, index) => (
            <div
              key={index}
              className={cn(
                "w-2 h-2 rounded-full transition-all duration-300",
                index === currentStep ? "bg-primary scale-125" : 
                index < currentStep ? "bg-primary/50" : "bg-secondary"
              )}
            />
          ))}
        </div>
      </div>
    </Card>
  )
}
