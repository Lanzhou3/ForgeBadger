import { fetchJson } from "@/lib/api";

export interface MachineRoot {
  id: string;
  label: string;
  path: string;
}

const root = "/api/v1/copilot";

/** Owner-registered local search roots for the read-only machine_search / read_machine_file tools. */
export const copilotMachineRootsKey = ["copilot", "machine-roots"] as const;

export const listCopilotMachineRoots = () =>
  fetchJson<{ roots: MachineRoot[] }>(`${root}/machine-roots`);

export const registerCopilotMachineRoot = (input: { label: string; path: string }) =>
  fetchJson<{ root: MachineRoot }>(`${root}/machine-roots`, { method: "POST", body: JSON.stringify(input) });

export const deleteCopilotMachineRoot = (id: string) =>
  fetchJson<{ unregistered: boolean }>(`${root}/machine-roots/${encodeURIComponent(id)}`, { method: "DELETE" });
