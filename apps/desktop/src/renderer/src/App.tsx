import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConnectionsView } from "./connections/ConnectionsView";
import { GridHarness } from "./grid/GridHarness";
import { SessionView } from "./session/SessionView";
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

function EngineStatus() {
  const ping = trpc.health.ping.useQuery();
  if (ping.isPending) {
    return <span className="text-muted-foreground">Engine: connecting…</span>;
  }
  if (ping.isError) {
    return (
      <span className="text-destructive">Engine: error — {ping.error.message}</span>
    );
  }
  return <span>Engine: online v{ping.data.version}</span>;
}

interface ActiveConnection {
  id: string;
  name: string;
}

function useHashRoute(): readonly [string, (next: string) => void] {
  const [hash, setHash] = useState<string>(() =>
    typeof window === "undefined" ? "" : window.location.hash,
  );
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  const navigate = (next: string) => {
    window.location.hash = next;
  };
  return [hash, navigate] as const;
}

export function App() {
  const [theme, toggleTheme] = useTheme();
  const [active, setActive] = useState<ActiveConnection | null>(null);
  const [hash, navigate] = useHashRoute();
  const connectionsQuery = trpc.connections.list.useQuery();

  if (hash === "#grid") {
    return <GridHarness onLeave={() => navigate("")} />;
  }

  return (
    <div className="relative flex min-h-screen flex-col bg-background">
      <Button
        variant="ghost"
        size="icon"
        onClick={toggleTheme}
        aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        className="absolute right-4 top-4 z-20"
      >
        {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
      </Button>

      {active !== null ? (
        <SessionView
          connectionId={active.id}
          connectionName={active.name}
          onLeave={() => setActive(null)}
        />
      ) : (
        <main className="flex-1">
          {connectionsQuery.isPending ? (
            <CenteredMessage>Loading connections…</CenteredMessage>
          ) : connectionsQuery.isError ? (
            <CenteredMessage tone="destructive">
              Failed to load connections — {connectionsQuery.error.message}
            </CenteredMessage>
          ) : (
            <ConnectionsView
              connections={connectionsQuery.data}
              onOpen={(profile) => setActive({ id: profile.id, name: profile.name })}
            />
          )}
        </main>
      )}

      {active === null && (
        <footer className="pointer-events-none absolute bottom-3 right-4 text-xs">
          <EngineStatus />
        </footer>
      )}
    </div>
  );
}

function CenteredMessage({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: "default" | "destructive";
}) {
  return (
    <div className="flex h-full min-h-[60vh] items-center justify-center p-12">
      <p
        className={
          tone === "destructive"
            ? "text-sm text-destructive"
            : "text-sm text-muted-foreground"
        }
      >
        {children}
      </p>
    </div>
  );
}
