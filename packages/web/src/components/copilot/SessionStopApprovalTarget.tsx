"use client";

import { z } from 'zod';
import { useUiLocale } from "@/hooks/use-language";
import { useLanguage } from '@/hooks/use-language';
import type { CopilotPendingAction } from '@/lib/copilot-api';

const targetSchema = z.object({ sessionId: z.string(), observationId: z.string(), taskTitle: z.string(),
  projectName: z.string(), sessionName: z.string(), observedAt: z.number(), terminalExcerpt: z.string(),
  titleSource: z.enum(['terminal_footer', 'last_prompt', 'session_name']), executionScope: z.literal('session_process_group') });
type Target = z.infer<typeof targetSchema>;

export function getSessionStopApprovalTarget(action: CopilotPendingAction): Target | null {
  const intent = action.platformIntent;
  if (action.tool !== 'stop_session' || intent?.command_id !== 'session.stop') return null;
  try {
    const parsed = targetSchema.safeParse(JSON.parse(intent.resources_json).stopTarget);
    if (!parsed.success) return null;
    const target = parsed.data;
    for (const value of [action.inputJson, intent.input_json]) {
      const input = JSON.parse(value);
      if (input.sessionId !== target.sessionId || input.observationId !== target.observationId || input.expectedTitle !== target.taskTitle) return null;
    }
    return target;
  } catch { return null; }
}

interface Props { target: Target | null }

export function SessionStopApprovalTarget({ target }: Props) {
  const { t } = useLanguage();
  const locale = useUiLocale();
  if (!target) return <p role="alert" className="text-sm text-destructive">{t('copilot.stopTargetMissing')}</p>;
  return <div className="space-y-2 rounded-md border border-border/70 p-3 text-sm">
    <p className="font-medium">{t('copilot.stopTargetTitle')}</p>
    <p className="break-words font-semibold">{target.taskTitle}</p>
    <p>{target.projectName} · {target.sessionName}</p>
    <p className="break-all font-mono text-xs">{target.sessionId}</p>
    <p className="text-xs text-muted-foreground">{t(target.titleSource === 'terminal_footer' ? 'copilot.stopTitleTerminal'
      : target.titleSource === 'last_prompt' ? 'copilot.stopTitlePrompt' : 'copilot.stopTitleSession')} · {new Date(target.observedAt).toLocaleString(locale)}</p>
    <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-2 text-xs">{target.terminalExcerpt}</pre>
    <p className="text-xs text-muted-foreground">{t('copilot.stopTargetScope')}</p>
  </div>;
}
