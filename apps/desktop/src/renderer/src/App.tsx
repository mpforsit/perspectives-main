import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import { trpc } from "./trpc/client";

const THEME_STORAGE_KEY = "perspectives:theme";

type Theme = "light" | "dark";

function readInitialTheme(): Theme {
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function useTheme(): readonly [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(readInitialTheme);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const toggle = () => setTheme((current) => (current === "dark" ? "light" : "dark"));
  return [theme, toggle] as const;
}

function StatusBlock() {
  const ping = trpc.health.ping.useQuery();

  if (ping.isPending) {
    return <p className="text-base text-muted-foreground">Engine: connecting…</p>;
  }
  if (ping.isError) {
    return (
      <p className="text-base text-destructive">
        Engine: error — {ping.error.message}
      </p>
    );
  }
  return <p className="text-base">Engine: online v{ping.data.version}</p>;
}

export function App() {
  const [theme, toggleTheme] = useTheme();

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background p-6">
      <Button
        variant="ghost"
        size="icon"
        onClick={toggleTheme}
        aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        className="absolute right-4 top-4"
      >
        {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
      </Button>

      <StatusBlock />
    </div>
  );
}
