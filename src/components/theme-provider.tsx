"use client";

import { ThemeProvider as NextThemes } from "next-themes";

/**
 * Light and dark, following the device unless the reader says otherwise.
 *
 * `attribute="class"` puts `.dark` on <html>, which is what the `dark:` variant
 * in globals.css keys off. The palette for both already exists there; nothing
 * was applying it.
 *
 * The provider also injects a small script that sets the class before the page
 * paints. Without it a reader who chose dark gets a white flash on every
 * navigation, which is worse than not offering the choice.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemes
      attribute="class"
      defaultTheme="system"
      enableSystem
      // Stops every colour transitioning at once when the theme flips, which
      // reads as a glitch rather than a change.
      disableTransitionOnChange
    >
      {children}
    </NextThemes>
  );
}
