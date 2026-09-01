import { Header } from "@/components/header"
import { ResultsDisplay } from "@/components/results-display"

export default function ResultsPage() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-6 py-12">
        <div className="max-w-4xl mx-auto">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-foreground mb-2">Analysis Results</h1>
            <p className="text-muted-foreground">
              Detected patterns and timestamps from your video analysis
            </p>
          </div>
          <ResultsDisplay />
        </div>
      </main>
    </div>
  )
}
