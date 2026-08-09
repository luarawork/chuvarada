"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";

type Mode = "entrar" | "criar";

function AuthForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/";
  const aviso = searchParams.get("aviso") === "favoritos" ? "Entre para ver seus bairros salvos." : null;

  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<Mode>("entrar");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setSubmitting(true);

    if (mode === "entrar") {
      const { error } = await signIn(email, password);
      setSubmitting(false);
      if (error) {
        setError(error);
        return;
      }
      router.push(next);
      return;
    }

    const { error, needsEmailConfirmation } = await signUp(email, password);
    setSubmitting(false);
    if (error) {
      setError(error);
      return;
    }
    if (needsEmailConfirmation) {
      setNotice("Conta criada! Confirma seu e-mail pra poder entrar.");
      return;
    }
    router.push(next);
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4" style={{ backgroundColor: "#0d1b2a" }}>
      <div
        className="w-full max-w-sm rounded-3xl border p-8 shadow-2xl backdrop-blur-sm"
        style={{ backgroundColor: "rgba(13, 27, 42, 0.92)", borderColor: "rgba(46, 125, 184, 0.2)" }}
      >
        <Link href="/" className="text-sm hover:underline" style={{ color: "#a8d4f0" }}>
          ← Voltar para o mapa
        </Link>

        <h1 className="mt-4 font-heading text-2xl font-bold" style={{ color: "#f0f4f8" }}>
          {mode === "entrar" ? "Entrar" : "Criar conta"}
        </h1>
        <p className="mt-1 text-sm" style={{ color: "#a8d4f0" }}>
          {mode === "entrar"
            ? "Entre pra salvar bairros e acompanhar o risco."
            : "Crie sua conta pra salvar bairros favoritos."}
        </p>

        {aviso && (
          <p className="mt-4 rounded-xl bg-brand-blue-light/10 px-4 py-2.5 text-sm" style={{ color: "#a8d4f0" }}>
            {aviso}
          </p>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium" style={{ color: "#f0f4f8" }}>
              E-mail
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border bg-white/10 px-4 py-2.5 outline-none focus:border-brand-blue-mid"
              style={{ borderColor: "rgba(46, 125, 184, 0.3)", color: "#f0f4f8" }}
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium" style={{ color: "#f0f4f8" }}>
              Senha
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={6}
              autoComplete={mode === "entrar" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border bg-white/10 px-4 py-2.5 outline-none focus:border-brand-blue-mid"
              style={{ borderColor: "rgba(46, 125, 184, 0.3)", color: "#f0f4f8" }}
            />
          </div>

          {error && (
            <p className="rounded-xl bg-brand-red-alert/10 px-4 py-2.5 text-sm text-brand-red-alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="rounded-xl bg-brand-green-water/10 px-4 py-2.5 text-sm text-brand-green-water">
              {notice}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-xl bg-brand-blue-mid py-2.5 font-medium text-white transition hover:bg-brand-blue-deep disabled:opacity-60"
          >
            {submitting ? "Um momento..." : mode === "entrar" ? "Entrar" : "Criar conta"}
          </button>
        </form>

        <button
          onClick={() => {
            setMode(mode === "entrar" ? "criar" : "entrar");
            setError(null);
            setNotice(null);
          }}
          className="mt-5 w-full text-center text-sm hover:underline"
          style={{ color: "#a8d4f0" }}
        >
          {mode === "entrar" ? "Não tem conta? Criar conta" : "Já tem conta? Entrar"}
        </button>
      </div>
    </div>
  );
}

export default function AuthPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh" style={{ backgroundColor: "#0d1b2a" }} />}>
      <AuthForm />
    </Suspense>
  );
}
