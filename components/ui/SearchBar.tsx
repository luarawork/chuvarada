"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

interface SearchResult {
  type: "city" | "neighborhood";
  id: string;
  label: string;
  sublabel: string;
  lat: number;
  lng: number;
  zoom: number;
}

interface SearchBarProps {
  onSelect: (lat: number, lng: number, zoom: number) => void;
}

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 300;
const RESULT_LIMIT = 5;

async function search(query: string): Promise<SearchResult[]> {
  if (query.length < MIN_QUERY_LENGTH) return [];

  const [{ data: cities }, { data: neighborhoods }] = await Promise.all([
    supabase
      .from("cities")
      .select("id, name, state, lat, lng")
      .ilike("name", `%${query}%`)
      .eq("active", true)
      .order("name")
      .limit(RESULT_LIMIT),
    // Exclui bairros sem denominação oficial e distritos usados como
    // aproximação (name_source='distrito') -- a busca deve devolver só
    // nomes reais que o usuário provavelmente está digitando de propósito,
    // não um distrito administrativo que o usuário nem sabe que existe.
    supabase
      .from("neighborhoods")
      .select("id, name, centroid_lat, centroid_lng, name_source, cities!inner(name, state)")
      .ilike("name", `%${query}%`)
      .not("name_source", "eq", "distrito")
      .order("name")
      .limit(RESULT_LIMIT),
  ]);

  const cityResults: SearchResult[] = (cities ?? []).map((c) => ({
    type: "city" as const,
    id: c.id,
    label: c.name,
    sublabel: c.state,
    lat: c.lat,
    lng: c.lng,
    zoom: 12,
  }));

  const neighborhoodResults: SearchResult[] = (neighborhoods ?? [])
    .filter((n) => !n.name.toLowerCase().includes("sem denominação"))
    .map((n) => {
      // O client-js do Supabase tipa relações embutidas como array mesmo em
      // joins 1:1 via !inner -- na prática vem sempre 1 objeto.
      const city = Array.isArray(n.cities) ? n.cities[0] : n.cities;
      return {
        type: "neighborhood" as const,
        id: n.id,
        label: n.name,
        sublabel: city ? `${city.name} — ${city.state}` : "",
        lat: n.centroid_lat,
        lng: n.centroid_lng,
        zoom: 14,
      };
    });

  return [...cityResults, ...neighborhoodResults];
}

function CityIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a8d4f0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h1M9 13h1M9 17h1M14 9h1M14 13h1M14 17h1" />
    </svg>
  );
}

function NeighborhoodIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a8d4f0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 21s-7-6.5-7-11.5a7 7 0 0 1 14 0C19 14.5 12 21 12 21z" />
      <circle cx="12" cy="9.5" r="2.2" />
    </svg>
  );
}

export function SearchBar({ onSelect }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (query.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setLoading(false);
      setOpen(false);
      return;
    }

    setLoading(true);
    setOpen(true);
    let cancelled = false;

    const timer = setTimeout(async () => {
      try {
        const data = await search(query);
        if (cancelled) return;
        setResults(data);
      } catch (err) {
        console.error("Erro na busca:", err);
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  function handleSelect(result: SearchResult) {
    setOpen(false);
    setQuery("");
    onSelect(result.lat, result.lng, result.zoom);
  }

  return (
    <div
      ref={containerRef}
      className="pointer-events-auto absolute left-1/2 z-[1000] w-[90vw] max-w-[320px] -translate-x-1/2 font-body"
      style={{ top: 16 }}
    >
      <div
        className="flex items-center gap-2 rounded-xl px-3.5 py-2.5 backdrop-blur-md"
        style={{
          backgroundColor: "rgba(13, 27, 42, 0.92)",
          border: "1px solid rgba(46, 125, 184, 0.3)",
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a8d4f0" strokeWidth="2" strokeLinecap="round" className="shrink-0">
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => query.length >= MIN_QUERY_LENGTH && setOpen(true)}
          placeholder="Buscar cidade ou bairro..."
          className="w-full bg-transparent text-sm outline-none placeholder:text-[#a8d4f0]/60"
          style={{ color: "#f0f4f8" }}
        />
        {loading && (
          <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-[#a8d4f0]/30 border-t-[#a8d4f0]" />
        )}
      </div>

      {open && (
        <div
          className="mt-1.5 max-h-72 overflow-y-auto rounded-xl backdrop-blur-md"
          style={{
            backgroundColor: "rgba(13, 27, 42, 0.92)",
            border: "1px solid rgba(46, 125, 184, 0.3)",
          }}
        >
          {!loading && results.length === 0 && (
            <p className="px-3.5 py-3 text-sm" style={{ color: "#a8d4f0" }}>
              Nenhum resultado para &ldquo;{query}&rdquo;
            </p>
          )}
          {results.map((result, idx) => (
            <button
              key={`${result.type}-${result.id}`}
              onClick={() => handleSelect(result)}
              className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition hover:bg-[rgba(46,125,184,0.2)]"
              style={{
                borderTop: idx > 0 ? "1px solid rgba(46, 125, 184, 0.15)" : undefined,
              }}
            >
              {result.type === "city" ? <CityIcon /> : <NeighborhoodIcon />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm" style={{ color: "#f0f4f8" }}>
                  {result.label}
                </span>
                <span className="block truncate text-xs" style={{ color: "#a8d4f0" }}>
                  {result.sublabel}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
