"use client";

import { useQuery } from "@tanstack/react-query";
import { BookOpen, FolderSearch, Plug } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CopilotConnectionsPanel } from "./CopilotConnectionsPanel";
import { CopilotSkillsPanel } from "./CopilotSkillsPanel";
import { CopilotMachineRootsPanel } from "./CopilotMachineRootsPanel";
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

/** Extensions page: Skills and MCP Connections under the shared settings shell. */
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
  const skillCount = skills.data?.skills.length;
  const connectionCount = connections.data?.connections.filter((item) => item.kind === "mcp").length;
  const rootCount = roots.data?.roots.length;
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
          <TabsTrigger value="roots" className="gap-1.5">
            <FolderSearch className="size-3.5" />
            {rootsCopy.tab}
            {rootCount ? (
              <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                {rootCount}
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
        <TabsContent value="roots" className="mt-4">
          <CopilotMachineRootsPanel />
        </TabsContent>
      </Tabs>
    </CopilotSettingsShell>
  );
}
