"use client";

import { useEffect, useState } from "react";

// Breakpoint md do Tailwind (768px) — usado pra decidir se o painel de
// bairro é um bottom-sheet (mobile) ou um painel lateral (desktop).
export function useIsDesktop(breakpoint = 768) {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${breakpoint}px)`);
    setIsDesktop(mql.matches);

    const listener = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mql.addEventListener("change", listener);
    return () => mql.removeEventListener("change", listener);
  }, [breakpoint]);

  return isDesktop;
}
