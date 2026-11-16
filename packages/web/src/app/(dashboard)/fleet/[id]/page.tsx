"use client";

import { useParams } from "next/navigation";

import { FleetPage } from "@/components/fleet/fleet-page";

/** One fleet: the board, the flagship's activity and the owner's controls. */
export default function FleetDetailRoute() {
  const params = useParams<{ id: string }>();
  return <FleetPage fleetId={params.id} />;
}
