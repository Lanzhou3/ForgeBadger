interface OutputWriter {
  write(chunk: string): unknown;
}

export interface ForgeBadgerInstallBannerOptions {
  isTTY?: boolean;
  env?: NodeJS.ProcessEnv;
}

export const FORGEBADGER_TEXT_LOGO = [
  "  _____                    ____            _",
  " |  ___|__  _ __ __ _  ___| __ )  __ _  __| | __ _  ___ _ __",
  " | |_ / _ \\| '__/ _` |/ _ \\  _ \\ / _` |/ _` |/ _` |/ _ \\ '__|",
  " |  _| (_) | | | (_| |  __/ |_) | (_| | (_| | (_| |  __/ |",
  " |_|  \\___/|_|  \\__, |\\___|____/ \\__,_|\\__,_|\\__, |\\___|_|",
  "                |___/                         |___/"
].join("\n");

const BRAND_CYAN = "\u001b[38;2;34;211;238m";
const MUTED = "\u001b[38;2;148;163;184m";
const BOLD = "\u001b[1m";
const RESET = "\u001b[0m";

export function renderForgeBadgerInstallBanner(
  options: ForgeBadgerInstallBannerOptions = {}
): string {
  const env = options.env ?? process.env;
  const isTTY = options.isTTY ?? process.stdout.isTTY === true;
  const heading = "ForgeBadger Setup | Environment preflight";
  const tagline = "Local-first control plane for AI coding CLIs";

  if (!supportsColor(isTTY, env)) {
    return `\n${FORGEBADGER_TEXT_LOGO}\n\n ${heading}\n ${tagline}\n\n`;
  }

  return [
    "",
    `${BRAND_CYAN}${BOLD}${FORGEBADGER_TEXT_LOGO}${RESET}`,
    "",
    ` ${BRAND_CYAN}${BOLD}${heading}${RESET}`,
    ` ${MUTED}${tagline}${RESET}`,
    "",
    ""
  ].join("\n");
}

export function writeForgeBadgerInstallBanner(
  writer: OutputWriter,
  options: ForgeBadgerInstallBannerOptions = {}
): void {
  writer.write(renderForgeBadgerInstallBanner(options));
}

export function writeEnvironmentCheckStart(writer: OutputWriter): void {
  writer.write("[1/2] Checking operating system and terminal runtime...\n");
}

function supportsColor(isTTY: boolean, env: NodeJS.ProcessEnv): boolean {
  if (!isTTY || env.NO_COLOR !== undefined || env.FORCE_COLOR === "0") {
    return false;
  }
  return env.TERM?.toLowerCase() !== "dumb";
}
