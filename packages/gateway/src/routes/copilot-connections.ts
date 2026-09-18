import { Router } from 'express';
import { z } from 'zod';
import { authenticate, type AuthenticatedRequest } from '../auth/middleware.js';
import type { Database } from '../db/types.js';
import { CopilotConnections, presentConnection } from '../services/extensions/connections.js';
import type { McpClientOptions } from '../services/extensions/mcp-client.js';
const credential=z.string().min(1).max(4096).regex(/^[A-Za-z0-9._~+\/-]+=*$/);
const create=z.object({name:z.string().trim().min(1).max(80),endpoint:z.string().url().max(2048),bearerToken:credential.optional()}).strict();
const revision=z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const update=create.partial().extend({revision,bearerToken:credential.nullable().optional(),enabled:z.boolean().optional(),enabledTools:z.array(z.string().min(1).max(128)).max(100).optional()}).strict();
export function createCopilotConnectionRoutes(db: Database, masterKey: string, options: McpClientOptions = {}): Router {
 const router=Router();router.use(authenticate);
 router.use('/connections/:id',(req,res,next)=>{if(!z.string().uuid().safeParse(req.params.id).success){res.status(404).json({code:1,message:'Connection not found'});return;}next();});
 const service=(req:unknown)=>new CopilotConnections(db,(req as AuthenticatedRequest).userId,masterKey,options);
 router.get('/connections',(req,res)=>{res.json({code:0,data:{connections:[{id:'forgebadger',kind:'builtin',name:'ForgeBadger',endpoint:null,enabled:true,revision:1,hasCredential:false,status:'ready',tools:[],lastDiscoveredAt:null},...service(req).repo.list().map(presentConnection)]},message:''});});
 router.post('/connections',(req,res)=>{
  const parsed=create.safeParse(req.body);if(!parsed.success){res.status(400).json({code:1,message:'Invalid connection input'});return;}
  try {res.status(201).json({code:0,data:{connection:service(req).create(parsed.data)},message:''});} catch {res.status(400).json({code:1,message:'Could not create connection. Use a public HTTPS endpoint without query parameters.'});}
 });
 router.put('/connections/:id',(req,res)=>{
  const parsed=update.safeParse(req.body);if(!parsed.success){res.status(400).json({code:1,message:'Invalid connection input'});return;}
  const svc=service(req);if(!svc.repo.get(req.params.id)){res.status(404).json({code:1,message:'Connection not found'});return;}
  try {res.json({code:0,data:{connection:svc.update(req.params.id,parsed.data)},message:''});}catch {res.status(409).json({code:1,message:'Connection changed or configuration invalid; reload and check selected tools.'});}
 });
 router.post('/connections/:id/discover',async(req,res)=>{
  const parsed=z.object({revision}).strict().safeParse(req.body);if(!parsed.success){res.status(400).json({code:1,message:'Invalid discovery input'});return;}
  const svc=service(req);if(!svc.repo.get(req.params.id)){res.status(404).json({code:1,message:'Connection not found'});return;}
  try {res.json({code:0,data:{connection:await svc.discover(req.params.id,parsed.data.revision)},message:''});}catch {res.status(409).json({code:1,message:'Discovery failed or connection changed. Check endpoint and credentials, then reload.'});}
 });
 router.delete('/connections/:id',(req,res)=>{
  const parsed=z.coerce.number().int().min(1).safeParse(req.query.revision);if(!parsed.success){res.status(400).json({code:1,message:'Revision required'});return;}
  try {service(req).repo.delete(req.params.id,parsed.data);res.json({code:0,data:{deleted:true},message:''});}catch {res.status(409).json({code:1,message:'Connection changed; reload before deleting'});}
 });
 return router;
}
