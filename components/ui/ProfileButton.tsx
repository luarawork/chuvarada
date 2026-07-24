"use client";

import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";

// Sem posicionamento próprio -- renderizado dentro da pilha flex-col do
// canto superior direito (junto com ReportButton), ver app/page.tsx.
export function ProfileButton() {
  const { user, loading } = useAuth();

  return (
    <Link
      href={user ? "/perfil" : "/auth"}
      aria-label={user ? "Meus favoritos" : "Entrar"}
      className={`pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full border text-brand-blue-light shadow-lg backdrop-blur transition ${
        loading ? "opacity-0" : "opacity-100"
      }`}
      style={{ backgroundColor: "rgba(13, 27, 42, 0.92)", borderColor: "rgba(46, 125, 184, 0.3)" }}
    >
      {user ? (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 21s-7.5-4.6-10-9.3C.5 8 2 4.5 5.5 4 8 3.6 10 5 12 7.5 14 5 16 3.6 18.5 4 22 4.5 23.5 8 22 11.7 19.5 16.4 12 21 12 21Z" />
        </svg>
      ) : (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 20c0-4.4 3.6-7 8-7s8 2.6 8 7" strokeLinecap="round" />
        </svg>
      )}
    </Link>
  );
}
