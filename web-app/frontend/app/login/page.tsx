import { Suspense } from "react";
import { Header } from "@/components/header";
import { AuthForm } from "@/components/auth-form";

export default function LoginPage() {
  return (
    <div className="app-layout min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 pb-16">
        <Suspense>
          <AuthForm mode="login" />
        </Suspense>
      </main>
    </div>
  );
}
