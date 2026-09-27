"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  PAYOUT_FIELDS,
  detectMapping,
  parseCsv,
  payoutLedgerLines,
  validatePayoutRows,
  type ColumnMapping,
  type VehicleRef,
} from "@fleetos/domain";
import { getAppContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export type ImportState = { status: "idle" } | { status: "error"; message: string };

const MAX_BYTES = 5 * 1024 * 1024;
const MONEY_ROLES = new Set(["owner", "admin", "finance"]);
const MAX_STORED_ERRORS = 200;

async function moneyContext() {
  const { user, activeOrg } = await getAppContext();
  if (!user || !activeOrg) throw new Error("Sign in first.");
  if (!MONEY_ROLES.has(activeOrg.role)) throw new Error("Only owners, admins and finance can import revenue.");
  return { user, org: activeOrg, supabase: await createClient() };
}

async function orgVehicles(supabase: Awaited<ReturnType<typeof createClient>>, orgId: string): Promise<VehicleRef[]> {
  const { data, error } = await supabase.from("vehicles").select("id, vin, number, display_name").eq("org_id", orgId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((v) => ({ id: v.id, vin: v.vin, number: v.number, displayName: v.display_name }));
}

/** Upload → parse → detect → validate. Nothing is booked until the user commits. */
export async function uploadPayoutCsv(_prev: ImportState, form: FormData): Promise<ImportState> {
  let importId: string;
  try {
    const { user, org, supabase } = await moneyContext();
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return { status: "error", message: "Choose a CSV file to upload." };
    if (file.size > MAX_BYTES)
      return { status: "error", message: "That file is over 5 MB. Split it by month and upload each part." };
    if (!/\.csv$/i.test(file.name))
      return { status: "error", message: "Upload a .csv file (export it from your spreadsheet as CSV)." };

    const text = await file.text();
    const parsed = parseCsv(text);
    if (parsed.headers.length === 0) return { status: "error", message: "The file is empty." };
    const { layout, mapping } = detectMapping(parsed.headers);
    const result = validatePayoutRows(parsed, mapping, await orgVehicles(supabase, org.id));

    const { data, error } = await supabase
      .from("revenue_imports")
      .insert({
        org_id: org.id,
        filename: file.name.slice(0, 200),
        layout,
        mapping,
        status: result.valid.length > 0 ? "ready" : "failed",
        rows_total: result.rowsTotal,
        rows_valid: result.valid.length,
        errors: result.errors.slice(0, MAX_STORED_ERRORS),
        raw_text: text,
        created_by: user.id,
      })
      .select("id")
      .single();
    if (error) return { status: "error", message: error.message };
    importId = data.id;
  } catch (e) {
    return { status: "error", message: (e as Error).message };
  }
  revalidatePath("/financials/imports");
  redirect(`/financials/imports/${importId}`);
}

/** Save a manual column mapping and re-validate. */
export async function remapPayoutImport(importId: string, form: FormData) {
  const { org, supabase } = await moneyContext();
  const { data: imp, error } = await supabase
    .from("revenue_imports")
    .select("raw_text, status")
    .eq("id", importId)
    .eq("org_id", org.id)
    .single();
  if (error || !imp) throw new Error("Import not found.");
  if (imp.status === "imported") throw new Error("This import is already committed.");
  const mapping: ColumnMapping = {};
  for (const f of PAYOUT_FIELDS) {
    const v = form.get(f);
    if (typeof v === "string" && v) mapping[f] = v;
  }
  const result = validatePayoutRows(parseCsv(imp.raw_text), mapping, await orgVehicles(supabase, org.id));
  await supabase
    .from("revenue_imports")
    .update({
      layout: "custom",
      mapping,
      status: result.valid.length > 0 ? "ready" : "failed",
      rows_valid: result.valid.length,
      errors: result.errors.slice(0, MAX_STORED_ERRORS),
    })
    .eq("id", importId);
  revalidatePath(`/financials/imports/${importId}`);
}

/** Book the valid rows. Idempotent: lines already in the ledger are skipped and counted. */
export async function commitPayoutImport(importId: string) {
  const { user, org, supabase } = await moneyContext();
  const { data: imp, error } = await supabase
    .from("revenue_imports")
    .select("raw_text, mapping, status")
    .eq("id", importId)
    .eq("org_id", org.id)
    .single();
  if (error || !imp) throw new Error("Import not found.");
  if (imp.status === "imported") return;
  const result = validatePayoutRows(
    parseCsv(imp.raw_text),
    imp.mapping as ColumnMapping,
    await orgVehicles(supabase, org.id),
  );
  const lines = payoutLedgerLines(result.valid);
  let booked = 0;
  for (let i = 0; i < lines.length; i += 500) {
    const batch = lines.slice(i, i + 500).map((l) => ({
      org_id: org.id,
      vehicle_id: l.vehicleId,
      occurred_on: l.occurredOn,
      category: l.category,
      amount_cents: l.amountCents,
      source: "csv",
      source_ref: l.sourceRef,
      import_id: importId,
      created_by: user.id,
    }));
    const { data, error: insErr } = await supabase
      .from("ledger_entries")
      .upsert(batch, { onConflict: "org_id,source,source_ref", ignoreDuplicates: true })
      .select("id");
    if (insErr) throw new Error(insErr.message);
    booked += data?.length ?? 0;
  }
  await supabase
    .from("revenue_imports")
    .update({
      status: "imported",
      rows_imported: booked,
      rows_already_imported: lines.length - booked,
      committed_at: new Date().toISOString(),
    })
    .eq("id", importId);
  revalidatePath("/financials/imports");
  revalidatePath(`/financials/imports/${importId}`);
}
