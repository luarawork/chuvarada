"use client";

import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";

// Sem posicionamento próprio -- renderizado dentro da pilha flex-row do
// canto superior direito (junto com ReportButton), ver app/page.tsx.
export function ProfileButton() {
  const { user, loading } = useAuth();

  // Prioriza o nome (user_metadata.name, se o cadastro/login social
  // preencher isso) sobre o e-mail -- e-mail é o único dado garantido, mas
  // um nome de verdade é mais reconhecível que a inicial de um endereço de
  // e-mail qualquer.
  const initial = user?.user_metadata?.name?.[0]?.toUpperCase() ?? user?.email?.[0]?.toUpperCase() ?? "?";

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
        <span className="text-sm font-semibold text-white">{initial}</span>
      ) : (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      )}
    </Link>
  );
}
