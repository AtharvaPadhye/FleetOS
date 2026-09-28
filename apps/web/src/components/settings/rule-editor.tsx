"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { Pencil, Plus } from "lucide-react";
import { EXCEPTION_CLASSES, RULE_FIELDS, SEVERITIES, type RuleField } from "@fleetos/domain";
import { Button } from "@fleetos/ui/components/button";
import { Dialog, DialogContent, DialogTrigger } from "@fleetos/ui/components/dialog";
import { saveRule, testRule, toggleRule, type SettingsState } from "@/app/actions/settings";
import { CLASS_LABEL } from "@/lib/exceptions-view";

const input = "h-11 rounded-sm border border-border-control bg-canvas px-3 text-body text-fg lg:h-9";
const OPS: Record<string, { value: string; label: string }[]> = {
  number: [
    { value: "lt", label: "is below" },
    { value: "lte", label: "is at most" },
    { value: "gt", label: "is above" },
    { value: "gte", label: "is at least" },
  ],
  boolean: [
    { value: "eq", label: "is" },
    { value: "neq", label: "is not" },
  ],
  pattern: [{ value: "matches", label: "matches" }],
};

export interface RuleFormValues {
  id: string;
  key: string;
  name: string;
  field: RuleField;
  op: string;
  value: string;
  for_min: number;
  class: string;
  severity: string;
  blocks_service: boolean;
  action_label: string;
  is_system: boolean;
  /** System rules with several tests (e.g. tyre pressure OR alert) aren't editable in the guided builder. */
  simple: boolean;
}

/**
 * The guided rule builder (PRD EX-5): one test on a vehicle fact (field, operator, threshold), optionally
 * held for N minutes, with class, severity and whether it takes the car out of service. "Test against the
 * last 24 h" replays the fleet's data through the engine's own evaluator before saving.
 */
export function RuleEditor({ rule }: { rule?: RuleFormValues }) {
  const [open, setOpen] = useState(false);
  const [field, setField] = useState<RuleField>(rule?.field ?? "soc_pct");
  const kind = RULE_FIELDS[field].type;
  const [saved, save, saving] = useActionState(
    async (prev: SettingsState, form: FormData) => {
      const r = await saveRule(rule?.id ?? null, prev, form);
      if (r.status === "ok") setOpen(false);
      return r;
    },
    { status: "idle" } as SettingsState,
  );
  // Testing reads the form without submitting it: a form action would reset what the user typed.
  const formRef = useRef<HTMLFormElement>(null);
  const [tested, setTested] = useState<SettingsState>({ status: "idle" });
  const [testing, startTest] = useTransition();
  const test = () =>
    startTest(async () => {
      if (formRef.current) setTested(await testRule(tested, new FormData(formRef.current)));
    });
  const label = (id: string, text: string, control: React.ReactNode) => (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-label font-medium">
        {text}
      </label>
      {control}
    </div>
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={rule ? "ghost" : "primary"} aria-label={rule ? `Edit ${rule.name}` : undefined}>
          {rule ? <Pencil aria-hidden="true" /> : <Plus aria-hidden="true" />} {rule ? "Edit" : "Add rule"}
        </Button>
      </DialogTrigger>
      <DialogContent
        title={rule ? `Edit ${rule.name}` : "Add an exception rule"}
        description="Opens an exception when a car matches."
      >
        <form ref={formRef} action={save} className="flex flex-col gap-4" noValidate>
          {label(
            "r-name",
            "Name",
            <input id="r-name" name="name" defaultValue={rule?.name ?? ""} maxLength={80} className={input} />,
          )}
          {!rule
            ? label(
                "r-key",
                "Key (letters, digits, underscores)",
                <input id="r-key" name="key" defaultValue="" placeholder="e.g. hot_cabin" className={input} />,
              )
            : null}
          {rule && !rule.simple ? (
            <p className="rounded-sm border border-divider p-3 text-label text-fg-muted">
              This system rule combines several tests; you can change its severity, class and whether it takes the car
              out of service. Its condition stays as shipped.
            </p>
          ) : (
            <fieldset className="grid gap-3 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)]">
              <legend className="mb-1 text-label font-medium">When</legend>
              <select
                aria-label="Fact"
                name="field"
                value={field}
                onChange={(e) => setField(e.target.value as RuleField)}
                className={input}
              >
                {(Object.keys(RULE_FIELDS) as RuleField[]).map((f) => (
                  <option key={f} value={f}>
                    {RULE_FIELDS[f].label}
                    {RULE_FIELDS[f].unit ? ` (${RULE_FIELDS[f].unit})` : ""}
                  </option>
                ))}
              </select>
              <select
                aria-label="Test"
                name="op"
                key={kind}
                defaultValue={rule?.field === field ? rule.op : OPS[kind]![0]!.value}
                className={input}
              >
                {OPS[kind]!.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {kind === "boolean" ? (
                <select
                  aria-label="Value"
                  name="value"
                  key={`v-${kind}`}
                  defaultValue={rule?.field === field ? rule.value : "true"}
                  className={input}
                >
                  <option value="true">yes</option>
                  <option value="false">no</option>
                </select>
              ) : (
                <input
                  aria-label="Value"
                  name="value"
                  key={`v-${kind}`}
                  defaultValue={rule?.field === field ? rule.value : ""}
                  inputMode={kind === "number" ? "decimal" : "text"}
                  placeholder={kind === "pattern" ? "e.g. washerFluid|wiper" : ""}
                  className={input}
                />
              )}
            </fieldset>
          )}
          {!rule || rule.simple
            ? label(
                "r-for",
                "For at least (minutes, 0 = at once)",
                <input
                  id="r-for"
                  name="for_min"
                  inputMode="numeric"
                  defaultValue={rule?.for_min ?? 0}
                  className={`${input} w-32`}
                />,
              )
            : null}
          <div className="grid gap-3 sm:grid-cols-2">
            {label(
              "r-class",
              "Kind",
              <select id="r-class" name="class" defaultValue={rule?.class ?? "other"} className={input}>
                {EXCEPTION_CLASSES.map((c) => (
                  <option key={c} value={c}>
                    {CLASS_LABEL[c]}
                  </option>
                ))}
              </select>,
            )}
            {label(
              "r-sev",
              "Severity",
              <select id="r-sev" name="severity" defaultValue={rule?.severity ?? "medium"} className={input}>
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {s[0]!.toUpperCase() + s.slice(1)}
                  </option>
                ))}
              </select>,
            )}
          </div>
          {label(
            "r-action",
            "Recommended response",
            <input
              id="r-action"
              name="action_label"
              defaultValue={rule?.action_label ?? ""}
              placeholder="e.g. Check the cabin fan"
              className={input}
            />,
          )}
          <label className="flex min-h-11 items-center gap-2 lg:min-h-9">
            <input
              type="checkbox"
              name="blocks_service"
              defaultChecked={rule?.blocks_service ?? false}
              className="size-4 accent-[var(--fo-chalk)]"
            />
            Take the car out of service while it&apos;s open
          </label>
          {!rule || rule.simple ? (
            <div className="flex flex-col gap-1 rounded-sm border border-divider p-3">
              <Button type="button" onClick={test} variant="secondary" disabled={testing}>
                {testing ? "Testing…" : "Test against the last 24 h"}
              </Button>
              <p aria-live="polite" className="text-label text-fg-muted">
                {tested.status === "idle"
                  ? "Replays the fleet's data through this rule without saving it."
                  : tested.message}
              </p>
            </div>
          ) : null}
          {saved.status === "error" ? (
            <p role="alert" className="rounded-sm border border-severity-high px-3 py-2 text-body">
              {saved.message}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              {saving ? "Saving…" : rule ? "Save rule" : "Add rule"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Enable / disable a rule in place (system rules can be disabled, not deleted). */
export function RuleToggle({ id, enabled, name }: { id: string; enabled: boolean; name: string }) {
  const [pending, start] = useTransition();
  const [on, setOn] = useState(enabled); // flips at once; reverts if saving fails
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 lg:min-h-9">
        <input
          type="checkbox"
          role="switch"
          checked={on}
          disabled={pending}
          aria-label={`${name} enabled`}
          onChange={(e) => {
            const next = e.target.checked;
            setOn(next);
            start(async () => {
              const r = await toggleRule(id, next);
              if (r.status === "error") {
                setOn(!next);
                setError(r.message);
              } else setError(null);
            });
          }}
          className="size-4 accent-[var(--fo-chalk)]"
        />
        <span className="text-label">{on ? "On" : "Off"}</span>
      </label>
      {error ? (
        <span role="alert" className="text-label text-severity-high">
          {error}
        </span>
      ) : null}
    </span>
  );
}
