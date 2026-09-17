"use client";

import { useQuery } from "@tanstack/react-query";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLanguage } from "@/hooks/use-language";
import { listTemplates } from "@/lib/api";

export const TEMPLATES_QUERY_KEY = ["templates"] as const;

const NO_TEMPLATE = "none";

interface TemplateSelectProps {
  value: string;
  onValueChange: (id: string) => void;
  disabled?: boolean;
  size?: "sm" | "default";
  id?: string;
  ariaLabel?: string;
  className?: string;
}

/**
 * Optional template binding for project creation/import. An empty value means
 * "no template"; the explicit "none" row lets the user unbind again.
 */
export function TemplateSelect({
  value,
  onValueChange,
  disabled = false,
  size = "default",
  id,
  ariaLabel,
  className,
}: TemplateSelectProps) {
  const { t } = useLanguage();
  const { data, isLoading } = useQuery({
    queryKey: TEMPLATES_QUERY_KEY,
    queryFn: listTemplates,
    staleTime: 30_000,
  });
  const templates = data?.templates ?? [];

  return (
    <Select
      value={value || NO_TEMPLATE}
      onValueChange={(next) => onValueChange(next === NO_TEMPLATE ? "" : next)}
      disabled={disabled || isLoading}
    >
      <SelectTrigger id={id} aria-label={ariaLabel} size={size} className={className}>
        <SelectValue placeholder={t("common.loading")} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_TEMPLATE}>
          <span className="min-w-0 flex-1 truncate">{t("templates.noTracking")}</span>
        </SelectItem>
        {templates.map((template) => (
          <SelectItem key={template.id} value={template.id}>
            <span className="min-w-0 flex-1 truncate">{template.name}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
