"use client";
import { ThemeProvider, useTheme } from "next-themes";
import { useEffect } from "react";
import { Toaster } from "sonner";

function ThemedToaster() {
  const { resolvedTheme } = useTheme();
  return (
    <Toaster
      position="top-center"
      theme={(resolvedTheme as "light" | "dark") ?? "system"}
      toastOptions={{ className: "!rounded-lg !border !bg-card !text-foreground !shadow-lg" }}
    />
  );
}

function ServiceWorker() {
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange storageKey="forma-theme">
      {children}
      <ThemedToaster />
      <ServiceWorker />
    </ThemeProvider>
  );
}
