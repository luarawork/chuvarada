"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HourlyForecast } from "./HourlyForecast";
import { DailyForecast } from "./DailyForecast";
import type { ForecastResult } from "@/types";

interface ForecastTabsProps {
  neighborhoodId: string;
  hourlyForecast: ForecastResult | null;
  hourlyLoading: boolean;
}

// className nos 3 níveis (List/Trigger) sobrescreve o visual padrão do
// shadcn (que é neutro/cinza) pra manter o mesmo azul translúcido de antes
// -- data-testid preservados nos 2 TabsTrigger (ver Testing na Wiki:
// forecast-tab-hours/forecast-tab-days são usados em testes E2E futuros).
export function ForecastTabs({ neighborhoodId, hourlyForecast, hourlyLoading }: ForecastTabsProps) {
  return (
    <Tabs defaultValue="days">
      <TabsList className="grid h-auto w-full grid-cols-2 gap-1 rounded-lg bg-brand-blue-mid/10 p-1">
        <TabsTrigger
          value="hours"
          data-testid="forecast-tab-hours"
          className="rounded-md py-1.5 text-sm font-normal text-brand-blue-light shadow-none transition-colors duration-150 data-[state=active]:bg-brand-blue-mid/30 data-[state=active]:font-semibold data-[state=active]:text-brand-gray-light"
        >
          Próximas horas
        </TabsTrigger>
        <TabsTrigger
          value="days"
          data-testid="forecast-tab-days"
          className="rounded-md py-1.5 text-sm font-normal text-brand-blue-light shadow-none transition-colors duration-150 data-[state=active]:bg-brand-blue-mid/30 data-[state=active]:font-semibold data-[state=active]:text-brand-gray-light"
        >
          Próximos dias
        </TabsTrigger>
      </TabsList>

      <TabsContent value="hours" className="mt-3">
        <HourlyForecast forecast={hourlyForecast} loading={hourlyLoading} />
      </TabsContent>
      <TabsContent value="days" className="mt-3">
        <DailyForecast neighborhoodId={neighborhoodId} />
      </TabsContent>
    </Tabs>
  );
}
