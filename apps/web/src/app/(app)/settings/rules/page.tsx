import type { Metadata } from "next";
import { RULE_FIELDS, type RuleCondition, type RuleField } from "@fleetos/domain";
import { SeverityBadge } from "@fleetos/ui/components/severity-badge";
import { ActionForm } from "@/components/settings/action-form";
import { ReadonlyNote } from "@/components/settings/readonly-note";
import { RuleEditor, RuleToggle, type RuleFormValues } from "@/components/settings/rule-editor";
import { savePolicyForm } from "@/app/actions/settings";
import { CLASS_LABEL } from "@/lib/exceptions-view";
import { getAppContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { listRules } from "@/lib/services/exceptions";
import { listPolicies } from "@/lib/services/settings";

export const metadata: Metadata = { title: "Settings · Rules & policies" };

const input = "h-11 rounded-sm border border-border-control bg-canvas px-3 text-body text-fg lg:h-9";
const OP_TEXT: Record<string, string> = {
  lt: "<",
  lte: "≤",
  gt: ">",
  gte: "≥",
  eq: "is",
  neq: "is not",
  matches: "matches",
};

/** A condition in words, e.g. "Battery < 15% and Charging is no, for 2 min". */
function describe(c: RuleCondition) {
  const leaf = (l: NonNullable<RuleCondition["all"]>[number]) => {
    const meta = RULE_FIELDS[l.field];
    const v =
      typeof l.value === "boolean" ? (l.value ? "yes" : "no") : meta.unit ? `${l.value} ${meta.unit}` : `"${l.value}"`;
    return `${meta.label} ${OP_TEXT[l.op] ?? l.op} ${v}`;
  };
  const parts = [
    ...(c.all?.length ? [c.all.map(leaf).join(" and ")] : []),
    ...(c.any?.length ? [c.any.length > 1 ? `(${c.any.map(leaf).join(" or ")})` : leaf(c.any[0]!)] : []),
  ];
  return `${parts.join(" and ")}${c.for_min ? `, for ${c.for_min} min` : ""}`;
}

/** ST-2 fleet policies and EX-5 exception rules. */
export default async function RulesPage() {
  const { activeOrg } = await getAppContext();
  if (!activeOrg) return null;
  const db = await createClient();
  const canEdit = ["owner", "admin"].includes(activeOrg.role);
  const [policies, rules] = await Promise.all([listPolicies(db, activeOrg), listRules(db, activeOrg.id)]);
  const p = Object.fromEntries(policies.map((x) => [x.key, x]));
  const pctVal = (key: string) => Math.round(Number((p[key]!.config as { soc: number }).soc) * 100);
  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="policies" className="flex max-w-3xl flex-col gap-4">
        <h2 id="policies" className="text-title font-semibold">
          Fleet policies
        </h2>
        {canEdit ? null : <ReadonlyNote />}
        <ActionForm action={savePolicyForm} submit="Save policies" disabled={!canEdit}>
          <fieldset
            disabled={!canEdit}
            className="flex flex-col divide-y divide-divider rounded-md border border-divider bg-surface"
          >
            <div className="grid gap-2 p-4 sm:grid-cols-[minmax(0,1fr)_10rem] sm:items-center">
              <div>
                <label htmlFor="min_soc" className="font-medium">
                  {p["MIN-SOC"]!.name} <span className="font-mono text-mono text-fg-muted">MIN-SOC</span>
                </label>
                <p className="text-label text-fg-muted">{p["MIN-SOC"]!.description}</p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="min_soc"
                  name="min_soc"
                  inputMode="numeric"
                  defaultValue={pctVal("MIN-SOC")}
                  className={`${input} w-20`}
                />{" "}
                %
              </div>
            </div>
            <div className="grid gap-2 p-4 sm:grid-cols-[minmax(0,1fr)_10rem] sm:items-center">
              <div>
                <label htmlFor="charge_target" className="font-medium">
                  {p["CHG-TARGET"]!.name} <span className="font-mono text-mono text-fg-muted">CHG-TARGET</span>
                </label>
                <p className="text-label text-fg-muted">{p["CHG-TARGET"]!.description}</p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="charge_target"
                  name="charge_target"
                  inputMode="numeric"
                  defaultValue={pctVal("CHG-TARGET")}
                  className={`${input} w-20`}
                />{" "}
                %
              </div>
            </div>
            <div className="flex flex-col gap-1 p-4">
              <label className="flex items-center gap-2 font-medium">
                <input
                  type="checkbox"
                  name="cln02"
                  defaultChecked={p["CLN-02"]!.enabled}
                  className="size-4 accent-[var(--fo-chalk)]"
                />
                {p["CLN-02"]!.name} <span className="font-mono text-mono text-fg-muted">CLN-02</span>
              </label>
              <p className="pl-6 text-label text-fg-muted">{p["CLN-02"]!.description}</p>
            </div>
            <div className="flex flex-col gap-2 p-4">
              <label className="flex items-center gap-2 font-medium">
                <input
                  type="checkbox"
                  name="auto_dispatch"
                  defaultChecked={p["AUTO-DISPATCH"]!.enabled}
                  className="size-4 accent-[var(--fo-chalk)]"
                />
                {p["AUTO-DISPATCH"]!.name} <span className="font-mono text-mono text-fg-muted">AUTO-DISPATCH</span>
              </label>
              <p className="pl-6 text-label text-fg-muted">{p["AUTO-DISPATCH"]!.description}</p>
              <div className="flex items-center gap-2 pl-6">
                <label htmlFor="after_min" className="text-label text-fg-muted">
                  After
                </label>
                <input
                  id="after_min"
                  name="after_min"
                  inputMode="numeric"
                  defaultValue={(p["AUTO-DISPATCH"]!.config as { after_min: number }).after_min}
                  className={`${input} w-20`}
                />
                <span className="text-label text-fg-muted">minutes</span>
              </div>
            </div>
          </fieldset>
        </ActionForm>
      </section>

      <section aria-labelledby="rules" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="rules" className="text-title font-semibold">
              Exception rules
            </h2>
            <p className="text-label text-fg-muted">
              Checked against every car continuously. System rules can be turned off, not deleted.
            </p>
          </div>
          {canEdit ? <RuleEditor /> : null}
        </div>
        <ul className="divide-y divide-divider rounded-md border border-divider bg-surface">
          {rules.map((r) => {
            const c = r.condition as RuleCondition;
            const leaves = [...(c.all ?? []), ...(c.any ?? [])];
            const leaf = leaves[0];
            const values: RuleFormValues = {
              id: r.id,
              key: r.key,
              name: r.name,
              field: (leaf?.field ?? "soc_pct") as RuleField,
              op: leaf?.op ?? "lt",
              value: leaf ? String(leaf.value) : "",
              for_min: c.for_min ?? 0,
              class: r.class,
              severity: r.severity,
              blocks_service: r.blocks_service,
              action_label: String((r.recommended_action as { label?: string }).label ?? ""),
              is_system: r.is_system,
              simple: leaves.length === 1,
            };
            return (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <SeverityBadge severity={r.severity} />
                    <span className="font-medium">{r.name}</span>
                    <span className="text-label text-fg-muted">
                      {CLASS_LABEL[r.class]}
                      {r.blocks_service ? " · takes the car out of service" : ""}
                      {r.is_system ? " · system" : ""}
                    </span>
                  </div>
                  <p className="text-label text-fg-muted">When {describe(c)}</p>
                </div>
                {canEdit ? (
                  <div className="flex items-center gap-2">
                    <RuleToggle id={r.id} enabled={r.enabled} name={r.name} />
                    <RuleEditor rule={values} />
                  </div>
                ) : (
                  <span className="text-label text-fg-muted">{r.enabled ? "On" : "Off"}</span>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
