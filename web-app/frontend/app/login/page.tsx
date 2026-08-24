import { Suspense } from "react";
import { Header } from "@/components/header";
import { AuthForm } from "@/components/auth-form";

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-16">
        <Suspense>
          <AuthForm mode="login" />
        </Suspense>
      </main>
    </div>
  );
}
