"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Scan } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

export function Header() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    let supabase;
    try {
      supabase = createClient();
    } catch {
      return;
    }

    supabase.auth.getUser().then(({ data }) => setUser(data.user));

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    setUser(null);
    router.push("/");
    router.refresh();
  }

  return (
    <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-primary/10">
            <Scan className="w-5 h-5 text-primary" />
          </div>
          <span className="font-bold text-lg text-foreground">SeizureAI</span>
        </Link>
        <nav className="flex items-center gap-4">
          <Link
            href="/edf-reader"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            EDF Viewer
          </Link>
          <Link
            href="/files"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            My files
          </Link>
          {user ? (
            <>
              <span className="hidden sm:inline text-sm text-muted-foreground max-w-48 truncate">
                {user.email}
              </span>
              <Button variant="outline" size="sm" onClick={handleSignOut}>
                Sign out
              </Button>
            </>
          ) : (
            <Button asChild size="sm">
              <Link href="/login">Sign in</Link>
            </Button>
          )}
        </nav>
      </div>
    </header>
  );
}
