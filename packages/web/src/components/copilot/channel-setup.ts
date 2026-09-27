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

/** Explains UI prerequisites; the Gateway remains the authority for every mutation. */
export function channelSetupBlocker(state: SetupState): SetupBlocker | undefined {
  const connection = (message: string): SetupBlocker => ({ message, step: 'connection', action: '前往应用接入' });
  const pairing = (message: string): SetupBlocker => ({ message, step: 'pairing', action: '前往身份配对' });
  const authorization = (message: string): SetupBlocker => ({ message, step: 'authorization', action: '前往项目授权' });
  if (!state.account?.secretConfigured) return connection('请先在第 1 步保存机器人凭证并连接渠道。');
  if (state.configLoading) return connection('正在核查渠道配置，请稍候。');
  if (state.configError || !state.config) return connection('渠道配置加载失败，请重新加载后再授权。');
  if (!state.account.enabled || !state.config.enabled || state.config.emergencyDisabled) {
    return connection('渠道已停用或紧急停止，请先在第 1 步保存并连接。');
  }
  if (!state.identity) {
    if (state.identities.length) return pairing('请选择要授权的已确认私聊身份。');
    if (state.pairing?.status === 'claimed') return pairing('私聊已认领，请在第 2 步核对并确认身份。');
    if (state.pairing?.status === 'pending') return pairing('请向机器人私聊发送第 2 步的配对命令，然后返回确认身份。');
    return pairing(state.staleIdentity
      ? '身份已失效，请先在第 2 步重新配对并确认身份。'
      : '请先在第 2 步生成配对码，完成私聊认领并确认身份。');
  }
  if (state.existingRoute) return authorization('该身份已有渠道绑定；如需重新绑定或更换项目，请先撤销下方原绑定。');
  if (state.projectsLoading) return authorization('正在加载项目，请稍候。');
  if (state.projectsError) return authorization('项目加载失败，请重新加载后再授权。');
  if (!state.projectCount) return authorization('请先打开下方项目 Copilot 自治开关，再选择项目。');
  if (!state.selectedProject) return authorization('请选择要授权的项目。');
  return undefined;
}

export type ChannelOverallState =
  | 'not_connected'
  | 'pairing'
  | 'authorization'
  | 'running'
  | 'stopped'
  | 'unknown';

interface OverallStateInput {
  /** Any of the status queries failed or is still loading core inputs. */
  loadPending: boolean;
  /** At least one route reports 权限有效. */
  authorized: boolean;
  /** At least one route reports 授权状态待核查. */
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

const stateLabels: Record<string, string> = {
  pending: '待处理', claimed: '等待确认', confirmed: '已确认', cancelled: '已取消',
  active: '有效', revoked: '已撤销', sending: '发送中', delivered: '渠道已接收',
  failed: '发送失败', unknown: '结果不确定', connected: '已连接', connecting: '连接中',
  reconnecting: '重新连接中', unhealthy: '连接异常', stopped: '已停止', disabled: '未启用',
};

/** Localized label for channel/pairing/delivery states (zh defaults). */
export function channelStateLabel(state: string): string {
  return stateLabels[state] ?? state;
}

/** Semantic badge classes for a raw connection/health state. */
export function connectionBadgeClass(state: string): string {
  if (state === 'connected') return 'bg-emerald-500/15 text-emerald-400';
  if (state === 'connecting' || state === 'reconnecting') return 'bg-amber-500/15 text-amber-400';
  if (state === 'unhealthy') return 'bg-destructive/15 text-destructive';
  return 'text-muted-foreground';
}
