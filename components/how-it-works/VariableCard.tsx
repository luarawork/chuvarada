interface VariableCardProps {
  emoji: string;
  title: string;
  weight: number;
  description: string;
}

export function VariableCard({ emoji, title, weight, description }: VariableCardProps) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="text-2xl">{emoji}</span>
        <h3 className="font-heading text-base font-semibold text-brand-gray-urban">{title}</h3>
      </div>
      <p className="mt-1 text-xs font-medium uppercase tracking-wide text-brand-blue-mid">
        Peso {(weight * 100).toFixed(0)}%
      </p>
      <p className="mt-3 text-sm leading-relaxed text-brand-gray-urban/80">{description}</p>
    </div>
  );
}
