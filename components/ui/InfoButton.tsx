"use client";

import { useState } from "react";
import { InfoModal } from "./InfoModal";

interface InfoButtonProps {
  title: string;
  description: string;
  className?: string;
}

export function InfoButton({ title, description, className = "" }: InfoButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        aria-label={`Sobre: ${title}`}
        className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-brand-gray-urban/15 text-[10px] font-bold leading-none text-brand-gray-urban/70 hover:bg-brand-gray-urban/25 ${className}`}
      >
        ?
      </button>
      {open && <InfoModal title={title} description={description} onClose={() => setOpen(false)} />}
    </>
  );
}
