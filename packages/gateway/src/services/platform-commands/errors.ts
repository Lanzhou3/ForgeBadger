/** Only commands that have not started any durable or external effect may throw this. */
export class PlatformNoEffectError extends Error {
    readonly httpStatus: number;
    constructor(message: string, httpStatus = 409) {
        super(message);
        this.name = 'PlatformNoEffectError';
        this.httpStatus = httpStatus;
    }
}
