"use client";

import { useEffect, useRef } from "react";
import type { Map as LeafletMap, LayerGroup, Marker } from "leaflet";
import type { ReportSeverity, UserReport } from "@/types";

interface ReportLayerProps {
  map: LeafletMap | null;
  reports: UserReport[];
  currentUserId: string | null;
  onReact: (reportId: string, reaction: "confirm" | "deny") => void;
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

function buildPopupHtml(report: UserReport, isOwner: boolean): string {
  const config = SEVERITY_CONFIG[report.severity];
  const description = report.description
    ? `<p class="report-popup-description">${escapeHtml(report.description)}</p>`
    : "";
  const resolveButton = isOwner
    ? `<button type="button" class="report-popup-resolve" data-report-id="${report.id}">Marcar como resolvido</button>`
    : "";

  return `
    <div class="report-popup" style="min-width:180px">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
        <span style="width:10px;height:10px;border-radius:50%;background:${config.color};display:inline-block"></span>
        <strong>${config.label}</strong>
        <span style="opacity:0.6;font-size:12px">${timeAgo(report.created_at)}</span>
      </div>
      ${description}
      <div style="display:flex;gap:8px;margin:8px 0;font-size:13px">
        <span>✓ ${report.confirmations}</span>
        <span>✗ ${report.denials}</span>
      </div>
      <div style="display:flex;gap:6px">
        <button type="button" class="report-popup-confirm" data-report-id="${report.id}">Confirmar</button>
        <button type="button" class="report-popup-deny" data-report-id="${report.id}">Negar</button>
      </div>
      ${resolveButton}
    </div>
  `;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export function ReportLayer({ map, reports, currentUserId, onReact, onResolve }: ReportLayerProps) {
  const layerGroupRef = useRef<LayerGroup | null>(null);
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

        marker.bindPopup(buildPopupHtml(report, report.user_id === currentUserId));

        marker.on("popupopen", (e) => {
          const popupEl = (e.popup as unknown as { getElement: () => HTMLElement }).getElement();
          popupEl.querySelector(".report-popup-confirm")?.addEventListener("click", () => {
            onReactRef.current(report.id, "confirm");
            marker.closePopup();
          });
          popupEl.querySelector(".report-popup-deny")?.addEventListener("click", () => {
            onReactRef.current(report.id, "deny");
            marker.closePopup();
          });
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
