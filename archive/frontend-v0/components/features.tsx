import { Zap, Shield, BarChart3 } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"

const features = [
  {
    icon: Zap,
    title: "Real-time Analysis",
    description: "Process videos quickly with our optimized AI pipeline",
  },
  {
    icon: Shield,
    title: "High Accuracy",
    description: "Confidence scores backed by advanced pattern detection",
  },
  {
    icon: BarChart3,
    title: "Detailed Reports",
    description: "Get timestamped results with actionable insights",
  },
]

export function Features() {
  return (
    <div className="grid md:grid-cols-3 gap-4">
      {features.map((feature) => (
        <Card key={feature.title} className="bg-card/50 border-border/50">
          <CardContent className="pt-6">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
              <feature.icon className="w-5 h-5 text-primary" />
            </div>
            <h3 className="font-semibold text-foreground mb-1">{feature.title}</h3>
            <p className="text-sm text-muted-foreground">{feature.description}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
