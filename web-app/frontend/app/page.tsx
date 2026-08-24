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
    <div className="app-layout min-h-screen bg-background">
      <Header />

      <main className="px-4 pb-12">
        <div className="space-y-14">
          <div className="cut-panel border border-border bg-card px-6 py-14 text-center md:px-12">
            <div className="section-kicker justify-center"><Sparkles className="w-3.5 h-3.5" /><span>EEG workspace</span></div>
            <h1 className="mx-auto max-w-3xl text-4xl font-bold tracking-tight text-foreground md:text-6xl text-balance">
              EEG Annotator and Feedback Recommendation
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-lg text-muted-foreground text-pretty">
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
              <Card key={feature.title} className="group p-6 text-center transition-transform duration-200 hover:-translate-y-1 hover:border-primary/60">
                <div className="mb-4 flex h-12 w-full items-center justify-center gap-2 border border-primary/30 bg-primary/10 px-3 transition-colors group-hover:bg-primary/20">
                  <feature.icon className="w-6 h-6 text-primary" />
                  <h3 className="font-semibold text-foreground">
                    {feature.title}
                  </h3>
                </div>
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
