import type { Metadata } from "next";
import { SectionPlaceholder } from "@/components/shell/section-placeholder";
import { navItem } from "@/lib/nav";

export const metadata: Metadata = { title: navItem("exceptions").label };

export default function ExceptionsPage() {
  return (
    <SectionPlaceholder
      navKey="exceptions"
      arrives="task 5.4"
      willShow={[
        "Open problems ranked by revenue at risk, with severity shape and label",
        "Recommended response, estimated downtime and owner",
        "One-step dispatch of the recommended vendor",
        "Rules that create exceptions automatically",
      ]}
    />
  );
}
