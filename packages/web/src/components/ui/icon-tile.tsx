import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const iconTileVariants = cva(
  "inline-flex shrink-0 items-center justify-center ring-1 ring-inset",
  {
    variants: {
      size: {
        xs: "size-7 rounded-md [&_svg]:size-3.5",
        sm: "size-8 rounded-lg [&_svg]:size-4",
        md: "size-9 rounded-lg [&_svg]:size-4",
        lg: "size-10 rounded-xl [&_svg]:size-5",
        xl: "size-12 rounded-2xl [&_svg]:size-6",
      },
      tone: {
        brand: "bg-brand/10 text-brand ring-brand/15",
        muted: "bg-muted/80 text-muted-foreground ring-border/60",
        success: "bg-success/12 text-success ring-success/20",
        warning: "bg-warning/12 text-warning ring-warning/20",
        destructive: "bg-destructive/12 text-destructive ring-destructive/20",
        iris: "bg-hue-iris/12 text-hue-iris ring-hue-iris/20",
        sky: "bg-hue-sky/12 text-hue-sky ring-hue-sky/20",
        mint: "bg-hue-mint/12 text-hue-mint ring-hue-mint/20",
        gold: "bg-hue-gold/12 text-hue-gold ring-hue-gold/20",
        coral: "bg-hue-coral/12 text-hue-coral ring-hue-coral/20",
        rose: "bg-hue-rose/12 text-hue-rose ring-hue-rose/20",
      },
    },
    defaultVariants: {
      size: "md",
      tone: "brand",
    },
  }
);

export interface IconTileProps
  extends React.ComponentProps<"div">,
    VariantProps<typeof iconTileVariants> {}

export function IconTile({ className, size, tone, ...props }: IconTileProps) {
  return (
    <div
      data-slot="icon-tile"
      className={cn(iconTileVariants({ size, tone }), className)}
      {...props}
    />
  );
}

export { iconTileVariants };
