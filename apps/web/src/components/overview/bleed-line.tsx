"use client";

import { useEffect, useState } from "react";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

/**
 * The signature (design-system.md "The Bleed line"): a 2 px ember bar whose length is revenue at risk relative
 * to the largest item on screen, with a counter of money lost so far and its rate. The counter ticks every
 * second (every minute with reduced motion); the first render uses the server's numbers so hydration matches.
 * Screen readers get one polite sentence, not a ticking number.
 */
export function BleedLine({
  atRiskCents,
  maxAtRiskCents,
  bleed,
  asOf,
}: {
  atRiskCents: number;
  maxAtRiskCents: number;
  bleed: { rate_cents_per_min: number; lost_cents: number } | null;
  asOf: number;
}) {
  const [now, setNow] = useState(asOf);
  useEffect(() => {
    if (!bleed) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, reduced ? 60_000 : 1_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [bleed]);
  const share = maxAtRiskCents > 0 ? Math.max(0.02, Math.min(1, atRiskCents / maxAtRiskCents)) : 0;
  const lost = bleed ? bleed.lost_cents + (bleed.rate_cents_per_min * Math.max(0, now - asOf)) / 60_000 : 0;
  const initial = bleed ? bleed.lost_cents : 0;
  return (
    <div className="flex flex-col gap-1">
      <div aria-hidden="true" className="h-0.5 w-full bg-divider">
        <div className={bleed ? "h-full bg-money-loss" : "h-full bg-fg-subtle"} style={{ width: `${share * 100}%` }} />
      </div>
      {bleed ? (
        <>
          <p aria-hidden="true" className="text-label text-fg-muted tabular-nums">
            <span className="text-fg">−{usd.format(lost / 100)}</span> so far · −
            {usd.format(bleed.rate_cents_per_min / 100)}/min
          </p>
          <p className="sr-only">
            Losing about {usd.format(bleed.rate_cents_per_min / 100)} per minute; {usd.format(initial / 100)} so far.
          </p>
        </>
      ) : null}
    </div>
  );
}
