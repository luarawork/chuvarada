"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Mode = "entrar" | "criar";

function AuthForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/";
  // Duas origens redirecionam pra cá quando não autenticado -- ver
  // app/favoritos/page.tsx e app/perfil/page.tsx. Antes só "favoritos" tinha
  // mensagem própria; "perfil" caía no `null` e o usuário via a tela de
  // login sem nenhuma explicação de por que foi redirecionado.
  const avisoParam = searchParams.get("aviso");
  const aviso =
    avisoParam === "favoritos"
      ? "Entre para ver seus bairros salvos."
      : avisoParam === "perfil"
        ? "Entre para ver seu perfil."
        : null;

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
            <Input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-auto rounded-xl border bg-white/10 px-4 py-2.5 focus-visible:ring-1 focus-visible:ring-brand-blue-mid"
              style={{ borderColor: "rgba(46, 125, 184, 0.3)", color: "#f0f4f8" }}
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium" style={{ color: "#f0f4f8" }}>
              Senha
            </label>
            <Input
              id="password"
              type="password"
              required
              minLength={6}
              autoComplete={mode === "entrar" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-auto rounded-xl border bg-white/10 px-4 py-2.5 focus-visible:ring-1 focus-visible:ring-brand-blue-mid"
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

          <Button
            type="submit"
            disabled={submitting}
            className="h-auto w-full rounded-xl bg-brand-blue-mid py-2.5 font-medium text-white hover:bg-brand-blue-deep"
          >
            {submitting ? "Um momento..." : mode === "entrar" ? "Entrar" : "Criar conta"}
          </Button>
        </form>

        <Button
          variant="link"
          onClick={() => {
            setMode(mode === "entrar" ? "criar" : "entrar");
            setError(null);
            setNotice(null);
          }}
          className="mt-5 h-auto w-full p-0 text-center text-sm font-normal no-underline hover:underline"
          style={{ color: "#a8d4f0" }}
        >
          {mode === "entrar" ? "Não tem conta? Criar conta" : "Já tem conta? Entrar"}
        </Button>
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
