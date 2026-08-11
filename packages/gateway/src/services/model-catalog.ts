export interface ModelPreset {
  id: string;
  label: string;
  provider: string;
  modelId: string;
  endpoint: string;
  tier: "performance" | "balanced" | "budget" | "local";
}

export type ProviderAuthType = "api_key" | "bearer_token" | "oauth" | "none";
export type ProviderApiFormat = "anthropic" | "openai" | "openai-compatible" | "google" | "bedrock" | "local";
export type ProviderSupportedAdapter = "claude" | "opencode";
export type ProviderModelSource = "static" | "dynamic" | "models.dev";
export type ProviderCatalogSource = "verified" | "models.dev";
export type ProviderProductType = "payg_api" | "coding_plan" | "token_plan" | "subscription" | "local";

export interface ProviderProtocolEndpoint {
  baseUrl: string;
}

export interface ProviderModelPreset {
  id: string;
  name: string;
  modelId: string;
  capabilities: string[];
  contextWindow?: number;
}

export interface ProviderCatalogPreset {
  id: string;
  name: string;
  description: string;
  baseUrl: string;
  region: string;
  productType: ProviderProductType;
  authType: ProviderAuthType;
  apiFormat: ProviderApiFormat;
  supportedAdapters: ProviderSupportedAdapter[];
  modelSource: ProviderModelSource;
  endpoints: {
    anthropic?: ProviderProtocolEndpoint;
    openai?: ProviderProtocolEndpoint;
  };
  modelFetch?: {
    strategy: "openai-compatible";
    modelsUrl?: string;
  };
  defaultModels: ProviderModelPreset[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
  source?: ProviderCatalogSource;
  claude?: {
    env: {
      baseUrl: string;
      authToken: string;
      model: string;
      smallFastModel: string;
      defaultSonnetModel: string;
      defaultHaikuModel: string;
      defaultOpusModel: string;
      apiTimeoutMs: string;
    };
    defaultSmallFastModel?: string;
  };
  opencode?: {
    npm: string;
    api?: string;
    env: string[];
  };
}

export interface ModelGroup<TModel> {
  provider: string;
  count: number;
  models: TModel[];
}

export interface ModelsDevModel {
  id: string;
  name: string;
  family?: string;
  release_date: string;
  attachment: boolean;
  reasoning: boolean;
  temperature: boolean;
  tool_call: boolean;
  interleaved?: boolean | { field: "reasoning_content" | "reasoning_details" };
  status?: string;
  limit: {
    context: number;
    input?: number;
    output: number;
  };
  modalities?: {
    input: string[];
    output: string[];
  };
  provider?: {
    npm?: string;
    api?: string;
  };
}

export interface ModelsDevProvider {
  id: string;
  name: string;
  env: string[];
  api?: string;
  npm?: string;
  models: Record<string, ModelsDevModel>;
}

export type ModelsDevCatalog = Record<string, ModelsDevProvider>;

export interface LoadProviderCatalogOptions {
  fetchImpl?: typeof fetch;
  sourceUrl?: string;
  timeoutMs?: number;
}

const modelsDevUrl = "https://models.dev/api.json";
const catalogFetchTimeoutMs = 3_000;
const catalogCacheTtlMs = 5 * 60 * 1000;
let providerCatalogCache: { expiresAt: number; providers: ProviderCatalogPreset[] } | undefined;
let modelsDevFailureCacheUntil = 0;

const claudeEnv = {
  baseUrl: "ANTHROPIC_BASE_URL",
  authToken: "ANTHROPIC_AUTH_TOKEN",
  model: "ANTHROPIC_MODEL",
  smallFastModel: "ANTHROPIC_SMALL_FAST_MODEL",
  defaultSonnetModel: "ANTHROPIC_DEFAULT_SONNET_MODEL",
  defaultHaikuModel: "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  defaultOpusModel: "ANTHROPIC_DEFAULT_OPUS_MODEL",
  apiTimeoutMs: "API_TIMEOUT_MS"
};

const providerCatalog: ProviderCatalogPreset[] = [
  providerProduct({
    id: "anthropic-api",
    name: "Anthropic API",
    description: "Official Anthropic API for Claude models.",
    region: "global",
    productType: "payg_api",
    apiFormat: "anthropic",
    anthropicBaseUrl: "https://api.anthropic.com",
    opencodeNpm: "@ai-sdk/anthropic",
    envName: "ANTHROPIC_API_KEY",
    defaultModels: [
      model("claude-sonnet-4-5", "Claude Sonnet 4.5", ["chat", "code", "reasoning"], 200000),
      model("claude-haiku-4-5", "Claude Haiku 4.5", ["chat", "code"], 200000)
    ],
    smallFastModel: "claude-haiku-4-5"
  }),
  providerProduct({
    id: "deepseek-api",
    name: "DeepSeek API",
    description: "DeepSeek API with OpenAI and Anthropic-compatible endpoints.",
    region: "global",
    productType: "payg_api",
    apiFormat: "openai-compatible",
    anthropicBaseUrl: "https://api.deepseek.com/anthropic",
    openaiBaseUrl: "https://api.deepseek.com",
    envName: "DEEPSEEK_API_KEY",
    defaultModels: [
      model("deepseek-chat", "DeepSeek Chat", ["chat", "code"], 64000),
      model("deepseek-reasoner", "DeepSeek Reasoner", ["chat", "code", "reasoning"], 64000)
    ],
    smallFastModel: "deepseek-chat"
  }),
  providerProduct({
    id: "qwen-payg-cn",
    name: "Qwen API 中国大陆",
    description: "Alibaba Cloud Model Studio pay-as-you-go endpoint for mainland China accounts.",
    region: "cn",
    productType: "payg_api",
    apiFormat: "openai-compatible",
    anthropicBaseUrl: "https://dashscope.aliyuncs.com/apps/anthropic",
    openaiBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    envName: "DASHSCOPE_API_KEY",
    defaultModels: [
      model("qwen3.5-plus", "Qwen3.5 Plus", ["chat", "code", "reasoning"], 256000),
      model("qwen3.5-coder", "Qwen3.5 Coder", ["chat", "code"], 256000)
    ],
    smallFastModel: "qwen3.5-coder"
  }),
  providerProduct({
    id: "qwen-payg-intl-sg",
    name: "Qwen API 国际版",
    description: "Alibaba Cloud Model Studio international endpoint.",
    region: "intl-sg",
    productType: "payg_api",
    apiFormat: "openai-compatible",
    anthropicBaseUrl: "https://dashscope-intl.aliyuncs.com/apps/anthropic",
    openaiBaseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    envName: "DASHSCOPE_API_KEY",
    defaultModels: [
      model("qwen3.5-plus", "Qwen3.5 Plus", ["chat", "code", "reasoning"], 256000),
      model("qwen3.5-coder", "Qwen3.5 Coder", ["chat", "code"], 256000)
    ],
    smallFastModel: "qwen3.5-coder"
  }),
  providerProduct({
    id: "qwen-coding-plan-cn",
    name: "Qwen Coding Plan 中国大陆",
    description: "Alibaba Cloud Model Studio Coding Plan endpoint for mainland China.",
    region: "cn",
    productType: "coding_plan",
    apiFormat: "openai-compatible",
    anthropicBaseUrl: "https://coding.dashscope.aliyuncs.com/apps/anthropic",
    openaiBaseUrl: "https://coding.dashscope.aliyuncs.com/v1",
    envName: "DASHSCOPE_API_KEY",
    defaultModels: [
      model("qwen3.6-plus", "Qwen3.6 Plus", ["chat", "code", "reasoning"], 256000),
      model("qwen3-coder-plus", "Qwen3 Coder Plus", ["chat", "code", "reasoning"], 256000),
      model("qwen3-coder-next", "Qwen3 Coder Next", ["chat", "code", "reasoning"], 256000),
      model("qwen3.5-plus", "Qwen3.5 Plus", ["chat", "code", "reasoning"], 256000),
      model("qwen3-max-2026-01-23", "Qwen3 Max 2026-01-23", ["chat", "code", "reasoning"], 256000),
      model("kimi-k2.5", "Kimi K2.5", ["chat", "code", "reasoning"], 256000),
      model("glm-5", "GLM-5", ["chat", "code", "reasoning"], 256000),
      model("MiniMax-M2.5", "MiniMax M2.5", ["chat", "code", "reasoning"], 256000),
      model("glm-4.7", "GLM-4.7", ["chat", "code", "reasoning"], 256000)
    ],
    smallFastModel: "qwen3-coder-plus"
  }),
  providerProduct({
    id: "qwen-coding-plan-intl",
    name: "Qwen Coding Plan 国际版",
    description: "Alibaba Cloud Model Studio Coding Plan international endpoint.",
    region: "intl",
    productType: "coding_plan",
    apiFormat: "openai-compatible",
    anthropicBaseUrl: "https://coding-intl.dashscope.aliyuncs.com/apps/anthropic",
    openaiBaseUrl: "https://coding-intl.dashscope.aliyuncs.com/v1",
    envName: "DASHSCOPE_API_KEY",
    defaultModels: [
      model("qwen3.6-plus", "Qwen3.6 Plus", ["chat", "code", "reasoning"], 256000),
      model("qwen3-coder-plus", "Qwen3 Coder Plus", ["chat", "code", "reasoning"], 256000),
      model("qwen3-coder-next", "Qwen3 Coder Next", ["chat", "code", "reasoning"], 256000),
      model("qwen3.5-plus", "Qwen3.5 Plus", ["chat", "code", "reasoning"], 256000)
    ],
    smallFastModel: "qwen3-coder-plus"
  }),
  providerProduct({
    id: "qwen-token-plan-cn",
    name: "Qwen Token Plan 中国大陆",
    description: "Alibaba Cloud Model Studio Token Plan endpoint for mainland China.",
    region: "cn",
    productType: "token_plan",
    apiFormat: "openai-compatible",
    anthropicBaseUrl: "https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic",
    openaiBaseUrl: "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
    envName: "DASHSCOPE_API_KEY",
    defaultModels: [
      model("qwen3.5-coder", "Qwen3.5 Coder", ["chat", "code", "reasoning"], 256000),
      model("qwen3.5-plus", "Qwen3.5 Plus", ["chat", "code", "reasoning"], 256000)
    ],
    smallFastModel: "qwen3.5-coder"
  }),
  providerProduct({
    id: "kimi-code",
    name: "Kimi Code",
    description: "Kimi Code coding subscription endpoint.",
    region: "global",
    productType: "coding_plan",
    apiFormat: "openai-compatible",
    anthropicBaseUrl: "https://api.kimi.com/coding/",
    openaiBaseUrl: "https://api.kimi.com/coding/v1",
    envName: "KIMI_API_KEY",
    defaultModels: [
      model("kimi-k2.5", "Kimi K2.5", ["chat", "code", "reasoning", "vision"], 128000),
      model("kimi-k2", "Kimi K2", ["chat", "code"], 128000)
    ],
    smallFastModel: "kimi-k2"
  }),
  providerProduct({
    id: "minimax-global",
    name: "MiniMax 国际版",
    description: "MiniMax international API endpoint for coding tools.",
    region: "global",
    productType: "payg_api",
    apiFormat: "openai-compatible",
    anthropicBaseUrl: "https://api.minimax.io/anthropic",
    openaiBaseUrl: "https://api.minimax.io/v1",
    envName: "MINIMAX_API_KEY",
    defaultModels: [
      model("MiniMax-M3", "MiniMax M3", ["chat", "code", "reasoning", "vision"], 1000000)
    ],
    smallFastModel: "MiniMax-M3"
  }),
  providerProduct({
    id: "minimax-cn",
    name: "MiniMax 中国大陆",
    description: "MiniMax mainland China API endpoint for coding tools.",
    region: "cn",
    productType: "payg_api",
    apiFormat: "openai-compatible",
    anthropicBaseUrl: "https://api.minimaxi.com/anthropic",
    openaiBaseUrl: "https://api.minimaxi.com/v1",
    envName: "MINIMAX_API_KEY",
    defaultModels: [
      model("MiniMax-M3", "MiniMax M3", ["chat", "code", "reasoning", "vision"], 1000000)
    ],
    smallFastModel: "MiniMax-M3"
  }),
  providerProduct({
    id: "zai-coding-plan",
    name: "Z.AI GLM Coding Plan",
    description: "Z.AI coding plan endpoints for GLM coding models.",
    region: "global",
    productType: "coding_plan",
    apiFormat: "openai-compatible",
    anthropicBaseUrl: "https://api.z.ai/api/anthropic",
    openaiBaseUrl: "https://api.z.ai/api/coding/paas/v4",
    envName: "ZAI_API_KEY",
    defaultModels: [
      model("glm-4.7", "GLM-4.7", ["chat", "code", "reasoning"], 128000),
      model("glm-4.5-air", "GLM-4.5 Air", ["chat", "code"], 128000)
    ],
    smallFastModel: "glm-4.5-air"
  }),
  providerProduct({
    id: "xiaomi-mimo-api",
    name: "Xiaomi MiMo API",
    description: "Xiaomi MiMo pay-as-you-go API with OpenAI and Anthropic-compatible endpoints.",
    region: "global",
    productType: "payg_api",
    apiFormat: "openai-compatible",
    anthropicBaseUrl: "https://api.xiaomimimo.com/anthropic",
    openaiBaseUrl: "https://api.xiaomimimo.com/v1",
    envName: "MIMO_API_KEY",
    supportsTools: false,
    defaultModels: [
      model("mimo-v2.5-pro", "MiMo V2.5 Pro", ["chat", "code", "reasoning"], 1000000),
      model("mimo-v2", "MiMo V2", ["chat", "code"], 1000000),
      model("mimo-v2.5-flash", "MiMo V2.5 Flash", ["chat", "code"], 1000000)
    ],
    smallFastModel: "mimo-v2.5-flash"
  }),
  providerProduct({
    id: "xiaomi-mimo-token-plan-cn",
    name: "Xiaomi MiMo Token Plan 中国大陆",
    description: "Xiaomi MiMo Token Plan endpoint for mainland China.",
    region: "cn",
    productType: "token_plan",
    apiFormat: "openai-compatible",
    anthropicBaseUrl: "https://token-plan-cn.xiaomimimo.com/anthropic",
    openaiBaseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
    envName: "MIMO_API_KEY",
    supportsTools: false,
    defaultModels: [
      model("mimo-v2.5-pro", "MiMo V2.5 Pro", ["chat", "code", "reasoning"], 1000000),
      model("mimo-v2.5-flash", "MiMo V2.5 Flash", ["chat", "code"], 1000000)
    ],
    smallFastModel: "mimo-v2.5-flash"
  }),
  providerProduct({
    id: "xiaomi-mimo-token-plan-sgp",
    name: "Xiaomi MiMo Token Plan Singapore",
    description: "Xiaomi MiMo Token Plan endpoint for Singapore.",
    region: "sgp",
    productType: "token_plan",
    apiFormat: "openai-compatible",
    anthropicBaseUrl: "https://token-plan-sgp.xiaomimimo.com/anthropic",
    openaiBaseUrl: "https://token-plan-sgp.xiaomimimo.com/v1",
    envName: "MIMO_API_KEY",
    supportsTools: false,
    defaultModels: [
      model("mimo-v2.5-pro", "MiMo V2.5 Pro", ["chat", "code", "reasoning"], 1000000),
      model("mimo-v2.5-flash", "MiMo V2.5 Flash", ["chat", "code"], 1000000)
    ],
    smallFastModel: "mimo-v2.5-flash"
  }),
  providerProduct({
    id: "xiaomi-mimo-token-plan-ams",
    name: "Xiaomi MiMo Token Plan Europe",
    description: "Xiaomi MiMo Token Plan endpoint for Amsterdam/Europe.",
    region: "eu",
    productType: "token_plan",
    apiFormat: "openai-compatible",
    anthropicBaseUrl: "https://token-plan-ams.xiaomimimo.com/anthropic",
    openaiBaseUrl: "https://token-plan-ams.xiaomimimo.com/v1",
    envName: "MIMO_API_KEY",
    supportsTools: false,
    defaultModels: [
      model("mimo-v2.5-pro", "MiMo V2.5 Pro", ["chat", "code", "reasoning"], 1000000),
      model("mimo-v2.5-flash", "MiMo V2.5 Flash", ["chat", "code"], 1000000)
    ],
    smallFastModel: "mimo-v2.5-flash"
  }),
  providerProduct({
    id: "kimi-api",
    name: "Kimi API",
    description: "Moonshot AI Kimi pay-as-you-go endpoint with Anthropic and OpenAI-compatible APIs.",
    region: "cn",
    productType: "payg_api",
    apiFormat: "openai-compatible",
    anthropicBaseUrl: "https://api.moonshot.cn/anthropic",
    openaiBaseUrl: "https://api.moonshot.cn/v1",
    envName: "KIMI_API_KEY",
    modelsUrl: "https://api.moonshot.cn/v1/models",
    defaultModels: [
      model("kimi-k2.7-code", "Kimi K2.7 Code", ["chat", "code", "reasoning"], 128000),
      model("kimi-k2.5", "Kimi K2.5", ["chat", "code"], 128000)
    ],
    smallFastModel: "kimi-k2.5"
  }),
  providerProduct({
    id: "zai-glm-api",
    name: "Z.AI GLM API",
    description: "Z.AI GLM pay-as-you-go endpoint with Anthropic and OpenAI-compatible APIs.",
    region: "global",
    productType: "payg_api",
    apiFormat: "openai-compatible",
    anthropicBaseUrl: "https://api.z.ai/api/anthropic",
    openaiBaseUrl: "https://api.z.ai/api/paas/v4",
    envName: "ZAI_API_KEY",
    modelsUrl: "https://api.z.ai/api/paas/v4/models",
    defaultModels: [
      model("glm-5.1", "GLM-5.1", ["chat", "code", "reasoning"], 128000),
      model("glm-4.5-air", "GLM-4.5 Air", ["chat", "code"], 128000)
    ],
    smallFastModel: "glm-4.5-air"
  }),
  providerProduct({
    id: "baidu-qianfan-coding-plan",
    name: "Baidu Qianfan Coding Plan",
    description: "Baidu Qianfan Coding Plan endpoint for AI coding tools.",
    region: "cn",
    productType: "coding_plan",
    apiFormat: "openai-compatible",
    anthropicBaseUrl: "https://qianfan.baidubce.com/anthropic/coding",
    openaiBaseUrl: "https://qianfan.baidubce.com/v2",
    envName: "QIANFAN_API_KEY",
    modelsUrl: "https://qianfan.baidubce.com/v2/models",
    defaultModels: [
      model("qianfan-code-latest", "Qianfan Code Latest", ["chat", "code", "reasoning"], 128000)
    ],
    smallFastModel: "qianfan-code-latest"
  }),
  providerProduct({
    id: "stepfun-coding-plan-cn",
    name: "StepFun Coding Plan 中国大陆",
    description: "StepFun coding plan endpoint for mainland China.",
    region: "cn",
    productType: "coding_plan",
    apiFormat: "openai-compatible",
    anthropicBaseUrl: "https://api.stepfun.com/step_plan",
    openaiBaseUrl: "https://api.stepfun.com/v1",
    envName: "STEPFUN_API_KEY",
    modelsUrl: "https://api.stepfun.com/v1/models",
    defaultModels: [
      model("step-3.5-flash-2603", "Step 3.5 Flash 2603", ["chat", "code"], 128000)
    ],
    smallFastModel: "step-3.5-flash-2603"
  }),
  providerProduct({
    id: "stepfun-coding-plan-intl",
    name: "StepFun Coding Plan 国际版",
    description: "StepFun coding plan international endpoint.",
    region: "intl",
    productType: "coding_plan",
    apiFormat: "openai-compatible",
    anthropicBaseUrl: "https://api.stepfun.ai/step_plan",
    openaiBaseUrl: "https://api.stepfun.ai/v1",
    envName: "STEPFUN_API_KEY",
    modelsUrl: "https://api.stepfun.ai/v1/models",
    defaultModels: [
      model("step-3.5-flash-2603", "Step 3.5 Flash 2603", ["chat", "code"], 128000)
    ],
    smallFastModel: "step-3.5-flash-2603"
  }),
  providerProduct({
    id: "modelscope-api",
    name: "ModelScope API",
    description: "ModelScope inference endpoint with Anthropic and OpenAI-compatible APIs.",
    region: "cn",
    productType: "payg_api",
    apiFormat: "openai-compatible",
    anthropicBaseUrl: "https://api-inference.modelscope.cn",
    openaiBaseUrl: "https://api-inference.modelscope.cn/v1",
    envName: "MODELSCOPE_API_KEY",
    modelsUrl: "https://api-inference.modelscope.cn/v1/models",
    defaultModels: [
      model("ZhipuAI/GLM-5.1", "GLM-5.1", ["chat", "code", "reasoning"], 128000)
    ],
    smallFastModel: "ZhipuAI/GLM-5.1"
  }),
  providerProduct({
    id: "siliconflow-api",
    name: "SiliconFlow 硅基流动",
    description: "SiliconFlow model API platform with Anthropic and OpenAI-compatible endpoints.",
    region: "cn",
    productType: "payg_api",
    apiFormat: "openai-compatible",
    anthropicBaseUrl: "https://api.siliconflow.cn",
    openaiBaseUrl: "https://api.siliconflow.cn/v1",
    envName: "SILICONFLOW_API_KEY",
    modelsUrl: "https://api.siliconflow.cn/v1/models",
    defaultModels: [
      model("Pro/MiniMaxAI/MiniMax-M2.7", "MiniMax M2.7 Pro", ["chat", "code", "reasoning"], 200000),
      model("deepseek-ai/DeepSeek-V3.2", "DeepSeek V3.2", ["chat", "code", "reasoning"], 128000)
    ],
    smallFastModel: "deepseek-ai/DeepSeek-V3.2"
  }),
  providerProduct({
    id: "siliconflow-intl",
    name: "SiliconFlow 国际版",
    description: "SiliconFlow international endpoint.",
    region: "intl",
    productType: "payg_api",
    apiFormat: "openai-compatible",
    anthropicBaseUrl: "https://api.siliconflow.com",
    openaiBaseUrl: "https://api.siliconflow.com/v1",
    envName: "SILICONFLOW_API_KEY",
    modelsUrl: "https://api.siliconflow.com/v1/models",
    defaultModels: [
      model("MiniMaxAI/MiniMax-M2.7", "MiniMax M2.7", ["chat", "code", "reasoning"], 200000),
      model("deepseek-ai/DeepSeek-V3.2", "DeepSeek V3.2", ["chat", "code", "reasoning"], 128000)
    ],
    smallFastModel: "deepseek-ai/DeepSeek-V3.2"
  }),
  providerProduct({
    id: "volcengine-agent-plan-cn",
    name: "火山引擎 Agent Plan 中国大陆",
    description: "Volcengine Ark Agent Plan endpoint for mainland China.",
    region: "cn",
    productType: "coding_plan",
    apiFormat: "openai-compatible",
    anthropicBaseUrl: "https://ark.cn-beijing.volces.com/api/coding",
    openaiBaseUrl: "https://ark.cn-beijing.volces.com/api/coding/v1",
    envName: "ARK_API_KEY",
    modelsUrl: "https://ark.cn-beijing.volces.com/api/coding/v1/models",
    defaultModels: [
      model("ark-code-latest", "Ark Code Latest", ["chat", "code", "reasoning"], 128000)
    ],
    smallFastModel: "ark-code-latest"
  }),
  providerProduct({
    id: "volcengine-agent-plan-intl",
    name: "火山引擎 Agent Plan 国际版",
    description: "Volcengine BytePlus Agent Plan endpoint for international users.",
    region: "intl-sg",
    productType: "coding_plan",
    apiFormat: "openai-compatible",
    anthropicBaseUrl: "https://ark.ap-southeast.bytepluses.com/api/coding",
    openaiBaseUrl: "https://ark.ap-southeast.bytepluses.com/api/coding/v1",
    envName: "ARK_API_KEY",
    modelsUrl: "https://ark.ap-southeast.bytepluses.com/api/coding/v1/models",
    defaultModels: [
      model("ark-code-latest", "Ark Code Latest", ["chat", "code", "reasoning"], 128000)
    ],
    smallFastModel: "ark-code-latest"
  }),
  providerProduct({
    id: "volcengine-ark-api-cn",
    name: "火山方舟豆包 API 中国大陆",
    description: "Volcengine Ark Doubao Seed pay-as-you-go endpoint for mainland China.",
    region: "cn",
    productType: "payg_api",
    apiFormat: "openai-compatible",
    openaiBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    envName: "ARK_API_KEY",
    modelsUrl: "https://ark.cn-beijing.volces.com/api/v3/models",
    defaultModels: [
      model("doubao-seed-2-1-pro-260628", "Doubao Seed 2.1 Pro", ["chat", "code", "reasoning"], 128000)
    ],
    smallFastModel: "doubao-seed-2-1-pro-260628"
  }),
  providerProduct({
    id: "openrouter-api",
    name: "OpenRouter",
    description: "OpenRouter model routing platform with Anthropic and OpenAI-compatible endpoints.",
    region: "global",
    productType: "payg_api",
    apiFormat: "openai-compatible",
    anthropicBaseUrl: "https://openrouter.ai/api",
    openaiBaseUrl: "https://openrouter.ai/api/v1",
    envName: "OPENROUTER_API_KEY",
    modelsUrl: "https://openrouter.ai/api/v1/models",
    defaultModels: [
      model("anthropic/claude-haiku-4.5", "Claude Haiku 4.5", ["chat", "code"], 200000),
      model("anthropic/claude-sonnet-5", "Claude Sonnet 5", ["chat", "code", "reasoning"], 200000)
    ],
    smallFastModel: "anthropic/claude-haiku-4.5"
  }),
  providerProduct({
    id: "novita-api",
    name: "Novita AI",
    description: "Novita AI model platform with Anthropic and OpenAI-compatible endpoints.",
    region: "global",
    productType: "payg_api",
    apiFormat: "openai-compatible",
    anthropicBaseUrl: "https://api.novita.ai/anthropic",
    openaiBaseUrl: "https://api.novita.ai/v1",
    envName: "NOVITA_API_KEY",
    defaultModels: [
      model("zai-org/glm-5.1", "GLM-5.1", ["chat", "code", "reasoning"], 128000)
    ],
    smallFastModel: "zai-org/glm-5.1"
  })
];

export function getModelPresets(): ModelPreset[] {
  return [];
}

export function getProviderCatalog(): ProviderCatalogPreset[] {
  return providerCatalog;
}

export async function loadProviderCatalog(options: LoadProviderCatalogOptions = {}): Promise<ProviderCatalogPreset[]> {
  const now = Date.now();
  if (!options.fetchImpl && providerCatalogCache && providerCatalogCache.expiresAt > now) {
    return providerCatalogCache.providers;
  }
  const providers = [
    ...providerCatalog,
    ...dedupeExternalProviders(await loadModelsDevProviders(options), providerCatalog)
  ];
  if (!options.fetchImpl) {
    providerCatalogCache = { providers, expiresAt: now + catalogCacheTtlMs };
  }
  return providers;
}

async function loadModelsDevProviders(options: LoadProviderCatalogOptions = {}): Promise<ProviderCatalogPreset[]> {
  try {
    return await fetchModelsDevProviderCatalog(options);
  } catch {
    return [];
  }
}

function dedupeExternalProviders(
  externalProviders: ProviderCatalogPreset[],
  verifiedProviders: ProviderCatalogPreset[]
): ProviderCatalogPreset[] {
  const verifiedIds = new Set(verifiedProviders.map((provider) => normalizeCatalogIdentity(provider.id)));
  const verifiedCompounds = new Set(verifiedProviders.map(providerCompoundIdentity));
  return externalProviders.filter((provider) => {
    if (verifiedIds.has(normalizeCatalogIdentity(provider.id))) return false;
    const compound = providerCompoundIdentity(provider);
    return !compound || !verifiedCompounds.has(compound);
  });
}

function providerCompoundIdentity(provider: ProviderCatalogPreset): string {
  const name = normalizeCatalogIdentity(provider.name);
  const baseUrl = normalizeCatalogIdentity(provider.baseUrl || provider.endpoints.openai?.baseUrl || provider.endpoints.anthropic?.baseUrl);
  return name && baseUrl ? `${name}|${baseUrl}` : "";
}

function normalizeCatalogIdentity(value: string | undefined): string {
  return (value ?? "").trim().replace(/\/+$/u, "").toLowerCase();
}

export function createProviderCatalogFromModelsDev(input: ModelsDevCatalog): ProviderCatalogPreset[] {
  return Object.entries(input)
    .map(([id, provider]) => normalizeModelsDevProvider(id, provider))
    .filter((provider): provider is ProviderCatalogPreset => provider !== undefined)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function isSafeOpenCodeNpmPackage(packageName: string | undefined): boolean {
  if (!packageName) return true;
  const trimmed = packageName.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= 214 &&
    !trimmed.includes("..") &&
    /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u.test(trimmed)
  );
}

export async function fetchModelsDevProviderCatalog(
  options: LoadProviderCatalogOptions = {}
): Promise<ProviderCatalogPreset[]> {
  const now = Date.now();
  if (!options.fetchImpl && modelsDevFailureCacheUntil > now) {
    throw new Error("models.dev catalog refresh is temporarily disabled after a recent failure");
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? catalogFetchTimeoutMs);
  try {
    const response = await fetchImpl(options.sourceUrl ?? modelsDevUrl, {
      method: "GET",
      headers: { "User-Agent": "OpenForge model catalog" },
      redirect: "error",
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`models.dev catalog returned HTTP ${response.status}`);
    const payload = await response.json() as unknown;
    const providers = createProviderCatalogFromModelsDev(parseModelsDevCatalog(payload));
    return providers;
  } catch (error) {
    if (!options.fetchImpl) modelsDevFailureCacheUntil = now + catalogCacheTtlMs;
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function providerProduct(input: {
  id: string;
  name: string;
  description: string;
  region: string;
  productType: ProviderProductType;
  apiFormat: ProviderApiFormat;
  anthropicBaseUrl?: string;
  openaiBaseUrl?: string;
  opencodeNpm?: string;
  envName: string;
  authType?: ProviderAuthType;
  defaultModels: ProviderModelPreset[];
  smallFastModel: string;
  supportsTools?: boolean;
  /** OpenAI-compatible GET /models endpoint. When set, the preset becomes
   *  dynamic: "sync models" fetches the provider's live model list from this
   *  URL instead of only seeding the built-in default models. */
  modelsUrl?: string;
}): ProviderCatalogPreset {
  const authType = input.authType ?? "api_key";
  const baseUrl = input.anthropicBaseUrl ?? input.openaiBaseUrl ?? "";
  const endpoints = {
    ...(input.anthropicBaseUrl ? { anthropic: { baseUrl: input.anthropicBaseUrl } } : {}),
    ...(input.openaiBaseUrl ? { openai: { baseUrl: input.openaiBaseUrl } } : {})
  };
  const supportsTools = input.supportsTools ?? true;
  const defaultModels = input.defaultModels.map((preset) =>
    supportsTools && !preset.capabilities.includes("toolcall")
      ? { ...preset, capabilities: [...preset.capabilities, "toolcall"] }
      : preset
  );
  return {
    id: input.id,
    name: input.name,
    description: input.description,
    baseUrl,
    region: input.region,
    productType: input.productType,
    authType,
    apiFormat: input.apiFormat,
    supportedAdapters: ["claude", "opencode"],
    modelSource: input.modelsUrl ? "dynamic" : "static",
    source: "verified",
    endpoints,
    ...(input.modelsUrl ? { modelFetch: { strategy: "openai-compatible", modelsUrl: input.modelsUrl } } : {}),
    defaultModels,
    env: {
      [claudeEnv.baseUrl]: "Claude Code API endpoint",
      ...(authType === "none" ? {} : { [claudeEnv.authToken]: `${input.name} API key` }),
      [claudeEnv.model]: "Primary Claude Code model",
      [claudeEnv.smallFastModel]: "Small fast Claude Code model",
      [claudeEnv.defaultSonnetModel]: "Claude Code default Sonnet model",
      [claudeEnv.defaultHaikuModel]: "Claude Code default Haiku model",
      [claudeEnv.defaultOpusModel]: "Claude Code default Opus model",
      [claudeEnv.apiTimeoutMs]: "Claude Code provider request timeout in milliseconds"
    },
    claude: {
      env: claudeEnv,
      defaultSmallFastModel: input.smallFastModel
    },
    opencode: {
      npm: input.opencodeNpm ?? opencodePackageFor(input.apiFormat),
      ...(input.openaiBaseUrl ? { api: input.openaiBaseUrl } : input.anthropicBaseUrl ? { api: input.anthropicBaseUrl } : {}),
      env: authType === "none" ? [] : [input.envName]
    }
  };
}

function model(id: string, name: string, capabilities: string[], contextWindow: number): ProviderModelPreset {
  return { id, name, modelId: id, capabilities, contextWindow };
}

export function groupModelsByProvider<TModel extends { provider: string }>(
  models: TModel[]
): Array<ModelGroup<TModel>> {
  const groups = new Map<string, TModel[]>();
  for (const model of models) {
    const provider = model.provider.trim().toLowerCase() || "unknown";
    groups.set(provider, [...(groups.get(provider) ?? []), model]);
  }

  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([provider, groupedModels]) => ({
      provider,
      count: groupedModels.length,
      models: groupedModels
    }));
}

function normalizeModelsDevProvider(id: string, provider: ModelsDevProvider): ProviderCatalogPreset | undefined {
  const providerId = normalizeProviderId(provider.id || id);
  const npm = safeOpenCodeNpmPackage(provider.npm) ?? npmFromModels(provider.models) ?? "@ai-sdk/openai-compatible";
  const apiFormat = apiFormatFor(providerId, npm);
  const defaultModels = Object.values(provider.models)
    .filter((model) => model.status !== "deprecated")
    .map(normalizeModelsDevModel)
    .sort((left, right) => left.name.localeCompare(right.name));
  if (defaultModels.length === 0) return undefined;

  const baseUrl = typeof provider.api === "string" && /^https?:\/\//u.test(provider.api) ? provider.api : "";
  const env = Object.fromEntries(provider.env.map((name) => [name, labelForEnv(name, provider.name)]));
  const opencode = {
    npm,
    ...(provider.api ? { api: provider.api } : {}),
    env: provider.env
  };
  return {
    id: providerId,
    name: provider.name,
    description: `${provider.name} provider from models.dev catalog.`,
    baseUrl,
    region: "global",
    productType: "payg_api",
    authType: provider.env.length > 0 ? "api_key" : authTypeFor(providerId, apiFormat),
    apiFormat,
    supportedAdapters: ["opencode"],
    modelSource: "models.dev",
    source: "models.dev",
    endpoints: {
      ...(apiFormat === "anthropic" ? { anthropic: { baseUrl } } : {}),
      ...(apiFormat === "openai" || apiFormat === "openai-compatible" ? { openai: { baseUrl } } : {})
    },
    ...(apiFormat === "openai-compatible" || apiFormat === "openai" ? { modelFetch: { strategy: "openai-compatible" as const } } : {}),
    defaultModels,
    ...(provider.env.length > 0 ? { env } : {}),
    opencode
  };
}

function normalizeModelsDevModel(model: ModelsDevModel): ProviderModelPreset {
  return {
    id: model.id,
    name: model.name || model.id,
    modelId: model.provider?.api ?? model.id,
    capabilities: capabilitiesFor(model),
    ...(Number.isFinite(model.limit.context) && model.limit.context > 0 ? { contextWindow: model.limit.context } : {})
  };
}

function capabilitiesFor(model: ModelsDevModel): string[] {
  const capabilities = new Set<string>(["chat", "code"]);
  if (model.reasoning) capabilities.add("reasoning");
  if (model.tool_call) capabilities.add("toolcall");
  if (model.attachment) capabilities.add("attachment");
  for (const input of model.modalities?.input ?? []) {
    if (input !== "text") capabilities.add(input);
  }
  if (model.interleaved) capabilities.add("interleaved");
  return [...capabilities];
}

function parseModelsDevCatalog(payload: unknown): ModelsDevCatalog {
  if (!isRecord(payload)) throw new Error("models.dev catalog payload must be an object");
  const parsed: ModelsDevCatalog = {};
  for (const [id, value] of Object.entries(payload)) {
    const provider = parseModelsDevProvider(id, value);
    if (provider) parsed[id] = provider;
  }
  return parsed;
}

function parseModelsDevProvider(id: string, value: unknown): ModelsDevProvider | undefined {
  if (!isRecord(value) || !isRecord(value.models)) return undefined;
  const name = typeof value.name === "string" ? value.name : id;
  const env = Array.isArray(value.env) ? value.env.filter((item): item is string => typeof item === "string") : [];
  const models: Record<string, ModelsDevModel> = {};
  for (const [modelId, modelValue] of Object.entries(value.models)) {
    const model = parseModelsDevModel(modelId, modelValue);
    if (model) models[modelId] = model;
  }
  if (Object.keys(models).length === 0) return undefined;
  return {
    id: typeof value.id === "string" ? value.id : id,
    name,
    env,
    ...(typeof value.api === "string" ? { api: value.api } : {}),
    ...(typeof value.npm === "string" ? { npm: value.npm } : {}),
    models
  };
}

function parseModelsDevModel(id: string, value: unknown): ModelsDevModel | undefined {
  if (!isRecord(value)) return undefined;
  const name = typeof value.name === "string" ? value.name : id;
  const limit = isRecord(value.limit) ? value.limit : {};
  const context = typeof limit.context === "number" ? limit.context : 0;
  const output = typeof limit.output === "number" ? limit.output : 0;
  const modalities = parseModalities(value.modalities);
  const provider = parseModelProvider(value.provider);
  const interleaved = parseInterleaved(value.interleaved);
  return {
    id: typeof value.id === "string" ? value.id : id,
    name,
    release_date: typeof value.release_date === "string" ? value.release_date : "",
    attachment: value.attachment === true,
    reasoning: value.reasoning === true,
    temperature: value.temperature === true,
    tool_call: value.tool_call !== false,
    ...(interleaved !== undefined ? { interleaved } : {}),
    ...(typeof value.status === "string" ? { status: value.status } : {}),
    limit: {
      context,
      ...(typeof limit.input === "number" ? { input: limit.input } : {}),
      output
    },
    ...(modalities ? { modalities } : {}),
    ...(provider ? { provider } : {})
  };
}

function parseInterleaved(value: unknown): ModelsDevModel["interleaved"] | undefined {
  if (value === true) return true;
  if (!isRecord(value)) return undefined;
  return value.field === "reasoning_content" || value.field === "reasoning_details"
    ? { field: value.field }
    : undefined;
}

function parseModalities(value: unknown): ModelsDevModel["modalities"] | undefined {
  if (!isRecord(value)) return undefined;
  const input = Array.isArray(value.input) ? value.input.filter((item): item is string => typeof item === "string") : [];
  const output = Array.isArray(value.output) ? value.output.filter((item): item is string => typeof item === "string") : [];
  return { input, output };
}

function parseModelProvider(value: unknown): ModelsDevModel["provider"] | undefined {
  if (!isRecord(value)) return undefined;
  const result: { npm?: string; api?: string } = {};
  if (typeof value.npm === "string") result.npm = value.npm;
  if (typeof value.api === "string") result.api = value.api;
  return Object.keys(result).length > 0 ? result : undefined;
}

function npmFromModels(models: Record<string, ModelsDevModel>): string | undefined {
  return Object.values(models)
    .map((model) => safeOpenCodeNpmPackage(model.provider?.npm))
    .find((npm): npm is string => typeof npm === "string");
}

function safeOpenCodeNpmPackage(packageName: string | undefined): string | undefined {
  if (!isSafeOpenCodeNpmPackage(packageName)) return undefined;
  return packageName?.trim();
}

function apiFormatFor(providerId: string, npm: string): ProviderApiFormat {
  if (providerId.includes("bedrock") || npm.includes("amazon-bedrock")) return "bedrock";
  if (npm.includes("anthropic")) return "anthropic";
  if (npm.includes("openai-compatible") || npm.includes("openrouter")) return "openai-compatible";
  if (npm.includes("openai")) return "openai";
  if (npm.includes("google")) return "google";
  return "openai-compatible";
}

function authTypeFor(providerId: string, apiFormat: ProviderApiFormat): ProviderAuthType {
  if (apiFormat === "bedrock" || providerId.includes("vertex")) return "none";
  return "api_key";
}

function opencodePackageFor(apiFormat: ProviderApiFormat): string {
  if (apiFormat === "openai") return "@ai-sdk/openai";
  if (apiFormat === "anthropic") return "@ai-sdk/anthropic";
  if (apiFormat === "google") return "@ai-sdk/google";
  if (apiFormat === "bedrock") return "@ai-sdk/amazon-bedrock";
  return "@ai-sdk/openai-compatible";
}

function normalizeProviderId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "provider";
}

function labelForEnv(envName: string, providerName: string): string {
  if (envName.endsWith("_API_KEY")) return `${providerName} API key`;
  return `${providerName} ${envName}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
