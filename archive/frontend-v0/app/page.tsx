import { Header } from "@/components/header"
import { VideoUploader } from "@/components/video-uploader"
import { Features } from "@/components/features"

export default function HomePage() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-6 py-12">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-10">
            <span className="inline-block px-3 py-1 text-xs font-medium text-primary bg-primary/10 rounded-full mb-4">
              AI-Powered Analysis
            </span>
            <h1 className="text-4xl md:text-5xl font-bold text-foreground mb-4 text-balance">
              Video Pattern Recognition
            </h1>
            <p className="text-lg text-muted-foreground text-pretty">
              Upload your video and let our AI detect patterns, anomalies, and key moments with precise timestamps.
            </p>
          </div>

          <VideoUploader />

          <div className="mt-16">
            <Features />
          </div>
        </div>
      </main>
    </div>
  )
}
