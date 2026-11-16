// Theme spectrum: six named hues defined per color theme in globals.css
// (--hue-*). Components pick a hue for section identity (navigation,
// dashboard tiles) while primary actions stay on the single brand color.
// Class strings are spelled out literally so Tailwind can detect them.

export type HueId = "iris" | "sky" | "mint" | "gold" | "coral" | "rose";

export interface HueClasses {
  /** Icon / glyph color. */
  text: string;
  /** Soft tinted tile behind an icon. */
  tile: string;
  /** Hover border for cards keyed to this hue. */
  hoverBorder: string;
  /** Hover glyph color inside a `group`. */
  hoverText: string;
}

export const HUE_CLASSES: Record<HueId, HueClasses> = {
  iris: {
    text: "text-hue-iris",
    tile: "bg-hue-iris/12 text-hue-iris",
    hoverBorder: "group-hover:border-hue-iris/45",
    hoverText: "group-hover:text-hue-iris",
  },
  sky: {
    text: "text-hue-sky",
    tile: "bg-hue-sky/12 text-hue-sky",
    hoverBorder: "group-hover:border-hue-sky/45",
    hoverText: "group-hover:text-hue-sky",
  },
  mint: {
    text: "text-hue-mint",
    tile: "bg-hue-mint/12 text-hue-mint",
    hoverBorder: "group-hover:border-hue-mint/45",
    hoverText: "group-hover:text-hue-mint",
  },
  gold: {
    text: "text-hue-gold",
    tile: "bg-hue-gold/12 text-hue-gold",
    hoverBorder: "group-hover:border-hue-gold/45",
    hoverText: "group-hover:text-hue-gold",
  },
  coral: {
    text: "text-hue-coral",
    tile: "bg-hue-coral/12 text-hue-coral",
    hoverBorder: "group-hover:border-hue-coral/45",
    hoverText: "group-hover:text-hue-coral",
  },
  rose: {
    text: "text-hue-rose",
    tile: "bg-hue-rose/12 text-hue-rose",
    hoverBorder: "group-hover:border-hue-rose/45",
    hoverText: "group-hover:text-hue-rose",
  },
};
