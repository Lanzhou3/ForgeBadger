export class FeishuNotificationError extends Error {
  constructor(readonly code:string){super(code);}
}
