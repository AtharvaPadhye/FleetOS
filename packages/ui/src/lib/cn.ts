import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge must know our custom type scale (tokens.css `--text-*`); otherwise it treats
 * `text-body` as a colour and silently drops real colour classes such as `text-chalk-fg`.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["label", "mono", "body", "title", "display-l", "display-xl"] }],
    },
  },
});

/** Merge class names, letting later Tailwind utilities override earlier ones. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
