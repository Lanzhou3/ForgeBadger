import type { ActionReceipt } from '../../db/repositories/platform-action-repository.js';
import { redactAgentValue } from '../agent/redaction.js';
export function projectActionReceipt(receipt:ActionReceipt):string {
 if(receipt.outcome==='no_effect')return `Tool error: ${JSON.stringify(redactAgentValue({platformIntentId:receipt.intentId,receiptOutcome:receipt.outcome,result:receipt.result}))}`;
 if(receipt.outcome==='unknown')return `Tool error: Action effect is unknown; automatic replay prohibited. ${JSON.stringify(redactAgentValue({platformIntentId:receipt.intentId,receiptOutcome:receipt.outcome,result:receipt.result}))}`;
 return JSON.stringify(redactAgentValue({platformIntentId:receipt.intentId,receiptOutcome:receipt.outcome,result:receipt.result}));
}
