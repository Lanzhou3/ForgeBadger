import type { ReactNode } from "react";

import { getCliBrand, type CliBrandId } from "@/lib/cli-brand";
import { cn } from "@/lib/utils";

interface Props {
  aiTool?: string | null;
  className?: string;
}

/**
 * SVG path data for CLI brand marks, except Codex, which uses OpenAI's original
 * app icon. Monochrome SVG marks inherit `currentColor`.
 *
 * Sources — most vendor marks come from the LobeHub icon registry
 * (`@lobehub/icons-static-svg`, which tracks vendor branding). Copies are
 * kept at `public/brand/cli/`:
 * - Claude:  https://unpkg.com/@lobehub/icons-static-svg/icons/claude-color.svg
 *            (Anthropic Claude starburst, terracotta #D97757)
 * - Codex:   /brand/cli/codex.png (original icon-codex-dark-color.png bundled
 *            with OpenAI's desktop app)
 * - Kimi:    https://unpkg.com/@lobehub/icons-static-svg/icons/kimi-color.svg
 *            (Kimi / Moonshot AI mark)
 * - OpenCode: https://unpkg.com/@lobehub/icons-static-svg/icons/opencode.svg
 *            (OpenCode square mark, intentionally monochrome/grayscale)
 * - PI:      https://pi.dev/logo-auto.svg
 *            (official PI π mark from pi.dev, three-color)
 *
 * All trademarks belong to their respective owners and are used here solely
 * to identify the corresponding CLI.
 */
const CLI_ICON_MARKS: Record<Exclude<CliBrandId, "codex">, ReactNode> = {
  claude: (
    <path
      d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z"
      fill="#D97757"
      fillRule="nonzero"
    />
  ),
  kimi: (
    <>
      <path
        d="M21.846 0a1.923 1.923 0 110 3.846H20.15a.226.226 0 01-.227-.226V1.923C19.923.861 20.784 0 21.846 0z"
        fill="#1783FF"
      />
      <path
        d="M11.065 11.199l7.257-7.2c.137-.136.06-.41-.116-.41H14.3a.164.164 0 00-.117.051l-7.82 7.756c-.122.12-.302.013-.302-.179V3.82c0-.127-.083-.23-.185-.23H3.186c-.103 0-.186.103-.186.23V19.77c0 .128.083.23.186.23h2.69c.103 0 .186-.102.186-.23v-3.25c0-.069.025-.135.069-.178l2.424-2.406a.158.158 0 01.205-.023l6.484 4.772a7.677 7.677 0 003.453 1.283c.108.012.2-.095.2-.23v-3.06c0-.117-.07-.212-.164-.227a5.028 5.028 0 01-2.027-.807l-5.613-4.064c-.117-.078-.132-.279-.028-.381z"
        fill="#FFFFFF"
      />
    </>
  ),
  opencode: <path d="M16 6H8v12h8V6zm4 16H4V2h16v20z" fillRule="evenodd" />,
  pi: (
    <>
      <path d="M4.959 4.959H15.521V12H12V8.48H4.959z" fill="#F09082" />
      <path d="M4.959 8.48H8.48V12H12V15.521H8.48V19.042H4.959z" fill="#4D9ABF" />
      <path d="M15.521 12H19.042V19.042H15.521z" fill="#F1BE58" />
    </>
  ),
};

/** Marks that follow the surrounding text color instead of a fixed brand color. */
const CURRENT_COLOR_MARKS: ReadonlySet<string> = new Set(["opencode"]);

export function CliBrandIcon({ aiTool, className }: Props) {
  const brand = getCliBrand(aiTool);
  if (brand.id === "codex") {
    return (
      <span
        aria-hidden="true"
        className={cn("relative inline-block size-3.5 shrink-0 overflow-hidden rounded-full", className)}
      >
        <img
          alt=""
          className="absolute left-1/2 top-1/2 size-[150%] max-w-none -translate-x-1/2 -translate-y-1/2"
          src="/brand/cli/codex.png"
        />
      </span>
    );
  }
  if (brand.id === "unknown") {
    return null;
  }
  const mark = CLI_ICON_MARKS[brand.id];
  return (
    // `text-current` opts out of shadcn select/chip styles that force svg
    // color to muted-foreground; monochrome marks then inherit the parent
    // text color while fixed-color marks keep their brand fill.
    <svg
      aria-hidden="true"
      className={cn(
        "size-3.5 shrink-0",
        CURRENT_COLOR_MARKS.has(brand.id) ? "text-current" : undefined,
        className
      )}
      fill="currentColor"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      {mark}
    </svg>
  );
}
