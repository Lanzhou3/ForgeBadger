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
 *            (Kimi / Moonshot AI mark), plus the official black app-icon tile
 *            measured from the kimi.moonshot.cn favicon (corner radius ~10/48
 *            → rx 5; the glyph is scaled to 90% so its visual weight matches
 *            the neighboring marks at chip sizes).
 *            The tile only shows in light mode; in dark mode the bare white K
 *            matches the official favicon-dark variant.
 * - OpenCode: https://unpkg.com/@lobehub/icons-static-svg/icons/opencode.svg
 *            (OpenCode square mark, intentionally monochrome/grayscale)
 * - PI:      https://pi.dev/logo-auto.svg
 *            (official PI π mark from pi.dev, three-color)
 * - mcode:   the official MiniMax Code app icon (favicon_v2.png on
 *            agent.minimax.io/download; the docs-site logo is the same
 *            mark, monochrome). Three layers, all official geometry: a
 *            #7DC6FF rounded tile, a white card, and the black "terminal
 *            card" frame with two legs. The glyph paths are the official
 *            docs-logo vector (mintcdn.com/agent-cn/.../logo/dark.svg),
 *            verbatim — NOT the MiniMax corporate M logo (magenta→coral
 *            gradient), which the product does not use.
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
      {/* Official app-icon tile (kimi.moonshot.cn favicon: full-bleed black
          square, corner radius ~10/48 → rx 5). Light mode only — on the dark
          theme the bare white K already reads correctly against the dark
          surface, matching the official favicon-dark variant. */}
      <rect className="dark:hidden" width="24" height="24" rx="5" fill="#000000" />
      {/* The bare glyph fills ~86% of the viewBox, while on the official light
          tile it occupies ~60% — shrink it about its own center in light mode
          (fill-box origin). 0.9 (rather than the official ~0.7) matches the
          visual weight of the neighboring claude/mcode marks at chip/tab
          sizes; any larger and the dot clips the rounded corner. Dark mode
          keeps the full-bleed glyph, matching the official favicon-dark
          variant. */}
      <g
        className="origin-center scale-[0.9] dark:scale-100"
        style={{ transformBox: "fill-box" }}
      >
        <path
          d="M21.846 0a1.923 1.923 0 110 3.846H20.15a.226.226 0 01-.227-.226V1.923C19.923.861 20.784 0 21.846 0z"
          fill="#1783FF"
        />
        <path
          d="M11.065 11.199l7.257-7.2c.137-.136.06-.41-.116-.41H14.3a.164.164 0 00-.117.051l-7.82 7.756c-.122.12-.302.013-.302-.179V3.82c0-.127-.083-.23-.185-.23H3.186c-.103 0-.186.103-.186.23V19.77c0 .128.083.23.186.23h2.69c.103 0 .186-.102.186-.23v-3.25c0-.069.025-.135.069-.178l2.424-2.406a.158.158 0 01.205-.023l6.484 4.772a7.677 7.677 0 003.453 1.283c.108.012.2-.095.2-.23v-3.06c0-.117-.07-.212-.164-.227a5.028 5.028 0 01-2.027-.807l-5.613-4.064c-.117-.078-.132-.279-.028-.381z"
          fill="#FFFFFF"
        />
      </g>
    </>
  ),
  opencode: <path d="M16 6H8v12h8V6zm4 16H4V2h16v20z" fillRule="evenodd" />,
  // The official π mark only occupies ~59% of its 24×24 viewBox, while the
  // other marks fill ~85–100%, so it reads as much smaller at chip/tab sizes.
  // Scale it about the box center (it is square and centered at 12,12) to
  // match their visual weight; the path data stays verbatim from pi.dev.
  pi: (
    <g transform="translate(12 12) scale(1.45) translate(-12 -12)">
      <path d="M4.959 4.959H15.521V12H12V8.48H4.959z" fill="#F09082" />
      <path d="M4.959 8.48H8.48V12H12V15.521H8.48V19.042H4.959z" fill="#4D9ABF" />
      <path d="M15.521 12H19.042V19.042H15.521z" fill="#F1BE58" />
    </g>
  ),
  // Official MiniMax Code app icon (matches favicon_v2.png on the download
  // page): #7DC6FF rounded tile + white card + black "terminal card" frame
  // with two legs. The two glyph paths are the official docs-logo vector
  // verbatim (first subpath = the card silhouette, full path = frame with
  // the cut-out hole via nonzero winding). In that 112×32 logo box the mark
  // is 24.97×20.30 at offset (3.583, 5.804); the transform re-centers it at
  // ~76% tile width, mirroring the favicon's layout.
  mcode: (
    <>
      <rect width="24" height="24" rx="5" fill="#7DC6FF" />
      <g transform="translate(2.75 4.584) scale(0.73077) translate(-3.58308 -5.80436)">
        <path d="M27.0157 5.80436C27.867 5.80448 28.5567 6.49502 28.5567 7.34635V20.7487C28.5567 21.2424 28.3347 21.7099 27.9522 22.0221L23.4102 25.7311C23.1167 25.9708 22.7491 26.1021 22.3702 26.1022H5.12508C4.27367 26.1022 3.58308 25.4116 3.58308 24.5602V11.5592C3.58308 11.0643 3.80649 10.5951 4.19051 10.2829L9.24519 6.17253C9.53831 5.93433 9.90459 5.80436 10.2823 5.80436H27.0157Z" fill="#FFFFFF" />
        <path d="M27.0157 5.80436C27.867 5.80448 28.5567 6.49502 28.5567 7.34635V20.7487C28.5567 21.2424 28.3347 21.7099 27.9522 22.0221L23.4102 25.7311C23.1167 25.9708 22.7491 26.1021 22.3702 26.1022H5.12508C4.27367 26.1022 3.58308 25.4116 3.58308 24.5602V11.5592C3.58308 11.0643 3.80649 10.5951 4.19051 10.2829L9.24519 6.17253C9.53831 5.93433 9.90459 5.80436 10.2823 5.80436H27.0157ZM11.0587 8.88053C10.8705 8.88052 10.6884 8.94584 10.5421 9.06413L6.99519 11.9313C6.80216 12.0874 6.69051 12.3227 6.69051 12.571V22.4987C6.69073 22.7823 6.92051 23.0124 7.20418 23.0124H9.7491V17.6745C9.74924 17.2206 10.1175 16.8524 10.5714 16.8522H12.5245C12.9784 16.8523 13.3466 17.2206 13.3468 17.6745V23.0124H15.1964V17.6745C15.1965 17.2205 15.5647 16.8522 16.0186 16.8522H17.9718C18.4256 16.8524 18.7939 17.2206 18.794 17.6745V23.0124H21.5587C21.7476 23.0124 21.9306 22.947 22.0772 22.8278L25.17 20.3112C25.3618 20.1551 25.4736 19.9208 25.4737 19.6735V9.40104C25.4736 9.11741 25.2437 8.8875 24.96 8.88737L11.0587 8.88053Z" fill="#000000" />
      </g>
    </>
  ),
  // ForgeBadger's CLI-agnostic terminal session. Original mark: the classic
  // shell prompt glyph (">" + underscore cursor), monochrome — it follows the
  // surrounding text color like the OpenCode mark so it stays legible in both
  // active and inactive tabs.
  terminal: (
    <g fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5.5 6.5L12 12l-6.5 5.5" />
      <path d="M14 17.5h5" />
    </g>
  ),
};

/** Marks that follow the surrounding text color instead of a fixed brand color. */
const CURRENT_COLOR_MARKS: ReadonlySet<string> = new Set(["opencode", "terminal"]);

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
