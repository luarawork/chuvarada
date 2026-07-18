"use client";

interface LocationButtonProps {
  onClick: () => void;
  loading?: boolean;
}

export function LocationButton({ onClick, loading }: LocationButtonProps) {
  return (
    <button
      onClick={onClick}
      aria-label="Ver minha localização"
      className="pointer-events-auto absolute bottom-4 left-4 z-[1000] flex h-11 w-11 items-center justify-center rounded-full bg-white text-brand-blue-mid shadow-lg transition hover:bg-brand-gray-light disabled:opacity-60"
      disabled={loading}
    >
      {loading ? (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-blue-mid/30 border-t-brand-blue-mid" />
      ) : (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3" strokeLinecap="round" />
        </svg>
      )}
    </button>
  );
}
