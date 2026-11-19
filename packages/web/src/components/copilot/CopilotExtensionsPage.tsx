"use client";

import { skipToken, useQuery } from "@tanstack/react-query";
import { BookOpen, FolderSearch, Plug, Wrench } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CopilotConnectionsPanel } from "./CopilotConnectionsPanel";
import { CopilotSkillsPanel } from "./CopilotSkillsPanel";
import { CopilotMachineRootsPanel } from "./CopilotMachineRootsPanel";
import { CapabilitiesSection, copilotCapabilitiesQueryKey } from "./copilot-runtime-panel";
import { CopilotSettingsShell } from "./copilot-settings-shell";
import { useExtensionsCopy } from "./extensions-copy";
import { useMachineRootsCopy } from "./machine-roots-copy";
import {
  copilotConnectionsKey,
  copilotSkillsKey,
  listCopilotConnections,
  listCopilotSkills,
} from "@/lib/copilot-extensions-api";
import {
  copilotMachineRootsKey,
  listCopilotMachineRoots,
} from "@/lib/copilot-machine-roots-api";
import type { CopilotToolInfo } from "@/lib/copilot-api";

/** Extensions page: Playbooks, Built-in tools, MCP Connections, and Local search roots. */
export function CopilotExtensionsPage() {
  const copy = useExtensionsCopy();
  const rootsCopy = useMachineRootsCopy();
  const skills = useQuery({ queryKey: copilotSkillsKey, queryFn: listCopilotSkills, retry: false });
  const connections = useQuery({
    queryKey: copilotConnectionsKey,
    queryFn: listCopilotConnections,
    retry: false,
  });
  const roots = useQuery({ queryKey: copilotMachineRootsKey, queryFn: listCopilotMachineRoots, retry: false });
  // Read cached built-in tool count without fetching until the Built-in tools tab mounts.
  const capabilities = useQuery<{ tools?: CopilotToolInfo[] }>({
    queryKey: copilotCapabilitiesQueryKey,
    queryFn: skipToken,
    retry: false,
  });
  const skillCount = skills.data?.skills.length;
  const toolCount = capabilities.data?.tools?.length;
  const connectionCount = connections.data?.connections.filter((item) => item.kind === "mcp").length;
  const rootCount = roots.data?.roots.length;
  return (
    <CopilotSettingsShell active="extensions" title={copy.title} description={copy.description}>
      <Tabs defaultValue="skills" className="forgebadger-animate-in" style={{ animationDelay: "120ms" }}>
        <TabsList aria-label={copy.title} className="flex-wrap">
          <TabsTrigger value="skills" className="gap-1.5">
            <BookOpen className="size-3.5" />
            {copy.skills}
            {skillCount ? (
              <Badge variant="secondary" className="px-1.5 py-0 text-[10px] tabular-nums">
                {skillCount}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="tools" className="gap-1.5">
            <Wrench className="size-3.5" />
            {copy.builtinTools}
            {toolCount ? (
              <Badge variant="secondary" className="px-1.5 py-0 text-[10px] tabular-nums">
                {toolCount}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="connections" className="gap-1.5">
            <Plug className="size-3.5" />
            {copy.connections}
            {connectionCount ? (
              <Badge variant="secondary" className="px-1.5 py-0 text-[10px] tabular-nums">
                {connectionCount}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="roots" className="gap-1.5">
            <FolderSearch className="size-3.5" />
            {rootsCopy.tab}
            {rootCount ? (
              <Badge variant="secondary" className="px-1.5 py-0 text-[10px] tabular-nums">
                {rootCount}
              </Badge>
            ) : null}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="skills" className="mt-4">
          <CopilotSkillsPanel />
        </TabsContent>
        <TabsContent value="tools" className="mt-4">
          <CapabilitiesSection active />
        </TabsContent>
        <TabsContent value="connections" className="mt-4">
          <CopilotConnectionsPanel />
        </TabsContent>
        <TabsContent value="roots" className="mt-4">
          <CopilotMachineRootsPanel />
        </TabsContent>
      </Tabs>
    </CopilotSettingsShell>
  );
}
