"use client";

import { useCallback, useState } from "react";

interface LocationState {
  lat: number | null;
  lng: number | null;
  status: "idle" | "requesting" | "granted" | "denied" | "error";
}

export function useLocation() {
  const [state, setState] = useState<LocationState>({ lat: null, lng: null, status: "idle" });

  const requestLocation = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setState((s) => ({ ...s, status: "error" }));
      return;
    }

    setState((s) => ({ ...s, status: "requesting" }));

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setState({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          status: "granted",
        });
      },
      () => {
        setState((s) => ({ ...s, status: "denied" }));
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, []);

  return { ...state, requestLocation };
}
