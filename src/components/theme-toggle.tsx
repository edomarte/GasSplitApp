"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

/**
 * Cycles system → light → dark → system.
 *
 * A single button rather than a menu: it has to work with a thumb at a petrol
 * station, and three taps is still fewer than opening a menu and choosing. The
 * label always names what the next tap will do, so the cycle is not a guess.
 */
const ORDER = ["system", "light", "dark"] as const;

const LABEL: Record<string, string> = {
  system: "Match my device",
  light: "Light",
  dark: "Dark",
};

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // The server cannot know the reader's choice, so the icon is only correct
  // after hydration. Rendering the same placeholder on both sides avoids a
  // mismatch, and reserving the space stops the header jumping.
  //
  // The rule below is usually right — a setState in an effect means a second
  // render — but that second render is the entire point here: it is what marks
  // the boundary between what the server could know and what the browser does.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  const current = (theme ?? "system") as (typeof ORDER)[number];
  const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];

  if (!mounted) {
    return <div className="size-9" aria-hidden="true" />;
  }

  const Icon = current === "light" ? Sun : current === "dark" ? Moon : Monitor;

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(next)}
      title={`Theme: ${LABEL[current]}. Switch to ${LABEL[next].toLowerCase()}.`}
      aria-label={`Theme: ${LABEL[current]}. Switch to ${LABEL[next].toLowerCase()}.`}
    >
      <Icon className="size-4" />
    </Button>
  );
}
