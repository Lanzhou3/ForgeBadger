"use client";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getPlatformAction,
  type PlatformIntent,
} from "@/lib/platform-actions-api";
export function PlatformActionPreview({
  intent,
  onUnavailable,
}: {
  intent: PlatformIntent;
  onUnavailable: (value: boolean) => void;
}) {
  const receipt = useQuery({
    queryKey: ["platform-action", intent.id],
    queryFn: () => getPlatformAction(intent.id),
    refetchInterval: 5000,
  });
  useEffect(() => {
    onUnavailable(
      !receipt.data ||
        receipt.isError ||
        receipt.data.intent.status !== "pending" ||
        receipt.data.intent.digest !== intent.digest ||
        Boolean(receipt.data.receipt),
    );
  }, [receipt.data, receipt.isError, intent.digest, onUnavailable]);
  return (
    <div className="space-y-1 text-xs">
      <p>
        授权来源：
        {intent.authority === "delegated_grant"
          ? "项目范围授权"
          : "本次人工确认"}
      </p>
      <p>确认有效期：{new Date(intent.expires_at).toLocaleString()}</p>
      <p className="break-all">操作摘要：{intent.digest}</p>
      <details>
        <summary className="cursor-pointer">查看精确操作与资源</summary>
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-background p-2">
          {intent.command_id}
          {"\n"}
          {intent.input_json}
          {"\n"}
          {intent.resources_json}
        </pre>
      </details>
      {receipt.isPending && <p role="status">正在同步操作回执…</p>}
      {receipt.isError && <p role="alert">操作回执同步失败，等待重试。</p>}
      {receipt.data?.receipt && (
        <p role="status">
          {receipt.data.receipt.outcome === "unknown"
            ? "操作结果未知，请人工核实；不会自动重放。"
            : receipt.data.receipt.outcome === "confirmed"
              ? "操作结果已确认"
              : "确认未产生变更"}
        </p>
      )}
    </div>
  );
}
