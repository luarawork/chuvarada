"use client";

import { useEffect, useRef } from "react";
import type { Map as LeafletMap, LayerGroup, Marker } from "leaflet";
import type { ReportSeverity, UserReport } from "@/types";

interface ReportLayerProps {
  map: LeafletMap | null;
  reports: UserReport[];
  currentUserId: string | null;
  // Devolve se a reação foi aceita -- o popup só marca "já votou" (e mostra
  // o feedback) depois de confirmado pelo servidor, não de forma otimista,
  // já que o servidor pode rejeitar (409, ver app/api/reports/[id]/react).
  onReact: (reportId: string, reaction: "confirm" | "deny") => Promise<boolean>;
  onResolve: (reportId: string) => void;
}

const SEVERITY_CONFIG: Record<ReportSeverity, { color: string; size: number; label: string }> = {
  leve: { color: "#a8d4f0", size: 24, label: "Leve" },
  moderado: { color: "#f0a500", size: 32, label: "Moderado" },
  grave: { color: "#d64045", size: 40, label: "Grave" },
};

// Mesmo path do DropIcon (components/ui/WeatherIcons.tsx), reaproveitado
// aqui como divIcon do Leaflet -- precisa ser HTML puro (não componente
// React) porque L.divIcon renderiza fora da árvore do React.
function buildDivIcon(L: typeof import("leaflet"), severity: ReportSeverity) {
  const { color, size } = SEVERITY_CONFIG[severity];
  const html = `
    <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${color}" stroke="#0d1b2a" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 3s6 6.8 6 11a6 6 0 1 1-12 0c0-4.2 6-11 6-11Z" />
    </svg>
  `;
  return L.divIcon({
    html,
    className: "report-pin",
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -size],
  });
}

function timeAgo(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `há ${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  return `há ${Math.floor(hours / 24)}d`;
}

// Recalculado a cada abertura do popup (não só na hora de bindPopup), senão
// um relato aberto bem depois de carregado mostraria um tempo restante já
// desatualizado -- ver popupopen abaixo, que chama setPopupContent de novo.
function timeRemainingLabel(expiresAt: string | null): string {
  if (!expiresAt) return "";
  const remainingMs = new Date(expiresAt).getTime() - Date.now();
  if (remainingMs <= 0) return "Expirando em breve";
  const minutes = Math.floor(remainingMs / 60_000);
  if (minutes < 5) return "Expirando em breve";
  if (minutes < 60) return `Expira em ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return `Expira em ${hours}h${restMinutes > 0 ? `${restMinutes}min` : ""}`;
}

function buildPopupHtml(report: UserReport, isOwner: boolean, alreadyVoted: "confirm" | "deny" | null): string {
  const config = SEVERITY_CONFIG[report.severity];
  const description = report.description
    ? `<p class="report-popup-description">${escapeHtml(report.description)}</p>`
    : "";
  const resolveButton = isOwner
    ? `<button type="button" class="report-popup-resolve" data-report-id="${report.id}">Marcar como resolvido</button>`
    : "";
  const timeLabel = timeRemainingLabel(report.expires_at);

  const confirmSelected = alreadyVoted === "confirm";
  const denySelected = alreadyVoted === "deny";
  const votedDisabled = alreadyVoted !== null;
  const feedbackText =
    alreadyVoted === "confirm"
      ? "✓ Você confirmou este relato"
      : alreadyVoted === "deny"
        ? "Obrigado pelo feedback"
        : "";

  return `
    <div class="report-popup" style="min-width:200px" data-report-id="${report.id}">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">
        <span style="width:10px;height:10px;border-radius:50%;background:${config.color};display:inline-block"></span>
        <strong>Alagamento ${config.label}</strong>
      </div>
      <p style="opacity:0.6;font-size:12px;margin:2px 0 8px">${timeAgo(report.created_at)} · ${timeLabel}</p>
      ${description}
      <div style="border-top:1px solid rgba(240,244,248,0.15);margin:8px 0"></div>
      <div style="display:flex;gap:6px">
        <button type="button" class="report-popup-confirm${confirmSelected ? " report-popup-btn-selected" : ""}" data-report-id="${report.id}" ${votedDisabled ? "disabled" : ""}>👍 Confirmar (${report.confirmations})</button>
        <button type="button" class="report-popup-deny${denySelected ? " report-popup-btn-selected" : ""}" data-report-id="${report.id}" ${votedDisabled ? "disabled" : ""}>👎 Não vi isso (${report.denials})</button>
      </div>
      <p style="opacity:0.6;font-size:11px;margin-top:4px">Confirmar estende +15 minutos</p>
      <p class="report-popup-feedback" style="margin-top:6px;font-size:12px;color:#2a9d72;display:${feedbackText ? "block" : "none"}">${feedbackText}</p>
      ${resolveButton}
    </div>
  `;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

// Marcado ao confirmar/negar com sucesso -- só na memória deste componente
// (não sobrevive a um reload da página, já que a API não expõe "esse
// usuário já reagiu a esse relato" pro GET usado pelo mapa). Cobre o caso
// real que importa: reabrir o mesmo popup na mesma sessão continua
// mostrando "você já votou" em vez de deixar votar de novo.
type VoteMap = Map<string, "confirm" | "deny">;

function applyVotedState(popupEl: HTMLElement, reaction: "confirm" | "deny") {
  const confirmBtn = popupEl.querySelector<HTMLButtonElement>(".report-popup-confirm");
  const denyBtn = popupEl.querySelector<HTMLButtonElement>(".report-popup-deny");
  const feedback = popupEl.querySelector<HTMLElement>(".report-popup-feedback");
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.classList.toggle("report-popup-btn-selected", reaction === "confirm");
  }
  if (denyBtn) {
    denyBtn.disabled = true;
    denyBtn.classList.toggle("report-popup-btn-selected", reaction === "deny");
  }
  if (feedback) {
    feedback.textContent = reaction === "confirm" ? "✓ Você confirmou este relato" : "Obrigado pelo feedback";
    feedback.style.display = "block";
  }
}

export function ReportLayer({ map, reports, currentUserId, onReact, onResolve }: ReportLayerProps) {
  const layerGroupRef = useRef<LayerGroup | null>(null);
  const votedRef = useRef<VoteMap>(new Map());
  const onReactRef = useRef(onReact);
  const onResolveRef = useRef(onResolve);
  onReactRef.current = onReact;
  onResolveRef.current = onResolve;

  useEffect(() => {
    if (!map) return;
    let cancelled = false;

    import("leaflet").then((L) => {
      if (cancelled) return;

      layerGroupRef.current?.remove();
      const group = L.layerGroup();

      for (const report of reports) {
        const marker: Marker = L.marker([report.lat, report.lng], {
          icon: buildDivIcon(L, report.severity),
        });
        const isOwner = report.user_id === currentUserId;

        marker.bindPopup(buildPopupHtml(report, isOwner, votedRef.current.get(report.id) ?? null));

        marker.on("popupopen", (e) => {
          // Reconstrói o conteúdo na abertura (não só no bind) -- "Expira
          // em Xmin" fica errado se o popup for aberto bem depois do
          // bindPopup original (a lista `reports` só recarrega periodicamente).
          const alreadyVoted = votedRef.current.get(report.id) ?? null;
          marker.setPopupContent(buildPopupHtml(report, isOwner, alreadyVoted));

          const popupEl = (e.popup as unknown as { getElement: () => HTMLElement }).getElement();

          if (!alreadyVoted) {
            popupEl.querySelector(".report-popup-confirm")?.addEventListener("click", async () => {
              const ok = await onReactRef.current(report.id, "confirm");
              if (ok) {
                votedRef.current.set(report.id, "confirm");
                applyVotedState(popupEl, "confirm");
              }
            });
            popupEl.querySelector(".report-popup-deny")?.addEventListener("click", async () => {
              const ok = await onReactRef.current(report.id, "deny");
              if (ok) {
                votedRef.current.set(report.id, "deny");
                applyVotedState(popupEl, "deny");
              }
            });
          }
          popupEl.querySelector(".report-popup-resolve")?.addEventListener("click", () => {
            onResolveRef.current(report.id);
            marker.closePopup();
          });
        });

        marker.addTo(group);
      }

      group.addTo(map);
      layerGroupRef.current = group;
    });

    return () => {
      cancelled = true;
      layerGroupRef.current?.remove();
    };
  }, [map, reports, currentUserId]);

  return null;
}
