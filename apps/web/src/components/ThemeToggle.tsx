"use client";

import { useEffect, useState } from "react";
import { MonitorIcon, MoonIcon, SunIcon } from "./Icons";

type Theme = "light" | "dark" | "system";

/** Runs before paint (inlined in <head>) so the saved theme never flashes. */
export const themeScript = `try{var t=localStorage.getItem("cheddar-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");
  useEffect(() => {
    try {
      const t = localStorage.getItem("cheddar-theme");
      if (t === "light" || t === "dark") setTheme(t);
    } catch {
      /* storage blocked */
    }
  }, []);
  const next = (t: Theme) => {
    setTheme(t);
    try {
      if (t === "system") localStorage.removeItem("cheddar-theme");
      else localStorage.setItem("cheddar-theme", t);
    } catch {
      /* storage blocked */
    }
    if (t === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
  };
  const order: Theme[] = ["system", "light", "dark"];
  const label = { system: "Auto", light: "Light", dark: "Dark" }[theme];
  return (
    <button
      type="button"
      onClick={() => next(order[(order.indexOf(theme) + 1) % order.length]!)}
      className="flex items-center gap-1.5 rounded-[10px] px-2 py-1.5 text-sm font-medium text-muted hover:bg-hover hover:text-ink"
      aria-label={`Theme: ${label}. Click to change.`}
    >
      {theme === "dark" ? <MoonIcon size={16} /> : theme === "light" ? <SunIcon size={16} /> : <MonitorIcon size={16} />}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
