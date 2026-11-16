"use client";

import type { ReactNode } from "react";
import { SkillNavigation } from "./SkillNavigation";
import "./skills-workspace.css";

interface Props {
  title: string;
  count?: number;
  actions?: ReactNode;
  children: ReactNode;
}

export function SkillWorkspace({ title, count, actions, children }: Props) {
  return (
    <div className="skills-workspace mx-auto flex w-full max-w-7xl flex-col gap-5 p-4 md:p-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="flex items-baseline gap-3 text-2xl font-semibold tracking-tight">
          {title}
          {count !== undefined ? (
            <span className="text-lg font-normal tabular-nums text-muted-foreground">
              {count}
            </span>
          ) : null}
        </h1>
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      </header>
      <SkillNavigation />
      {children}
    </div>
  );
}
