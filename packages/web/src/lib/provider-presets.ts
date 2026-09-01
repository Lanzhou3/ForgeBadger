import type {
  ProviderApiFormat,
  ProviderAuthType,
  ProviderProductType,
  ProviderSupportedAdapter,
} from "@/lib/api";

import type { CustomProviderForm } from "@/components/models/shared";

/**
 * Static provider presets, cc-switch style: each preset is only a connection
 * template (endpoints, auth type, API format, supported CLIs) that prefills
 * the add-provider form. Presets never carry model lists — models are always
 * synced live from the configured provider's own endpoint, and a sync failure
 * surfaces as an error instead of falling back to bundled data.
 */
export interface ProviderPreset {
  id: string;
  name: string;
  description: string;
  productType: ProviderProductType;
  apiFormat: ProviderApiFormat;
  authType: ProviderAuthType;
  supportedAdapters: ProviderSupportedAdapter[];
  anthropicBaseUrl?: string;
  openaiBaseUrl?: string;
}

interface PresetInput {
  id: string;
  name: string;
  description: string;
  productType?: ProviderProductType;
  apiFormat?: ProviderApiFormat;
  authType?: ProviderAuthType;
  supportedAdapters?: ProviderSupportedAdapter[];
  anthropicBaseUrl?: string;
  openaiBaseUrl?: string;
}

function preset(input: PresetInput): ProviderPreset {
  return {
    productType: "payg_api",
    apiFormat: "openai-compatible",
    authType: "api_key",
    supportedAdapters: ["claude", "opencode"],
    ...input,
  };
}

export const providerPresets: ProviderPreset[] = [
  preset({
    id: "openai",
    name: "OpenAI",
    description: "Official OpenAI API endpoint.",
    apiFormat: "openai",
    openaiBaseUrl: "https://api.openai.com/v1",
    supportedAdapters: ["opencode", "codex"],
  }),
  preset({
    id: "anthropic-api",
    name: "Anthropic API",
    description: "Official Anthropic API for Claude models.",
    apiFormat: "anthropic",
    anthropicBaseUrl: "https://api.anthropic.com",
  }),
  preset({
    id: "deepseek-api",
    name: "DeepSeek API",
    description: "DeepSeek API with OpenAI and Anthropic-compatible endpoints.",
    anthropicBaseUrl: "https://api.deepseek.com/anthropic",
    openaiBaseUrl: "https://api.deepseek.com",
  }),
  preset({
    id: "qwen-payg-cn",
    name: "Qwen API 中国大陆",
    description: "Alibaba Cloud Model Studio pay-as-you-go endpoint for mainland China accounts.",
    anthropicBaseUrl: "https://dashscope.aliyuncs.com/apps/anthropic",
    openaiBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  }),
  preset({
    id: "qwen-payg-intl-sg",
    name: "Qwen API 国际版",
    description: "Alibaba Cloud Model Studio international endpoint.",
    anthropicBaseUrl: "https://dashscope-intl.aliyuncs.com/apps/anthropic",
    openaiBaseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  }),
  preset({
    id: "qwen-coding-plan-cn",
    name: "Qwen Coding Plan 中国大陆",
    description: "Alibaba Cloud Model Studio Coding Plan endpoint for mainland China.",
    productType: "coding_plan",
    anthropicBaseUrl: "https://coding.dashscope.aliyuncs.com/apps/anthropic",
    openaiBaseUrl: "https://coding.dashscope.aliyuncs.com/v1",
  }),
  preset({
    id: "qwen-coding-plan-intl",
    name: "Qwen Coding Plan 国际版",
    description: "Alibaba Cloud Model Studio Coding Plan international endpoint.",
    productType: "coding_plan",
    anthropicBaseUrl: "https://coding-intl.dashscope.aliyuncs.com/apps/anthropic",
    openaiBaseUrl: "https://coding-intl.dashscope.aliyuncs.com/v1",
  }),
  preset({
    id: "qwen-token-plan-cn",
    name: "Qwen Token Plan 中国大陆",
    description: "Alibaba Cloud Model Studio Token Plan endpoint for mainland China.",
    productType: "token_plan",
    anthropicBaseUrl: "https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic",
    openaiBaseUrl: "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
  }),
  preset({
    id: "kimi-code",
    name: "Kimi For Coding",
    description: "Kimi coding subscription endpoint.",
    productType: "coding_plan",
    anthropicBaseUrl: "https://api.kimi.com/coding/",
    openaiBaseUrl: "https://api.kimi.com/coding/v1",
  }),
  preset({
    id: "kimi-api",
    name: "Kimi API",
    description: "Moonshot AI Kimi pay-as-you-go endpoint with Anthropic and OpenAI-compatible APIs.",
    anthropicBaseUrl: "https://api.moonshot.cn/anthropic",
    openaiBaseUrl: "https://api.moonshot.cn/v1",
  }),
  preset({
    id: "minimax-global",
    name: "MiniMax 国际版",
    description: "MiniMax international API endpoint for coding tools.",
    anthropicBaseUrl: "https://api.minimax.io/anthropic",
    openaiBaseUrl: "https://api.minimax.io/v1",
  }),
  preset({
    id: "minimax-cn",
    name: "MiniMax 中国大陆",
    description: "MiniMax mainland China API endpoint for coding tools.",
    anthropicBaseUrl: "https://api.minimaxi.com/anthropic",
    openaiBaseUrl: "https://api.minimaxi.com/v1",
  }),
  preset({
    id: "zai-coding-plan",
    name: "Z.AI GLM Coding Plan",
    description: "Z.AI coding plan endpoints for GLM coding models.",
    productType: "coding_plan",
    anthropicBaseUrl: "https://api.z.ai/api/anthropic",
    openaiBaseUrl: "https://api.z.ai/api/coding/paas/v4",
  }),
  preset({
    id: "zai-glm-api",
    name: "Z.AI GLM API",
    description: "Z.AI GLM pay-as-you-go endpoint with Anthropic and OpenAI-compatible APIs.",
    anthropicBaseUrl: "https://api.z.ai/api/anthropic",
    openaiBaseUrl: "https://api.z.ai/api/paas/v4",
  }),
  preset({
    id: "xiaomi-mimo-api",
    name: "Xiaomi MiMo API",
    description: "Xiaomi MiMo pay-as-you-go API with OpenAI and Anthropic-compatible endpoints.",
    anthropicBaseUrl: "https://api.xiaomimimo.com/anthropic",
    openaiBaseUrl: "https://api.xiaomimimo.com/v1",
  }),
  preset({
    id: "xiaomi-mimo-token-plan-cn",
    name: "Xiaomi MiMo Token Plan 中国大陆",
    description: "Xiaomi MiMo Token Plan endpoint for mainland China.",
    productType: "token_plan",
    anthropicBaseUrl: "https://token-plan-cn.xiaomimimo.com/anthropic",
    openaiBaseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
  }),
  preset({
    id: "xiaomi-mimo-token-plan-sgp",
    name: "Xiaomi MiMo Token Plan Singapore",
    description: "Xiaomi MiMo Token Plan endpoint for Singapore.",
    productType: "token_plan",
    anthropicBaseUrl: "https://token-plan-sgp.xiaomimimo.com/anthropic",
    openaiBaseUrl: "https://token-plan-sgp.xiaomimimo.com/v1",
  }),
  preset({
    id: "xiaomi-mimo-token-plan-ams",
    name: "Xiaomi MiMo Token Plan Europe",
    description: "Xiaomi MiMo Token Plan endpoint for Amsterdam/Europe.",
    productType: "token_plan",
    anthropicBaseUrl: "https://token-plan-ams.xiaomimimo.com/anthropic",
    openaiBaseUrl: "https://token-plan-ams.xiaomimimo.com/v1",
  }),
  preset({
    id: "baidu-qianfan-coding-plan",
    name: "Baidu Qianfan Coding Plan",
    description: "Baidu Qianfan Coding Plan endpoint for AI coding tools.",
    productType: "coding_plan",
    anthropicBaseUrl: "https://qianfan.baidubce.com/anthropic/coding",
    openaiBaseUrl: "https://qianfan.baidubce.com/v2",
  }),
  preset({
    id: "stepfun-coding-plan-cn",
    name: "StepFun Coding Plan 中国大陆",
    description: "StepFun coding plan endpoint for mainland China.",
    productType: "coding_plan",
    anthropicBaseUrl: "https://api.stepfun.com/step_plan",
    openaiBaseUrl: "https://api.stepfun.com/v1",
  }),
  preset({
    id: "stepfun-coding-plan-intl",
    name: "StepFun Coding Plan 国际版",
    description: "StepFun coding plan international endpoint.",
    productType: "coding_plan",
    anthropicBaseUrl: "https://api.stepfun.ai/step_plan",
    openaiBaseUrl: "https://api.stepfun.ai/v1",
  }),
  preset({
    id: "modelscope-api",
    name: "ModelScope API",
    description: "ModelScope inference endpoint with Anthropic and OpenAI-compatible APIs.",
    anthropicBaseUrl: "https://api-inference.modelscope.cn",
    openaiBaseUrl: "https://api-inference.modelscope.cn/v1",
  }),
  preset({
    id: "siliconflow-api",
    name: "SiliconFlow 硅基流动",
    description: "SiliconFlow model API platform with Anthropic and OpenAI-compatible endpoints.",
    anthropicBaseUrl: "https://api.siliconflow.cn",
    openaiBaseUrl: "https://api.siliconflow.cn/v1",
  }),
  preset({
    id: "siliconflow-intl",
    name: "SiliconFlow 国际版",
    description: "SiliconFlow international endpoint.",
    anthropicBaseUrl: "https://api.siliconflow.com",
    openaiBaseUrl: "https://api.siliconflow.com/v1",
  }),
  preset({
    id: "volcengine-agent-plan-cn",
    name: "火山引擎 Agent Plan 中国大陆",
    description: "Volcengine Ark Agent Plan endpoint for mainland China.",
    productType: "coding_plan",
    anthropicBaseUrl: "https://ark.cn-beijing.volces.com/api/coding",
    openaiBaseUrl: "https://ark.cn-beijing.volces.com/api/coding/v1",
  }),
  preset({
    id: "volcengine-agent-plan-intl",
    name: "火山引擎 Agent Plan 国际版",
    description: "Volcengine BytePlus Agent Plan endpoint for international users.",
    productType: "coding_plan",
    anthropicBaseUrl: "https://ark.ap-southeast.bytepluses.com/api/coding",
    openaiBaseUrl: "https://ark.ap-southeast.bytepluses.com/api/coding/v1",
  }),
  preset({
    id: "volcengine-ark-api-cn",
    name: "火山方舟豆包 API 中国大陆",
    description: "Volcengine Ark Doubao Seed pay-as-you-go endpoint for mainland China.",
    openaiBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
  }),
  preset({
    id: "openrouter-api",
    name: "OpenRouter",
    description: "OpenRouter model routing platform with Anthropic and OpenAI-compatible endpoints.",
    anthropicBaseUrl: "https://openrouter.ai/api",
    openaiBaseUrl: "https://openrouter.ai/api/v1",
  }),
  preset({
    id: "novita-api",
    name: "Novita AI",
    description: "Novita AI model platform with Anthropic and OpenAI-compatible endpoints.",
    anthropicBaseUrl: "https://api.novita.ai/anthropic",
    openaiBaseUrl: "https://api.novita.ai/v1",
  }),
];

export function filterProviderPresets(presets: ProviderPreset[], query: string): ProviderPreset[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return presets;
  return presets.filter((preset) =>
    [preset.id, preset.name, preset.description, preset.anthropicBaseUrl ?? "", preset.openaiBaseUrl ?? ""]
      .join("\n")
      .toLowerCase()
      .includes(normalized)
  );
}

export function providerPresetToForm(preset: ProviderPreset): CustomProviderForm {
  return {
    name: preset.name,
    providerKey: preset.id,
    apiFormat: preset.apiFormat,
    authType: preset.authType,
    anthropicBaseUrl: preset.anthropicBaseUrl ?? "",
    openaiBaseUrl: preset.openaiBaseUrl ?? "",
    supportedAdapters: [...preset.supportedAdapters],
  };
}
