import { isCredentialField, redactAgentText } from './redaction.js';

/** Provisional public text. A possible credential freezes the remainder of this
 * response until full validation, including across newlines and empty chunks. */
export class PublicTextStream {
  private pending = '';
  private frozen = false;
  private sequence = 0;
  constructor(private publish: (text: string, sequence: number) => void) {}

  push(delta: string): void {
    this.pending += delta;
    if (this.frozen) return;
    if (this.pending.length > 16_384 || /sk-|Bearer|ChatGPT-Account-Id/i.test(this.pending)
      || [...this.pending.matchAll(/[A-Za-z][A-Za-z0-9_-]*/g)].some(match => isCredentialField(match[0]))) {
      this.frozen = true; return;
    }
    // Credential identifiers are ASCII. Whitespace and CJK text end them;
    // an introducer already freezes above. Keep partial ASCII tokens buffered.
    const boundary = this.pending.search(/[\s\u3400-\u9fff。！？；，、][^\s\u3400-\u9fff。！？；，、]*$/u);
    if (boundary < 0) return;
    const ready = this.pending.slice(0, boundary + 1);
    this.pending = this.pending.slice(boundary + 1);
    this.emit(ready);
  }

  finish(): void { this.emit(redactAgentText(this.pending)); this.pending = ''; }
  private emit(text: string): void {
    for (let offset = 0; offset < text.length; offset += 4096) this.publish(text.slice(offset, offset + 4096), ++this.sequence);
  }
}
