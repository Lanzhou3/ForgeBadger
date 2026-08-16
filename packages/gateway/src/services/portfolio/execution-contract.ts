/** The only skill and semantic tool permitted in a dispatchable Portfolio packet. */
export const PORTFOLIO_EXECUTION_SKILL_VERSION = "portfolio-execution/v1";
export const PORTFOLIO_EXECUTION_TOOL_IDS = ["portfolio.submit_canonical_task_packet"] as const;
export const PORTFOLIO_EXECUTION_TOOL_VERSION = "v1";

export function isPortfolioExecutionToolId(value: string): value is (typeof PORTFOLIO_EXECUTION_TOOL_IDS)[number] {
  return PORTFOLIO_EXECUTION_TOOL_IDS.includes(value as (typeof PORTFOLIO_EXECUTION_TOOL_IDS)[number]);
}
