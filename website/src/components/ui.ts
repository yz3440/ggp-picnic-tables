// Every Building's Button, as class strings: square corners, and outline,
// ghost and secondary always draw the control outline. Secondary is the
// selected or pressed state.

type Variant = "default" | "outline" | "secondary" | "ghost";
type Size = "xs" | "sm" | "icon";

const BASE =
  "relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-1 border text-xs font-medium whitespace-nowrap select-none outline-none transition-colors focus-visible:z-20 focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50";

const VARIANTS: Record<Variant, string> = {
  default: "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
  outline: "border-control bg-background text-foreground hover:border-foreground hover:bg-muted",
  secondary: "z-10 border-foreground bg-selected text-foreground",
  ghost: "border-control text-foreground hover:border-foreground hover:bg-muted",
};

const SIZES: Record<Size, string> = {
  xs: "h-6 px-2",
  sm: "h-7 px-2.5",
  icon: "size-6",
};

export function button(variant: Variant = "outline", size: Size = "xs", extra = "") {
  return `${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${extra}`;
}

/** Micro-label: section and column headers, written like a folder ("tables/"). */
export const MICRO = "text-[11px] font-medium text-muted-foreground";
