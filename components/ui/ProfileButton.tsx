"use client";

import { useState } from "react";
import { InfoModal } from "./InfoModal";

export function ProfileButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Perfil e login"
        className="pointer-events-auto absolute right-4 top-4 z-[1000] flex h-11 w-11 items-center justify-center rounded-full bg-white text-brand-blue-mid shadow-lg transition hover:bg-brand-gray-light"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 20c0-4.4 3.6-7 8-7s8 2.6 8 7" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <InfoModal
          title="Login em breve"
          description="Em breve você vai poder criar uma conta pra salvar bairros favoritos e receber notificações quando o risco mudar. Por enquanto, o mapa funciona inteiro sem precisar de login."
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
