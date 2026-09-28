"use client";

import { useQuery } from "@tanstack/react-query";
import { BookOpen, Plug } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CopilotConnectionsPanel } from "./CopilotConnectionsPanel";
import { CopilotSkillsPanel } from "./CopilotSkillsPanel";
import { CopilotSettingsShell } from "./copilot-settings-shell";
import { useExtensionsCopy } from "./extensions-copy";
import {
  copilotConnectionsKey,
  copilotSkillsKey,
  listCopilotConnections,
  listCopilotSkills,
} from "@/lib/copilot-extensions-api";

/** Extensions page: Skills and MCP Connections under the shared settings shell. */
export function CopilotExtensionsPage() {
  const copy = useExtensionsCopy();
  const skills = useQuery({ queryKey: copilotSkillsKey, queryFn: listCopilotSkills, retry: false });
  const connections = useQuery({
    queryKey: copilotConnectionsKey,
    queryFn: listCopilotConnections,
    retry: false,
  });
  const skillCount = skills.data?.skills.length;
  const connectionCount = connections.data?.connections.filter((item) => item.kind === "mcp").length;
  return (
    <CopilotSettingsShell active="extensions" title={copy.title} description={copy.description}>
      <Tabs defaultValue="skills" className="forgebadger-animate-in" style={{ animationDelay: "120ms" }}>
        <TabsList aria-label={copy.title}>
          <TabsTrigger value="skills" className="gap-1.5">
            <BookOpen className="size-3.5" />
            {copy.skills}
            {skillCount ? (
              <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                {skillCount}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="connections" className="gap-1.5">
            <Plug className="size-3.5" />
            {copy.connections}
            {connectionCount ? (
              <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                {connectionCount}
              </Badge>
            ) : null}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="skills" className="mt-4">
          <CopilotSkillsPanel />
        </TabsContent>
        <TabsContent value="connections" className="mt-4">
          <CopilotConnectionsPanel />
        </TabsContent>
      </Tabs>
    </CopilotSettingsShell>
  );
}
