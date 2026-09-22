import type { Metadata } from "next";
import { JoinTeam } from "@/components/teams/JoinTeam";
export const metadata: Metadata = {
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};
export default function JoinPage() {
  return <JoinTeam />;
}
