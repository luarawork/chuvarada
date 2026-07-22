export function LoadingMap() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-brand-blue-deep">
      <div className="flex flex-col items-center gap-3">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-blue-light/30 border-t-brand-blue-light" />
        <p className="font-body text-sm text-brand-blue-light">Carregando o mapa...</p>
      </div>
    </div>
  );
}
