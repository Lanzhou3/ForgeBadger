"use client";

import { CopilotChatPanel } from "@/components/copilot/copilot-chat-panel";
import { RobotWidget } from "@/components/copilot/robot-widget";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useLanguage } from "@/hooks/use-language";
import type { CopilotRouteContext } from "@/lib/copilot-route-context";

interface CopilotDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context: CopilotRouteContext;
}

export function CopilotDrawer({ open, onOpenChange, context }: CopilotDrawerProps) {
  const { t } = useLanguage();
  return (
    <>
      <RobotWidget onActivate={() => onOpenChange(true)} suppressBubbles={open} />
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="w-[min(720px,calc(100vw-1rem))] gap-0 p-0 sm:max-w-none" side="right">
          <SheetHeader className="sr-only">
            <SheetTitle>{t("copilot.title")}</SheetTitle>
            <SheetDescription>{t("copilot.chatSubtitle")}</SheetDescription>
          </SheetHeader>
          <CopilotChatPanel
            variant="drawer"
            initialSource={context.source}
            initialSourceRefId={context.sourceRefId}
            className="h-full rounded-none border-0"
          />
        </SheetContent>
      </Sheet>
    </>
  );
}
