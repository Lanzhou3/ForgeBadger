"use client";

import { useQuery } from "@tanstack/react-query";

import { CliBrandIcon } from "@/components/cli-brand-icon";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLanguage } from "@/hooks/use-language";
import {
  discoverAdapters,
  isAdapterLaunchable,
  type AdapterDiscovery,
  type RuntimeAdapterId,
} from "@/lib/api";

export const ADAPTER_DISCOVERY_QUERY_KEY = ["adapter-discovery"] as const;

interface AdapterSelectProps {
  value: RuntimeAdapterId | "";
  onValueChange: (adapter: RuntimeAdapterId) => void;
  /**
   * Restrict selectable options to this subset (e.g. a provider's supported
   * CLIs). Adapters outside the subset stay visible but disabled.
   */
  supported?: readonly RuntimeAdapterId[];
  /** Show undetected CLIs as disabled options (default: true). */
  showMissing?: boolean;
  disabled?: boolean;
  size?: "sm" | "default";
  id?: string;
  ariaLabel?: string;
  className?: string;
  placeholder?: string;
}

export function isAdapterSelectable(
  adapter: Pick<AdapterDiscovery, "id" | "available" | "launchEnabled">,
  supported?: readonly RuntimeAdapterId[]
): boolean {
  return isAdapterLaunchable(adapter) && (!supported || supported.includes(adapter.id));
}

export function chooseDefaultAdapter(
  adapters: readonly AdapterDiscovery[],
  supported?: readonly RuntimeAdapterId[],
  preferred?: RuntimeAdapterId | string | null
): RuntimeAdapterId | undefined {
  const preferredAdapter = adapters.find((adapter) => adapter.id === preferred);
  if (preferredAdapter && isAdapterSelectable(preferredAdapter, supported)) {
    return preferredAdapter.id;
  }
  return adapters.find((adapter) => isAdapterSelectable(adapter, supported))?.id;
}

function adapterStatusSuffix(
  adapter: Pick<AdapterDiscovery, "id" | "available" | "launchEnabled">,
  supported: readonly RuntimeAdapterId[] | undefined,
  t: (key: "projects.runtimeUnavailable" | "projects.runtimeLaunchDisabled" | "models.adapterNotSupported") => string
): string | null {
  if (!adapter.available) return t("projects.runtimeUnavailable");
  if (supported && !supported.includes(adapter.id)) return t("models.adapterNotSupported");
  if (!adapter.launchEnabled) return t("projects.runtimeLaunchDisabled");
  return null;
}

/**
 * Unified AI-tool dropdown: one list of locally detected Code CLIs (icon,
 * brand label, install status) shared by every surface that picks an adapter.
 */
export function AdapterSelect({
  value,
  onValueChange,
  supported,
  showMissing = true,
  disabled = false,
  size = "default",
  id,
  ariaLabel,
  className,
  placeholder,
}: AdapterSelectProps) {
  const { t } = useLanguage();
  const { data, isLoading } = useQuery({
    queryKey: ADAPTER_DISCOVERY_QUERY_KEY,
    queryFn: discoverAdapters,
    staleTime: 30_000,
  });
  const adapters = data?.adapters ?? [];
  const visibleAdapters = adapters.filter((adapter) => showMissing || adapter.available);

  return (
    <Select
      value={value || undefined}
      onValueChange={(next) => onValueChange(next as RuntimeAdapterId)}
      disabled={disabled || isLoading}
    >
      <SelectTrigger id={id} aria-label={ariaLabel} size={size} className={className}>
        <SelectValue
          placeholder={isLoading ? t("common.loading") : placeholder}
        />
      </SelectTrigger>
      <SelectContent>
        {visibleAdapters.map((adapter) => {
          const suffix = adapterStatusSuffix(adapter, supported, t);
          return (
            <SelectItem
              key={adapter.id}
              value={adapter.id}
              disabled={!isAdapterSelectable(adapter, supported)}
            >
              <CliBrandIcon aiTool={adapter.id} />
              <span className="min-w-0 flex-1 truncate">
                {adapter.label}
                {suffix ? ` (${suffix})` : ""}
              </span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
