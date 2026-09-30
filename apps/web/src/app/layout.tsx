import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { Archivo, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

// Type roles from docs/design/design-system.md §2.3. Archivo's width axis gives the semi-expanded display cut.
const display = Archivo({
  variable: "--fo-font-display",
  subsets: ["latin"],
  axes: ["wdth"],
  display: "swap",
});

const sans = IBM_Plex_Sans({
  variable: "--fo-font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

const mono = IBM_Plex_Mono({
  variable: "--fo-font-mono",
  subsets: ["latin"],
  weight: ["400"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "FleetOS", template: "%s · FleetOS" },
  description: "Operations control tower for autonomous fleet owners.",
  applicationName: "FleetOS",
};

export const viewport: Viewport = {
  themeColor: "#0b0f14",
  colorScheme: "dark",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Render every page per request so Next can put this request's CSP nonce on its scripts (proxy.ts, NFR SEC-5).
  // A page prerendered at build time has no nonce, and 'strict-dynamic' would block its scripts.
  await connection();
  return (
    <html lang="en" data-theme="night" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body className="min-h-dvh bg-canvas text-fg">{children}</body>
    </html>
  );
}
