"use client"

import StreamingChart from "@/components/streaming-chart";
import { useRouter } from "next/navigation"
import { Header } from "@/components/header"
import { RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import React, { Ref } from "react"
import Chart from 'chart.js/auto';
import type { ChartData, ChartOptions } from 'chart.js';
import { getRelativePosition } from 'chart.js/helpers';

const SAMPLE_EEG_DATASET_PATH = "../../../../dataset/s/S001.txt";

export default function CanvasPage() {
  const router = useRouter()

  const handleAnalyzeAnother = () => {
    // Clear stored data
    localStorage.removeItem("analysisVideoName")
    localStorage.removeItem("analysisVideoUrl")
    router.push("/")
  }

  return (
    <div className="app-layout min-h-screen bg-background">
      <Header />
      
      <main className="container mx-auto px-4 pb-12">
        <div className="w-full max-w-4xl mx-auto">
          <div className="flex items-center justify-between mb-8">
            <h1>This is the Canvas Page</h1>        
          </div>
          <StreamingChart />
          
          {/* Bottom CTA */}
          <div className="mt-8 text-center">
            <p className="text-muted-foreground mb-4">Want to analyze more videos?</p>
            <Button onClick={handleAnalyzeAnother} variant="outline" size="lg" className="gap-2">
              <RotateCcw className="w-4 h-4" />
              Analyze Another Video
            </Button>
          </div>
        </div>
      </main>
    </div>
  )
}
