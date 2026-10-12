import { expect, it } from 'vitest';
import { CopilotTextStream } from './copilot-text-stream';
const frame=(fence:number,sequence:number,text:string,step='step')=>({text_step_id:step,text_fence:fence,text_sequence:sequence,text_delta:text});
it('deduplicates, orders frames and replaces retried model-step text',()=>{
 const stream=new CopilotTextStream();
 expect(stream.accept('run',frame(1,1,'old '))).toBe('old ');
 expect(stream.accept('run',frame(1,1,'old '))).toBeUndefined();
 expect(stream.accept('run',frame(1,3,'third'))).toBe('old ');
 expect(stream.accept('run',frame(1,2,'second '))).toBe('old second third');
 expect(stream.accept('run',frame(2,1,'retry '))).toBe('retry ');
 expect(stream.accept('run',frame(1,4,'late'))).toBeUndefined();
 expect(stream.accept('run',frame(2,1,'next','step2'))).toBe('retry next');
 stream.clear();expect(stream.accept('new',frame(1,1,'new'))).toBe('new');
});
it('bounds malformed and missing sequence frames and resets on run changes',()=>{
 const stream=new CopilotTextStream();
 for(const value of [frame(0,1,'bad'),frame(1,0,'bad'),frame(1,1.5,'bad'),frame(1,1,'x'.repeat(4097))])expect(stream.accept('run',value)).toBeUndefined();
 expect(stream.accept('run',frame(1,65,'too far'))).toBeUndefined();
 expect(stream.accept('run',frame(1,2,'second'))).toBe('');
 expect(stream.accept('run',frame(1,1,'first '))).toBe('first second');
 expect(stream.accept('next-run',frame(1,1,'fresh'))).toBe('fresh');
});
it('rejects old workers across step identities after a higher run fence',()=>{
 const stream=new CopilotTextStream();
 expect(stream.accept('run',frame(1,1,'confirmed earlier ','completed-step'))).toBe('confirmed earlier ');
 expect(stream.accept('run',frame(2,1,'new answer','new-step'))).toBe('confirmed earlier new answer');
 expect(stream.accept('run',frame(1,1,' stale response','late-step'))).toBeUndefined();
 expect(stream.accept('run',frame(1,2,' obsolete extension','completed-step'))).toBeUndefined();
 expect(stream.accept('run',frame(2,2,'!','new-step'))).toBe('confirmed earlier new answer!');
 expect(stream.accept('next-run',frame(1,1,'fresh'))).toBe('fresh');
});

it('recovers missing deltas from a cumulative snapshot without replay or stale replacement', () => {
 const stream=new CopilotTextStream();
 expect(stream.accept('run',frame(1,1,'first '))).toBe('first ');
 expect(stream.accept('run',frame(1,3,'third '))).toBe('first ');
 expect(stream.gapKey()).toBeTruthy();
 expect(stream.restore('run',{steps:[{stepId:'step',fence:1,sequence:2,text:'first second '}]})).toBe('first second third ');
 expect(stream.gapKey()).toBe('');
 expect(stream.restore('run',{steps:[{stepId:'step',fence:1,sequence:1,text:'stale'}]})).toBe('first second third ');
 expect(stream.accept('run',frame(1,4,'fourth'))).toBe('first second third fourth');
 expect(stream.accept('run',frame(2,1,'retry'))).toBe('retry');
 expect(stream.restore('run',{steps:[{stepId:'step',fence:1,sequence:4,text:'old'}]})).toBe('retry');
});

it('preserves earlier step order when a partial snapshot only contains the current step',()=>{
 const stream=new CopilotTextStream();
 stream.accept('run',frame(1,1,'Earlier. ','earlier'));
 stream.accept('run',frame(1,1,'Later. ','later'));
 expect(stream.restore('run',{steps:[{stepId:'later',fence:1,sequence:2,text:'Later. continued.'}]})).toBe('Earlier. Later. continued.');
});

it('uses full server step order after reconnect while preserving newer local cursors',()=>{
 const stream=new CopilotTextStream();
 stream.accept('run',frame(1,1,'Later. ','later'));
 stream.accept('run',frame(1,2,'local','later'));
 expect(stream.restore('run',{steps:[{stepId:'earlier',fence:1,sequence:1,text:'Earlier. '},{stepId:'later',fence:1,sequence:1,text:'stale'}]})).toBe('Earlier. Later. local');
 expect(stream.restore('run',{steps:[{stepId:'later',fence:1,sequence:1,text:'stale'}]})).toBe('Earlier. Later. local');
});
