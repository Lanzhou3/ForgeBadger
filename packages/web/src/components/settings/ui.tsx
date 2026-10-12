"use client";

import type { ReactNode } from "react";

import {
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";

interface SettingsSectionProps {
  title: string;
  description: string;
  children: ReactNode;
}

/** Grouped settings section: heading plus a spaced stack of cards. */
export function SettingsSection({ title, description, children }: SettingsSectionProps) {
  return (
    <section className="max-w-3xl space-y-4">
      <div>
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

interface SettingsCardHeaderProps {
  icon: ReactNode;
  title: string;
  description: string;
  /** Optional right-aligned slot for switches, badges, or action buttons. */
  action?: ReactNode;
  /** Optional id applied to the title for aria-labelledby wiring. */
  titleId?: string;
}

/** Shared settings card header: icon tile + title/description + action slot. */
export function SettingsCardHeader({
  icon,
  title,
  description,
  action,
  titleId,
}: SettingsCardHeaderProps) {
  return (
    <CardHeader className="flex flex-wrap items-start gap-3 space-y-0">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-brand/10 text-brand">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <CardTitle id={titleId} className="text-sm font-semibold">
          {title}
        </CardTitle>
        <CardDescription className="mt-1 text-xs">{description}</CardDescription>
      </div>
      {action}
    </CardHeader>
  );
}

interface SettingRowProps {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  icon?: ReactNode;
}

/** Single preference row: label/description on the left, switch on the right. */
export function SettingRow({
  title,
  description,
  checked,
  disabled = false,
  onCheckedChange,
  icon,
}: SettingRowProps) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md border border-border/70 px-3 py-3 transition-colors hover:bg-muted/40">
      <div className="flex min-w-0 items-start gap-3">
        {icon ? <span className="mt-0.5 shrink-0">{icon}</span> : null}
        <div className="min-w-0">
          <div className="text-sm font-medium">{title}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">{description}</div>
        </div>
      </div>
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        aria-label={title}
      />
    </div>
  );
}
