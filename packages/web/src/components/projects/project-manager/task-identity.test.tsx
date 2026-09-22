// @vitest-environment jsdom
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {cleanup, fireEvent, render, screen, waitFor} from "@testing-library/react";
import {afterEach, expect, it, vi} from "vitest";
import {getTranslation} from "@/lib/i18n";
import {collaborationApi, type WorkspaceDetail} from "@/lib/collaboration-api";
import {taskArtifactsApi} from "@/lib/project-task-api";
import {ProjectManagerWorkItemDetailSheet} from "./WorkItemDetailSheet";
import {TaskAuthorityContext} from "./TaskAuthority";
import type {ComponentProps} from "react";
vi.mock("@/hooks/use-language",()=>({useLanguage:()=>({t:(key:Parameters<typeof getTranslation>[1])=>getTranslation("en",key)})}));
vi.mock("@/components/workspaces/RunPanel",()=>({RunPanel:({runId}:{runId:string})=><p>Selected run: {runId}</p>}));
afterEach(()=>{cleanup();vi.restoreAllMocks();});
const project: WorkspaceDetail={project:{id:"project",name:"Project",role:"owner",memberCount:1,revision:1,verificationRevision:1,executionEnabled:true,verification:null},members:[],tasks:[],events:[]};
const item={id:"a",projectId:"project",title:"Task A",description:null,status:"todo" as const,priority:0,acceptanceCriteria:[],evidenceRefCount:0,evidenceRefs:[],stageId:null,revision:1,createdAt:1,updatedAt:1};
const noop=()=>{};
const props:ComponentProps<typeof ProjectManagerWorkItemDetailSheet>={item,evidenceDraft:{referenceType:"custom",kind:"",label:"",ref:"",path:"",sessionId:""},evidenceError:null,isEvidenceSaving:false,isTaskPacketLinking:false,isTaskPacketLoading:false,isTaskPacketStarting:false,ledgerEvents:[],links:[],onAttachEvidence:noop,onEvidenceDraftChange:noop,onOpenChange:noop,onStatusChange:noop,onTaskPacketSessionChange:noop,onTaskPacketSessionLink:noop,onTaskPacketStart:noop,open:true,projectId:"project",stages:[],statusMutationPending:false,t:key=>getTranslation("en",key),taskPacket:null,taskPacketError:null,taskPacketLinkError:null,taskPacketStartError:null,taskPacketSessionId:"",taskPacketSessions:[],workItems:[item]};
it("resets execution selection, comment and artifact consent when the open sheet changes task identity",async()=>{
 vi.spyOn(collaborationApi,"task").mockImplementation(async(_p,id)=>({task:{...item,id,title:id,assigneeId:null,reviewerId:null},runs:[],comments:[]}));
 vi.spyOn(collaborationApi,"prepare").mockResolvedValue({run:{id:"run-a"} as never});
 vi.spyOn(taskArtifactsApi,"list").mockResolvedValue({artifacts:[],candidates:[{developmentTaskId:"candidate",artifactDigest:"digest",status:"checks_passed",filesCount:1,checksCount:1,passedChecks:1}]});
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 function view(id:string){return <QueryClientProvider client={client}><TaskAuthorityContext.Provider value={{canEdit:true,canManage:true,legacySessions:false,collaboration:{...project,project:{...project.project,executionEnabled:id === "a"}},actorId:"actor"}}><ProjectManagerWorkItemDetailSheet {...props} item={{...item,id,title:id}} /></TaskAuthorityContext.Provider></QueryClientProvider>;}
 const mounted=render(view("a"));await screen.findByLabelText("Add a comment");
 fireEvent.change(screen.getByLabelText("Add a comment"),{target:{value:"Task A private draft"}});
 fireEvent.change(screen.getByLabelText("Your completed Copilot artifact"),{target:{value:"candidate"}});fireEvent.click(screen.getByLabelText("I agree to share this artifact summary with project members"));
 fireEvent.click(screen.getByRole("button",{name:"Prepare isolated attempt"}));await screen.findByText("Selected run: run-a");
 mounted.rerender(view("b"));await waitFor(()=>expect(collaborationApi.task).toHaveBeenCalledWith("project","b"));
 expect((await screen.findByLabelText("Add a comment") as HTMLTextAreaElement).value).toBe("");expect(screen.queryByText("Selected run: run-a")).toBeNull();
 expect(screen.queryByRole("button",{name:"Prepare isolated attempt"})).toBeNull();
 expect((screen.getByLabelText("Your completed Copilot artifact") as HTMLSelectElement).value).toBe("");expect((screen.getByLabelText("I agree to share this artifact summary with project members") as HTMLInputElement).checked).toBe(false);
});
