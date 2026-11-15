"use client";

import { createContext, useContext } from "react";

const Ctx = createContext<Record<string, string>>({});

/** The icons super admins picked per category, so every wheel tile without its own icon can show them. */
export function CategoryIconsProvider({ icons, children }: { icons: Record<string, string>; children: React.ReactNode }) {
  return <Ctx.Provider value={icons}>{children}</Ctx.Provider>;
}

export const useCategoryIcons = () => useContext(Ctx);
