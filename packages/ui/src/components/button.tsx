import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/cn";

/**
 * Buttons follow "colour is data": the primary action is chalk (light on dark), not a brand colour.
 * One primary button per screen state (docs/design/flows.md §2 F1).
 */
export const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 rounded-sm font-sans font-medium whitespace-nowrap",
    "transition-colors duration-[120ms] ease-out cursor-pointer select-none",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
    "disabled:cursor-not-allowed disabled:opacity-45",
    "[&_svg]:size-4 [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        primary: "bg-chalk text-chalk-fg hover:bg-chalk/90",
        secondary: "border border-border-control bg-transparent text-fg hover:bg-raised",
        ghost: "bg-transparent text-fg-muted hover:bg-raised hover:text-fg",
        danger: "border border-severity-critical bg-transparent text-severity-critical hover:bg-raised",
      },
      size: {
        sm: "h-8 px-3 text-label",
        md: "h-9 px-4 text-body",
        lg: "h-11 px-5 text-body",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export type ButtonProps = ComponentProps<"button"> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
