"use client";

import { useState } from "react";
import { HourlyForecast } from "./HourlyForecast";
import { DailyForecast } from "./DailyForecast";
import type { ForecastResult } from "@/types";

type Tab = "hours" | "days";

interface ForecastTabsProps {
  neighborhoodId: string;
  hourlyForecast: ForecastResult | null;
  hourlyLoading: boolean;
}

export function ForecastTabs({ neighborhoodId, hourlyForecast, hourlyLoading }: ForecastTabsProps) {
  const [tab, setTab] = useState<Tab>("days");

  return (
    <div>
      <div className="flex gap-1 rounded-lg bg-brand-blue-mid/10 p-1">
        <button
          data-testid="forecast-tab-hours"
          onClick={() => setTab("hours")}
          className={`flex-1 rounded-md py-1.5 text-sm transition-colors duration-150 ${
            tab === "hours"
              ? "bg-brand-blue-mid/30 font-semibold text-brand-gray-light"
              : "font-normal text-brand-blue-light"
          }`}
        >
          Próximas horas
        </button>
        <button
          data-testid="forecast-tab-days"
          onClick={() => setTab("days")}
          className={`flex-1 rounded-md py-1.5 text-sm transition-colors duration-150 ${
            tab === "days"
              ? "bg-brand-blue-mid/30 font-semibold text-brand-gray-light"
              : "font-normal text-brand-blue-light"
          }`}
        >
          Próximos dias
        </button>
      </div>

      <div className="mt-3">
        {tab === "hours" ? (
          <HourlyForecast forecast={hourlyForecast} loading={hourlyLoading} />
        ) : (
          <DailyForecast neighborhoodId={neighborhoodId} />
        )}
      </div>
    </div>
  );
}
