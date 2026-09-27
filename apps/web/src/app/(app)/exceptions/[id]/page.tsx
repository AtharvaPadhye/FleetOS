import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ExceptionsScreen } from "@/components/exceptions/exceptions-screen";

export const metadata: Metadata = { title: "Exception" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One exception beside the queue; shareable (flows.md `/exceptions/[id]`). */
export default async function ExceptionPage({ params, searchParams }: PageProps<"/exceptions/[id]">) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  return <ExceptionsScreen sp={await searchParams} selectedId={id} />;
}
