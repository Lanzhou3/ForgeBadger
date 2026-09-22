import {acquireOperation,releaseOperation} from './operation-fence.js';
import {createHash,randomUUID} from 'node:crypto';
import type {DeliveryService} from './delivery-service.js';
import {DeliveryEvidence} from './delivery-evidence.js';
import {inspectWorktree} from './git-workspaces.js';
import {CollaborationError,type DeliveryRun} from './types.js';
import {GithubDraftClient,type DraftPullRequestInput,type GithubTransport,type GithubPullRequest} from './github-pull-requests.js';

interface PullRequestRecord {id:string;state:'checking'|'creating'|'created'|'unknown';url:string|null;number:number|null;draft:number|null}
export class DeliveryActions {
  constructor(private readonly service:DeliveryService, private readonly github?:GithubTransport) {}
  async reconcile(actorId:string,projectId:string,runId:string,expectedCommit:string,idempotencyKey:string) {
    const {access,repo,run}=this.service.context(actorId,projectId,runId,'develop');
    if(run.actor_id!==actorId)throw new CollaborationError(403,'PRIVATE_EXECUTION_OWNER_REQUIRED');
    if(!run.base_commit)throw new CollaborationError(409,'NO_RECORDED_CHECKPOINT');
    const existing=repo.byKey(actorId,idempotencyKey);
    if(existing) return this.service.prepare(actorId,projectId,run.work_item_id,{aiTool:run.adapter,idempotencyKey},undefined,expectedCommit);
    if(!['ready','closed','revoking'].includes(run.state))throw new CollaborationError(409,'WORKSPACE_NOT_READY');
    if(run.authority_epoch!==access.authorityEpoch||run.membership_revision!==access.membershipRevision)throw new CollaborationError(403,'EXECUTION_REVOKED');
    if(run.state==='ready')this.service.assertExecutor(run,actorId);
    this.service.authority(actorId).access(projectId,'develop');
    repo.state(run,'revoking');
    if(run.session_id)this.service.options.invalidator?.invalidate({scope:'session',userId:actorId,sessionId:run.session_id});
    if(!await this.service.stop(run))throw new CollaborationError(409,'EXECUTION_STOP_PENDING');
    repo.state(run,'closed','RECONCILED_TO_NEW_WORKSPACE');
    const before=await inspectWorktree({path:run.workspace_path,baseCommit:run.base_commit});
    if(before.commit!==expectedCommit)throw new CollaborationError(409,'WORKSPACE_COMMIT_CHANGED');
    const result=await this.service.prepare(actorId,projectId,run.work_item_id,{aiTool:run.adapter,idempotencyKey},undefined,expectedCommit);
    this.service.authority(actorId).event(access,run.work_item_id,'workspace_reconciled',{oldRunId:run.id,runId:result.run.id,commit:expectedCommit});
    return result;
  }
  async pullRequest(actorId:string,projectId:string,runId:string,input:DraftPullRequestInput) {
    const {run}=this.service.context(actorId,projectId,runId,'develop');
    const work=async()=>{
      acquireOperation(this.service.options.db,run,'pull_request',input.expectedCommit);
      try{return await this.pullRequestLocked(actorId,projectId,run,input);}
      finally{releaseOperation(this.service.options.db,run);}
    };
    const manager=this.service.options.sessionManager;
    return run.session_id&&manager?manager.runExclusive(run.session_id,work):work();
  }
  private async pullRequestLocked(actorId:string,projectId:string,run:DeliveryRun,input:DraftPullRequestInput) {
    const {access,repo}=this.service.context(actorId,projectId,run.id,'develop');
    const authorize=()=>{
      const current=this.service.assertExecutor(repo.get(projectId,run.id),actorId);
      if(!this.service.authority(actorId).policy(current).executionEnabled)throw new CollaborationError(409,'HOST_EXECUTION_NOT_ENABLED');
      const receipt=repo.getReceipt(run,input.verificationId),authority=this.service.authority(actorId);
      if(receipt.status!=='passed'||receipt.commit_sha!==input.expectedCommit
        ||receipt.task_digest!==this.service.tasks(actorId).digest(access,run.work_item_id)
        ||receipt.policy_revision!==authority.policy(access).verificationRevision)
        throw new CollaborationError(409,'CURRENT_VERIFICATION_REQUIRED');
    };
    authorize();await new DeliveryEvidence(this.service).ensureStopped(run);
    const git=await inspectWorktree({path:run.workspace_path,baseCommit:run.base_commit});
    if(git.dirty||git.commit!==input.expectedCommit)throw new CollaborationError(409,'COMMIT_CHANGES_BEFORE_PULL_REQUEST');
    if(input.headBranch!==run.branch||input.baseBranch!==run.target_branch)throw new CollaborationError(409,'PULL_REQUEST_BRANCH_MISMATCH');
    const client=new GithubDraftClient(input,authorize,this.github);
    await client.verifyRemote(run.base_commit);
    const digest=createHash('sha256').update(JSON.stringify({repository:input.repository.toLowerCase(),head:input.headBranch,base:input.baseBranch,commit:input.expectedCommit})).digest('hex');
    const saved=this.record(run,actorId,digest);
    if(saved?.state==='created')return {pullRequest:{url:saved.url!,number:saved.number!,commit:input.expectedCommit,draft:!!saved.draft},run:repo.dto(repo.get(projectId,run.id),actorId)};
    const found=await client.find();
    if(found){authorize();return this.accept(run,actorId,input,digest,found);}
    // A previous request may have reached GitHub even if no reply or local commit
    // survived. Retrying only looks it up; it never replays an unknown POST.
    if(saved)throw new CollaborationError(409,'GITHUB_REQUEST_PENDING');
    const marker=this.insert(run,actorId,input,digest);
    try {
      authorize();
      this.service.options.db.prepare("UPDATE delivery_pull_requests SET state='creating',updated_at=? WHERE id=? AND user_id=?").run(Date.now(),marker,run.user_id);
      const created=await client.create();authorize();
      return this.accept(run,actorId,input,digest,created);
    } catch(error) {
      this.service.options.db.prepare("UPDATE delivery_pull_requests SET state='unknown',updated_at=? WHERE id=? AND user_id=? AND state!='created'").run(Date.now(),marker,run.user_id);
      if(error instanceof CollaborationError)throw error;
      throw new CollaborationError(409,'GITHUB_RESPONSE_UNCERTAIN');
    }
  }
  private record(run:DeliveryRun,actorId:string,digest:string):PullRequestRecord|undefined {
    return this.service.options.db.prepare('SELECT id,state,url,number,draft FROM delivery_pull_requests WHERE user_id=? AND project_id=? AND run_id=? AND actor_id=? AND request_digest=?')
      .get(run.user_id,run.project_id,run.id,actorId,digest) as PullRequestRecord|undefined;
  }
  private insert(run:DeliveryRun,actorId:string,input:DraftPullRequestInput,digest:string):string {
    const id=randomUUID(),now=Date.now();
    try { this.service.options.db.prepare(`INSERT INTO delivery_pull_requests(id,user_id,project_id,run_id,actor_id,request_digest,repository,head_branch,base_branch,commit_sha,state,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,'checking',?,?)`).run(id,run.user_id,run.project_id,run.id,actorId,digest,input.repository,input.headBranch,input.baseBranch,input.expectedCommit,now,now); }
    catch {throw new CollaborationError(409,'GITHUB_REQUEST_PENDING');}
    return id;
  }
  private accept(run:DeliveryRun,actorId:string,input:DraftPullRequestInput,digest:string,pr:GithubPullRequest) {
    const authority=this.service.authority(actorId),access=authority.access(run.project_id,'develop'),repo=this.service.repository(access);
    this.service.options.db.transaction(()=>{
      const id=this.record(run,actorId,digest)?.id??this.insert(run,actorId,input,digest);
      this.service.options.db.prepare("UPDATE delivery_pull_requests SET state='created',url=?,number=?,draft=?,updated_at=? WHERE id=? AND user_id=?")
        .run(pr.url,pr.number,Number(pr.draft),Date.now(),id,run.user_id);
      const current=repo.get(run.project_id,run.id);
      this.service.assertExecutor(current,actorId);
      repo.links(current,current.preview_url,pr.url);
      authority.event(access,run.work_item_id,'draft_pull_request_recorded',{runId:run.id,repository:input.repository,url:pr.url,commit:pr.commit});
    })();
    return {pullRequest:pr,run:repo.dto(repo.get(run.project_id,run.id),actorId)};
  }
}
