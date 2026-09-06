import { useState, useCallback, useRef } from "react";
import { useAuth } from "@clerk/react";

export type OrganizationSettings = {
  id: string;
  companyName: string;
  contactEmail: string;
  contactPhone: string;
  contactAddress: string;
  defaultCurrency: string;
  logoUrl: string;
  defaultVatRateBasisPoints: number;
  defaultPaymentTermsDays: number;
  fallbackDayRateMinor: number;
  fallbackHourlyRateMinor: number;
  overtimeThresholdMinutes: number;
  overtimeMultiplierBasisPoints: number;
  departments: string[];
};

export type SettingsErrorCode =
  | "notAuthenticated"
  | "unauthorized"
  | "fetchFailed"
  | "updateFailed";

export type SettingsUpdateResult =
  | { ok: true }
  | { ok: false; error: SettingsErrorCode };

export function useSettings() {
  const { getToken } = useAuth();
  const [settings, setSettings] = useState<OrganizationSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<SettingsErrorCode | null>(null);
  const loadingRef = useRef(false);

  const fetchSettings = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("notAuthenticated");
      const res = await fetch("/api/settings", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401 || res.status === 403) {
        throw new Error("unauthorized");
      }
      if (!res.ok) {
        throw new Error("fetchFailed");
      }
      const json = await res.json();
      if (!json.ok) throw new Error("fetchFailed");
      setSettings(json.settings);
    } catch (err: unknown) {
      const code = err instanceof Error ? err.message : "fetchFailed";
      setError(
        code === "notAuthenticated" || code === "unauthorized"
          ? code
          : "fetchFailed",
      );
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }, [getToken]);

  const updateSettings = useCallback(
    async (
      updates: Partial<OrganizationSettings>,
    ): Promise<SettingsUpdateResult> => {
      try {
        const editableUpdates = {
          companyName: updates.companyName,
          contactEmail: updates.contactEmail,
          contactPhone: updates.contactPhone,
          contactAddress: updates.contactAddress,
          defaultCurrency: updates.defaultCurrency,
          logoUrl: updates.logoUrl,
          defaultVatRateBasisPoints: updates.defaultVatRateBasisPoints,
          defaultPaymentTermsDays: updates.defaultPaymentTermsDays,
          fallbackDayRateMinor: updates.fallbackDayRateMinor,
          fallbackHourlyRateMinor: updates.fallbackHourlyRateMinor,
          overtimeThresholdMinutes: updates.overtimeThresholdMinutes,
          overtimeMultiplierBasisPoints: updates.overtimeMultiplierBasisPoints,
          departments: updates.departments,
        };
        const token = await getToken();
        if (!token) throw new Error("notAuthenticated");
        const res = await fetch("/api/settings", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(editableUpdates),
        });
        if (res.status === 401 || res.status === 403) {
          throw new Error("unauthorized");
        }
        if (!res.ok) {
          throw new Error("updateFailed");
        }
        const json = await res.json();
        if (!json.ok) throw new Error("updateFailed");
        setSettings(json.settings);
        return { ok: true };
      } catch (err: unknown) {
        const code = err instanceof Error ? err.message : "updateFailed";
        return {
          ok: false as const,
          error: (code === "notAuthenticated" ||
          code === "unauthorized"
            ? code
            : "updateFailed") as SettingsErrorCode,
        };
      }
    },
    [getToken],
  );

  return {
    settings,
    loading,
    error,
    fetchSettings,
    updateSettings,
  };
}
