import { redirect } from "next/navigation";
export default async function TeamPage({params}:{params:Promise<{teamId:string}>}) {
 const {teamId}=await params;
 redirect(`/members?team=${encodeURIComponent(teamId)}`);
}
