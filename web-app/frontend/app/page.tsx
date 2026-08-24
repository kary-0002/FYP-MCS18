"use client";

import { useRouter } from "next/navigation";
import { Header } from "@/components/header";
import { Sparkles, Zap, Shield, BarChart3, RotateCcw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const features = [
  {
    icon: Zap,
    title: "View EDF files",
    description: "Open EEG recordings in .edf format and inspect channels in the browser",
  },
  {
    icon: Shield,
    title: "Annotate signals",
    description: "Mark events on EEG traces to support review and teaching",
  },
  {
    icon: BarChart3,
    title: "Feedback recommendations",
    description: "Use a pre-trained model based on the Siena EEG public dataset",
  },
];

export default function Home() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-background">
      <Header />

      <main className="container mx-auto px-4 py-12">
        <div className="space-y-16">
          <div className="text-center max-w-3xl mx-auto">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-sm mb-6">
              <Sparkles className="w-4 h-4" />
              <span>Annotation</span>
            </div>
            <h1 className="text-4xl md:text-5xl font-bold text-foreground mb-4 text-balance">
              EEG Annotator and Feedback Recommendation
            </h1>
            <p className="text-lg text-muted-foreground text-pretty">
              Upload EDF files, view them, annotate and get feedback
              recommendations
            </p>
          </div>

          <div className="flex items-center justify-center gap-3">
            <Button onClick={() => router.push("/canvas")} className="gap-2">
              <RotateCcw className="w-4 h-4" />
              Go to Canvas
            </Button>
            <Button onClick={() => router.push("/edf-reader")} className="gap-2">
              <RotateCcw className="w-4 h-4" />
              EDF Reader
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
            {features.map((feature) => (
              <Card key={feature.title} className="p-6 text-center">
                <div className="inline-flex p-3 rounded-lg bg-primary/10 mb-4">
                  <feature.icon className="w-6 h-6 text-primary" />
                </div>
                <h3 className="font-semibold text-foreground mb-2">
                  {feature.title}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {feature.description}
                </p>
              </Card>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
