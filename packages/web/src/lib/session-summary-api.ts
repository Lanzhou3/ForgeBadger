import { fetchJson } from './api';
export interface CliSummaryExcerpt {text:string;source:'native_final_message'|'native_tool_event'|'native_error'|'managed_verification'}
export interface CliSessionSummary {
  version:1;runtimeEpoch:string;identityQuality:'exact_turn'|'session_only'|'unknown';
  nativeSessionId?:string;turnId?:string;state:string;observedAt:number;startedAt?:number;endedAt?:number;
  request?:string;result?:CliSummaryExcerpt;error?:CliSummaryExcerpt;errorCategory?:string;
  progress:CliSummaryExcerpt[];verification:CliSummaryExcerpt[];nextAction?:CliSummaryExcerpt;
}
export interface SessionSummaryState {summary:CliSessionSummary|null;latestResult:CliSessionSummary|null;workState:'working'|'idle'|'unknown'}
export const getSessionSummary=(id:string)=>fetchJson<SessionSummaryState>(`/api/v1/sessions/${encodeURIComponent(id)}/summary`);
