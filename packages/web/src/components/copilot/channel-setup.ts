import type { ChannelIdentity, ChannelPairing, ChannelRoute } from '@/lib/copilot-channels-api';

interface SetupState {
  account: { enabled: boolean; secretConfigured: boolean } | null;
  configLoading: boolean;
  configError: boolean;
  config?: { enabled: boolean; emergencyDisabled: boolean };
  identities: ChannelIdentity[];
  staleIdentity: boolean;
  identity?: ChannelIdentity;
  pairing?: ChannelPairing;
  projectsLoading: boolean;
  projectsError: boolean;
  projectCount: number;
  selectedProject: boolean;
  existingRoute?: ChannelRoute;
}

export interface SetupBlocker { message: string; step: 'connection' | 'pairing' | 'authorization'; action: string }

/** Localized strings consumed by channelSetupBlocker; supplied by the copy module. */
export interface ChannelSetupCopy {
  connectionAction: string;
  pairingAction: string;
  authorizationAction: string;
  secretRequired: string;
  configChecking: string;
  configLoadFailed: string;
  channelDisabled: string;
  selectIdentity: string;
  identityClaimed: string;
  identityPending: string;
  identityStale: string;
  pairFirst: string;
  existingRoute: string;
  projectsLoading: string;
  projectsError: string;
  noProjects: string;
  selectProject: string;
}

/** Explains UI prerequisites; the Gateway remains the authority for every mutation. */
export function channelSetupBlocker(state: SetupState, copy: ChannelSetupCopy): SetupBlocker | undefined {
  const connection = (message: string): SetupBlocker => ({ message, step: 'connection', action: copy.connectionAction });
  const pairing = (message: string): SetupBlocker => ({ message, step: 'pairing', action: copy.pairingAction });
  const authorization = (message: string): SetupBlocker => ({ message, step: 'authorization', action: copy.authorizationAction });
  if (!state.account?.secretConfigured) return connection(copy.secretRequired);
  if (state.configLoading) return connection(copy.configChecking);
  if (state.configError || !state.config) return connection(copy.configLoadFailed);
  if (!state.account.enabled || !state.config.enabled || state.config.emergencyDisabled) {
    return connection(copy.channelDisabled);
  }
  if (!state.identity) {
    if (state.identities.length) return pairing(copy.selectIdentity);
    if (state.pairing?.status === 'claimed') return pairing(copy.identityClaimed);
    if (state.pairing?.status === 'pending') return pairing(copy.identityPending);
    return pairing(state.staleIdentity ? copy.identityStale : copy.pairFirst);
  }
  if (state.existingRoute) return authorization(copy.existingRoute);
  if (state.projectsLoading) return authorization(copy.projectsLoading);
  if (state.projectsError) return authorization(copy.projectsError);
  if (!state.projectCount) return authorization(copy.noProjects);
  if (!state.selectedProject) return authorization(copy.selectProject);
  return undefined;
}

export type ChannelOverallState =
  | 'not_connected'
  | 'pairing'
  | 'authorization'
  | 'running'
  | 'stopped'
  | 'unknown';

/**
 * Semantic states for an active channel route. Display labels live in the
 * copy module (routeStates); consumers must compare these keys, never labels.
 */
export type ChannelRouteStateKey =
  | 'authorized'
  | 'pending_review'
  | 'identity_inactive'
  | 'config_changed'
  | 'channel_disabled'
  | 'project_missing'
  | 'authority_revoked';

/** Route states that render as destructive badges. */
export const DESTRUCTIVE_ROUTE_STATES: readonly ChannelRouteStateKey[] = [
  'identity_inactive',
  'config_changed',
  'channel_disabled',
  'project_missing',
  'authority_revoked',
];

interface OverallStateInput {
  /** Any of the status queries failed or is still loading core inputs. */
  loadPending: boolean;
  /** At least one route is authorized. */
  authorized: boolean;
  /** At least one route reports pending review. */
  pendingReview: boolean;
  /** Account is connected but disabled or emergency-stopped. */
  stopped: boolean;
  blocker?: SetupBlocker;
}

/** Coarse channel status for the overview badge in the channels header. */
export function channelOverallState(state: OverallStateInput): ChannelOverallState {
  if (state.loadPending) return 'unknown';
  if (state.authorized) return 'running';
  if (state.stopped) return 'stopped';
  if (state.pendingReview) return 'authorization';
  if (!state.blocker) return 'authorization';
  if (state.blocker.step === 'pairing') return 'pairing';
  if (state.blocker.step === 'authorization') return 'authorization';
  return 'not_connected';
}

/** Semantic badge classes for a raw connection/health state. */
export function connectionBadgeClass(state: string): string {
  if (state === 'connected') return 'bg-emerald-500/15 text-emerald-400';
  if (state === 'connecting' || state === 'reconnecting') return 'bg-amber-500/15 text-amber-400';
  if (state === 'unhealthy') return 'bg-destructive/15 text-destructive';
  return 'text-muted-foreground';
}
