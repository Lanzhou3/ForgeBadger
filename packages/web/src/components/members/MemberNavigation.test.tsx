// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LanguageProvider } from "@/hooks/use-language";
import { collaborationApi, type WorkspaceDetail } from "@/lib/collaboration-api";
import { teamsApi } from "@/lib/teams-api";
import * as api from "@/lib/api";
import MembersPage from "@/app/(dashboard)/members/page";
import { navItems } from "@/components/layout/sidebar";
import TeamsPage from "@/app/(dashboard)/teams/page";
import TeamPage from "@/app/(dashboard)/teams/[teamId]/page";
const state=vi.hoisted(()=>({user:{id:"actor",role:"user"},search:"",push:vi.fn(),redirect:vi.fn()}));
vi.mock("@/hooks/use-auth",()=>({useAuth:()=>({user:state.user,isLoading:false})}));
vi.mock("next/navigation",()=>({useSearchParams:()=>new URLSearchParams(state.search),useRouter:()=>({push:state.push}),usePathname:()=>"/members",redirect:state.redirect}));
function detail(id:string):WorkspaceDetail {return {project:{id,name:id,role:"owner",capabilities:["read","manage"],memberCount:1,revision:7,verificationRevision:1,executionEnabled:false,verification:null},members:[],tasks:[],events:[]};}
function mount(content:React.ReactNode){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});return render(<QueryClientProvider client={client}><LanguageProvider>{content}</LanguageProvider></QueryClientProvider>);}
beforeEach(()=>{vi.restoreAllMocks();state.search="";state.user={id:"actor",role:"user"};state.push.mockReset();state.redirect.mockReset();localStorage.clear();vi.spyOn(teamsApi,"list").mockResolvedValue({teams:[]});vi.spyOn(api,"listAdminUsers").mockResolvedValue({users:[]});});
afterEach(cleanup);
it("has one member navigation entry available to collaborators, with no separate team/workspace entry",()=>{
 expect(navItems.filter(item=>item.href==="/members")).toHaveLength(1);
 expect(navItems.find(item=>item.href==="/members")?.adminOnly).not.toBe(true);
 expect(navItems.some(item=>item.href==="/teams"||item.href==="/workspaces")).toBe(false);
});
it("lets regular members access collaboration without fetching account administration even with an accounts URL",async()=>{
 state.search="view=accounts";mount(<MembersPage/>);
 await screen.findByText("暂无团队。");
 expect(screen.queryByRole("link",{name:"账号管理"})).toBeNull();
 expect(screen.getByRole("link",{name:"项目权限"})).toBeTruthy();
 expect(api.listAdminUsers).not.toHaveBeenCalled();
});
it("shows only project membership in member management and clears a draft when switching projects",async()=>{
 state.search="project=a";vi.spyOn(collaborationApi,"projects").mockResolvedValue({projects:[detail("a").project,detail("b").project]});
 vi.spyOn(collaborationApi,"project").mockImplementation(async id=>detail(id));
 const result=mount(<MembersPage/>);
 const email=await screen.findByLabelText("已注册账号邮箱");fireEvent.change(email,{target:{value:"draft@example.test"}});
 expect(screen.queryByLabelText("允许受信任的宿主机执行")).toBeNull();
 expect(screen.queryByText("成员与执行设置")).toBeNull();
 state.search="project=b";result.rerender(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><LanguageProvider><MembersPage/></LanguageProvider></QueryClientProvider>);
 await waitFor(()=>expect((screen.getByLabelText("已注册账号邮箱") as HTMLInputElement).value).toBe(""));
 expect(api.listAdminUsers).not.toHaveBeenCalled();
});
it("shows a revoked project error without retaining old member controls",async()=>{
 state.search="project=a";vi.spyOn(collaborationApi,"projects").mockResolvedValue({projects:[detail("a").project]});vi.spyOn(collaborationApi,"project").mockRejectedValue(new Error("PROJECT_NOT_FOUND"));mount(<MembersPage/>);
 await screen.findByRole("alert");expect(screen.queryByLabelText("已注册账号邮箱")).toBeNull();expect(api.listAdminUsers).not.toHaveBeenCalled();
});
it("redirects old team links into member management and keeps the selected identity",async()=>{
 TeamsPage();expect(state.redirect).toHaveBeenCalledWith("/members?view=collaboration");
 await TeamPage({params:Promise.resolve({teamId:"team/a"})});expect(state.redirect).toHaveBeenCalledWith("/members?team=team%2Fa");
});
it("keeps team-admin invitations available inside members without granting instance account access",async()=>{
 state.search="team=t";
 const team={id:"t",name:"Studio",role:"admin" as const,ownerId:"owner",revision:1,state:"active" as const,capabilities:{manageMembers:true,manageAdmins:false,inviteMembers:true,inviteAdmins:false,transferOwner:false,close:false,enrollOwnProjects:false}};
 vi.mocked(teamsApi.list).mockResolvedValue({teams:[team]});
 vi.spyOn(teamsApi,"detail").mockResolvedValue({team,members:[],projects:[]});
 vi.spyOn(teamsApi,"invitations").mockResolvedValue({invitations:[]});
 vi.spyOn(teamsApi,"plans").mockResolvedValue({plans:[]});
 mount(<MembersPage/>);
 expect(await screen.findByRole("button",{name:"创建邀请"})).toBeTruthy();
 expect(screen.queryByRole("link",{name:"账号管理"})).toBeNull();
 expect(api.listAdminUsers).not.toHaveBeenCalled();
});
