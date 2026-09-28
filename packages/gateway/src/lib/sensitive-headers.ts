/**
 * Header safety guards for the outbound model/balance fetch services.
 * Provider default headers must never carry credentials; these checks are
 * applied defensively whenever headers are merged into an outbound request.
 */
export function isSensitiveHeaderName(name: string): boolean {
  return /(^|[-_])(authorization|api[-_]?key|token|secret|credential|password|key)([-_]|$)/iu.test(name);
}

export function isSensitiveHeaderValue(value: string): boolean {
  return /(bearer\s+[A-Za-z0-9._-]+|sk-[A-Za-z0-9_-]+)/iu.test(value);
}
