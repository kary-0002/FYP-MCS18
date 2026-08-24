"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Activity, FileText, LogOut, Moon, PanelLeftClose, PanelLeftOpen, Scan, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const navigation = [
  { href: "/edf-reader", label: "EDF Viewer", icon: Activity },
  { href: "/files", label: "My files", icon: FileText },
];

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <Button variant="ghost" size="icon" className="border border-border text-muted-foreground hover:border-primary hover:text-primary" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label="Toggle colour theme" title="Toggle light and dark mode">
      <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
    </Button>
  );
}

export function Header() {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

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

  useEffect(() => {
    const savedState = window.localStorage.getItem("sidebar-collapsed");
    setSidebarCollapsed(savedState === "true");
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("sidebar-collapsed", sidebarCollapsed);
    window.localStorage.setItem("sidebar-collapsed", String(sidebarCollapsed));
    return () => document.documentElement.classList.remove("sidebar-collapsed");
  }, [sidebarCollapsed]);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    setUser(null);
    router.push("/");
    router.refresh();
  }

  return (
    <>
      <aside className="app-rail hidden md:flex">
        <p className="rail-label">Workspace</p>
        <nav className="space-y-1" aria-label="Main navigation">
          {navigation.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className={cn("rail-link", pathname === href && "rail-link-active")}><Icon className="h-4 w-4" />{label}</Link>
          ))}
        </nav>
        <div className="mt-auto border-t border-sidebar-border pt-5 text-xs leading-relaxed text-muted-foreground">Secure workspace for EEG review, annotation, and feedback.</div>
      </aside>
      <header className="app-topbar">
        <Link href="/" className="brand-mark"><span className="brand-icon"><Scan className="h-4 w-4" /></span><span>Seizure<span className="text-primary">AI</span></span></Link>
        <Button variant="ghost" size="icon" className="ml-3 hidden border border-border text-muted-foreground hover:border-primary hover:text-primary md:inline-flex" onClick={() => setSidebarCollapsed((collapsed) => !collapsed)} aria-label={sidebarCollapsed ? "Open sidebar" : "Close sidebar"} title={sidebarCollapsed ? "Open sidebar" : "Close sidebar"}>
          {sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          {user ? <><span className="hidden max-w-48 truncate text-sm text-muted-foreground lg:inline">{user.email}</span><Button variant="outline" size="sm" onClick={handleSignOut} className="border-border hover:border-primary"><LogOut className="h-3.5 w-3.5" /><span className="hidden sm:inline">Sign out</span></Button></> : <Button asChild><Link href="/login">Sign in</Link></Button>}
        </div>
      </header>
    </>
  );
}
