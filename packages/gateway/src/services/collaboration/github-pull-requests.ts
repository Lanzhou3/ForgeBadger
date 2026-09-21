import { z } from 'zod';
import { publicFetch } from '../extensions/public-fetch.js';
import { CollaborationError } from './types.js';

const branch = z.string().min(1).max(200).refine(value => !/\s|[~^:?*\[\\]|\.\.|@\{|\/\//.test(value)
  && !value.startsWith('-') && !value.startsWith('/') && !/[/.]$/.test(value) && !value.endsWith('.lock'));
export const draftPullRequestInput = z.object({
  expectedCommit: z.string().regex(/^[a-f0-9]{40}$/), verificationId: z.string().uuid(),
  repository: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}\/[a-zA-Z0-9_.-]{1,100}$/).refine(value => !['.','..'].includes(value.split('/')[1]!)),
  headBranch: branch, baseBranch: branch, title: z.string().trim().min(1).max(200),
  body: z.string().max(10000), token: z.string().min(10).max(512).regex(/^[a-zA-Z0-9_-]+$/)
}).strict();
export type DraftPullRequestInput = z.infer<typeof draftPullRequestInput>;
export interface GithubPullRequest { url: string; number: number; commit: string; draft: boolean }
export type GithubTransport = (url: string, init: RequestInit, authorize: () => void) => Promise<Response>;
const transport: GithubTransport = (url, init, authorize) => publicFetch(url, init, authorize, {allowQuery:true});
const prSchema = z.object({number:z.number().int().positive(),html_url:z.string(),draft:z.boolean(),state:z.string(),
  head:z.object({ref:z.string(),sha:z.string(),repo:z.object({full_name:z.string()}).nullable()}),
  base:z.object({ref:z.string(),repo:z.object({full_name:z.string()})})});

/** Fixed GitHub origin, DNS-pinned transport, no redirect/ambient credentials. */
export class GithubDraftClient {
  constructor(private readonly input:DraftPullRequestInput, private readonly authorize:()=>void,
    private readonly io:GithubTransport=transport) {}
  private async request(route:string, method='GET', body?:unknown):Promise<unknown> {
    this.authorize();
    let response:Response;
    try {
      response=await this.io(`https://api.github.com/repos/${this.input.repository}${route}`,{
        method,headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${this.input.token}`,
          'X-GitHub-Api-Version':'2022-11-28','User-Agent':'ForgeBadger','Content-Type':'application/json'},
        signal:AbortSignal.timeout(15000),...(body===undefined?{}:{body:JSON.stringify(body)})
      },this.authorize);
      if(!response.ok) { await response.body?.cancel(); throw new CollaborationError(409,'GITHUB_REQUEST_REJECTED'); }
      return await response.json() as unknown;
    } catch(error) {
      if(error instanceof CollaborationError) throw error;
      throw new CollaborationError(409,'GITHUB_RESPONSE_UNCERTAIN');
    }
  }
  async verifyRemote(baseCommit:string):Promise<void> {
    for(const [ref,expected,code] of [[this.input.headBranch,this.input.expectedCommit,'REMOTE_HEAD_MISMATCH'],
      [this.input.baseBranch,baseCommit,'REMOTE_BASE_MISMATCH']] as const) {
      const value=z.object({object:z.object({type:z.literal('commit'),sha:z.string()})}).safeParse(await this.request(`/git/ref/heads/${encodeURIComponent(ref)}`));
      if(!value.success||value.data.object.sha!==expected) throw new CollaborationError(409,code);
    }
  }
  private result(value:unknown):GithubPullRequest {
    const parsed=prSchema.safeParse(value),repository=this.input.repository.toLowerCase();
    if(!parsed.success) throw new CollaborationError(409,'GITHUB_INVALID_RESPONSE');
    const pr=parsed.data;
    if(pr.state!=='open'||pr.head.sha!==this.input.expectedCommit||pr.head.ref!==this.input.headBranch||pr.base.ref!==this.input.baseBranch
      ||pr.head.repo?.full_name.toLowerCase()!==repository||pr.base.repo.full_name.toLowerCase()!==repository)
      throw new CollaborationError(409,'GITHUB_PULL_REQUEST_MISMATCH');
    const url=`https://github.com/${this.input.repository}/pull/${pr.number}`;
    if(pr.html_url.toLowerCase()!==url.toLowerCase()) throw new CollaborationError(409,'GITHUB_INVALID_RESPONSE');
    return {url,number:pr.number,commit:pr.head.sha,draft:pr.draft};
  }
  async find():Promise<GithubPullRequest|null> {
    const query=new URLSearchParams({state:'open',head:`${this.input.repository.split('/')[0]}:${this.input.headBranch}`,base:this.input.baseBranch,per_page:'100'});
    const values=z.array(z.unknown()).max(100).safeParse(await this.request(`/pulls?${query}`));
    if(!values.success) throw new CollaborationError(409,'GITHUB_INVALID_RESPONSE');
    if(!values.data.length)return null;
    if(values.data.length!==1)throw new CollaborationError(409,'GITHUB_PULL_REQUEST_AMBIGUOUS');
    return this.result(values.data[0]);
  }
  async create():Promise<GithubPullRequest> {
    return this.result(await this.request('/pulls','POST',{title:this.input.title,body:this.input.body,
      head:this.input.headBranch,base:this.input.baseBranch,draft:true,maintainer_can_modify:false}));
  }
}
