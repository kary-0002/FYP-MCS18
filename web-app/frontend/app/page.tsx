"use client"

import { useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Header } from "@/components/header"
import { VideoUpload } from "@/components/video-upload"
import { AnalyzingState } from "@/components/analyzing-state"
import { Sparkles, Zap, Shield, BarChart3 } from "lucide-react"
import { Card } from "@/components/ui/card"

const features = [
  {
    icon: Zap,
    title: "Fast Analysis",
    description: "Process videos in seconds with our optimized AI pipeline"
  },
  {
    icon: Shield,
    title: "Accurate Detection",
    description: "State-of-the-art models ensure high confidence results"
  },
  {
    icon: BarChart3,
    title: "Detailed Reports",
    description: "Get timestamps and confidence levels for every pattern"
  }
]

export default function Home() {
  const router = useRouter()
  const [isAnalyzing, setIsAnalyzing] = useState(false)

  const handleUpload = useCallback((file: File) => {
    // Store video info in localStorage for the results page
    localStorage.setItem("analysisVideoName", file.name)
    localStorage.setItem("analysisVideoUrl", URL.createObjectURL(file))
    
    setIsAnalyzing(true)

    // Simulate analysis time then redirect to results
    setTimeout(() => {
      router.push("/results")
    }, 5000)
  }, [router])

  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      <main className="container mx-auto px-4 py-12">
        {!isAnalyzing ? (
          <div className="space-y-16">
            {/* Hero Section */}
            <div className="text-center max-w-3xl mx-auto">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-sm mb-6">
                <Sparkles className="w-4 h-4" />
                <span>AI-Powered Video Analysis</span>
              </div>
              <h1 className="text-4xl md:text-5xl font-bold text-foreground mb-4 text-balance">
                Detect Patterns in Your Videos with AI
              </h1>
              <p className="text-lg text-muted-foreground text-pretty">
                Upload your video and let our advanced AI analyze it for patterns, 
                anomalies, and objects. Get detailed timestamps and confidence scores instantly.
              </p>
            </div>

            {/* Upload Section */}
            <VideoUpload onUpload={handleUpload} isAnalyzing={false} />

            {/* Features Section */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
              {features.map((feature, index) => (
                <Card key={index} className="p-6 text-center">
                  <div className="inline-flex p-3 rounded-lg bg-primary/10 mb-4">
                    <feature.icon className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="font-semibold text-foreground mb-2">{feature.title}</h3>
                  <p className="text-sm text-muted-foreground">{feature.description}</p>
                </Card>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center min-h-[60vh]">
            <AnalyzingState />
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-border mt-16">
        <div className="container mx-auto px-4 py-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-sm text-muted-foreground">
              © 2026 PatternAI. All rights reserved.
            </p>
            <div className="flex items-center gap-6">
              <a href="#" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                Privacy
              </a>
              <a href="#" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                Terms
              </a>
              <a href="#" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                Contact
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
