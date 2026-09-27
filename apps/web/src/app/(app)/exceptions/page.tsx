import type { Metadata } from "next";
import { ExceptionsScreen } from "@/components/exceptions/exceptions-screen";
import { navItem } from "@/lib/nav";

export const metadata: Metadata = { title: navItem("exceptions").label };

/** The exception queue (task 5.4). */
export default async function ExceptionsPage({ searchParams }: PageProps<"/exceptions">) {
  return <ExceptionsScreen sp={await searchParams} />;
}
