"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  Table,
  Td,
  Th,
} from "@/components/ui";
import { cn } from "@/lib/cn";

interface ActivityRow {
  id: string;
  code: string;
  name: string;
  category: string;
  boqQty: string;
  unit: string;
  norm: string;
  sequence: number;
  contractorName: string;
  dependsOn: string[];
}
interface UserRow {
  id: string;
  name: string;
  email: string;
  isOwner: boolean;
}
interface MaterialRow {
  id: string;
  name: string;
  unit: string;
  category: string;
  densityKgPerCum: string;
  unitsPerCum: string;
}
interface MixRow {
  id: string;
  code: string;
  name: string;
  coefficients: { materialId: string; qtyPerUnit: string }[];
}
interface PolicyRow {
  recordType: string;
  allowedWindow: string;
  allowedActor: string;
  enabled: boolean;
}

const CATEGORIES = [
  "earthwork", "concreting", "masonry", "plaster", "waterproofing",
  "flooring", "finishes", "external", "general",
];
const UNITS = ["CUM", "SQM", "MTR", "BAG", "NOS", "KG", "TON"];
const WINDOWS = ["until_day_close", "same_day", "until_actioned", "never"];
const POLICY_LABELS: Record<string, string> = {
  progress_entry: "Progress entries",
  measurement_book: "Measurement book",
  material_receipt: "Material receipts",
  consumption_entry: "Consumption entries",
  requisition: "Requisitions",
  labour_entry: "Labour entries",
};
const WINDOW_LABELS: Record<string, string> = {
  until_day_close: "Until day close (23:59 IST)",
  same_day: "Same calendar day",
  until_actioned: "Until an approver acts",
  never: "Never (owner only)",
};

const SECTIONS = ["Activities (WBS/BOQ)", "Team", "Materials & mixes", "Edit rights"] as const;

export function ConfigScreen(props: {
  siteId: string;
  activities: ActivityRow[];
  users: UserRow[];
  roles: { userId: string; role: string }[];
  materials: MaterialRow[];
  mixes: MixRow[];
  workTypes: { id: string; name: string; defaultUnit: string }[];
  policies: PolicyRow[];
}) {
  const [section, setSection] = useState<(typeof SECTIONS)[number]>(SECTIONS[0]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 rounded-lg bg-slate-200/70 p-1">
        {SECTIONS.map((s) => (
          <button
            key={s}
            onClick={() => setSection(s)}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium",
              section === s ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
            )}
          >
            {s}
          </button>
        ))}
      </div>

      {section === "Activities (WBS/BOQ)" ? <ActivitiesSection {...props} /> : null}
      {section === "Team" ? <TeamSection {...props} /> : null}
      {section === "Materials & mixes" ? <MaterialsSection {...props} /> : null}
      {section === "Edit rights" ? <PoliciesSection {...props} /> : null}
    </div>
  );
}

function ActivitiesSection({
  siteId,
  activities,
}: {
  siteId: string;
  activities: ActivityRow[];
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    code: "",
    name: "",
    category: "general",
    boqQty: "",
    unit: "CUM",
    norm: "",
    contractorName: "",
    dependsOn: "" as string,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sites/${siteId}/activities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: form.code,
          name: form.name,
          category: form.category,
          boqQty: form.boqQty ? Number(form.boqQty) : undefined,
          unit: form.unit || undefined,
          productivityNormQtyPerDay: form.norm ? Number(form.norm) : undefined,
          sequence: activities.length + 1,
          contractorName: form.contractorName || undefined,
          dependsOn: form.dependsOn ? [{ predecessorId: form.dependsOn, lagDays: 0 }] : [],
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not create");
        return;
      }
      setForm({ ...form, code: "", name: "", boqQty: "", norm: "", contractorName: "" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const activityById = new Map(activities.map((a) => [a.id, a]));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Activity list — BOQ quantities drive the schedule & audits</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <thead>
              <tr>
                <Th>Code</Th>
                <Th>Activity</Th>
                <Th>Category</Th>
                <Th className="text-right">BOQ</Th>
                <Th className="text-right">Norm/day</Th>
                <Th>Contractor</Th>
                <Th>After</Th>
              </tr>
            </thead>
            <tbody>
              {activities.map((a) => (
                <tr key={a.id}>
                  <Td className="font-medium">{a.code}</Td>
                  <Td>{a.name}</Td>
                  <Td>
                    <Badge tone="neutral">{a.category}</Badge>
                  </Td>
                  <Td className="text-right">
                    {a.boqQty ? `${Number(a.boqQty).toLocaleString("en-IN")} ${a.unit}` : "—"}
                  </Td>
                  <Td className="text-right">{a.norm || "—"}</Td>
                  <Td>{a.contractorName || <span className="text-slate-400">deptl</span>}</Td>
                  <Td className="text-xs text-slate-400">
                    {a.dependsOn.map((id) => activityById.get(id)?.code).filter(Boolean).join(", ") || "—"}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Add activity</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <Label>Code</Label>
              <Input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                required
              />
            </div>
            <div className="col-span-2 sm:col-span-3">
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </div>
            <div>
              <Label>Category (sets monsoon impact)</Label>
              <Select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              >
                {CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label>BOQ qty</Label>
              <Input
                type="number"
                step="0.001"
                min="0"
                value={form.boqQty}
                onChange={(e) => setForm({ ...form, boqQty: e.target.value })}
              />
            </div>
            <div>
              <Label>Unit</Label>
              <Select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
                {UNITS.map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Productivity norm / day</Label>
              <Input
                type="number"
                step="0.001"
                min="0"
                value={form.norm}
                onChange={(e) => setForm({ ...form, norm: e.target.value })}
              />
            </div>
            <div className="col-span-2">
              <Label>Contractor (blank = departmental)</Label>
              <Input
                value={form.contractorName}
                onChange={(e) => setForm({ ...form, contractorName: e.target.value })}
              />
            </div>
            <div className="col-span-2">
              <Label>Starts after (dependency)</Label>
              <Select
                value={form.dependsOn}
                onChange={(e) => setForm({ ...form, dependsOn: e.target.value })}
              >
                <option value="">None</option>
                {activities.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="col-span-2 sm:col-span-4">
              {error ? (
                <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
              ) : null}
              <Button type="submit" disabled={busy}>
                {busy ? "Adding…" : "Add activity"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function TeamSection({
  siteId,
  users,
  roles,
}: {
  siteId: string;
  users: UserRow[];
  roles: { userId: string; role: string }[];
}) {
  const router = useRouter();
  const [newUser, setNewUser] = useState({ name: "", email: "", password: "" });
  const [assign, setAssign] = useState({ email: "", role: "engineer" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const roleByUser = new Map(roles.map((r) => [r.userId, r.role]));

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newUser),
      });
      const data = await res.json();
      setMsg(
        res.ok
          ? { ok: true, text: `User ${data.user.email} created — now assign a role below` }
          : { ok: false, text: data.error ?? "Failed" }
      );
      if (res.ok) {
        setAssign({ ...assign, email: newUser.email });
        setNewUser({ name: "", email: "", password: "" });
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function assignRole(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/sites/${siteId}/roles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(assign),
      });
      const data = await res.json();
      setMsg(
        res.ok ? { ok: true, text: "Role assigned" } : { ok: false, text: data.error ?? "Failed" }
      );
      if (res.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Site team — strict limited access per role</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {users.map((user) => {
              const role = user.isOwner ? "owner" : roleByUser.get(user.id);
              return (
                <div
                  key={user.id}
                  className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm"
                >
                  <div>
                    <span className="font-medium">{user.name}</span>{" "}
                    <span className="text-slate-400">{user.email}</span>
                  </div>
                  {role ? (
                    <Badge tone={role === "owner" ? "blue" : role === "engineer" ? "green" : "amber"}>
                      {role}
                    </Badge>
                  ) : (
                    <span className="text-xs text-slate-400">no role on this site</span>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Create user</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={createUser} className="space-y-3">
              <div>
                <Label>Name</Label>
                <Input
                  value={newUser.name}
                  onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label>Email</Label>
                <Input
                  type="email"
                  value={newUser.email}
                  onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label>Temporary password (min 8 chars)</Label>
                <Input
                  value={newUser.password}
                  onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                  required
                  minLength={8}
                />
              </div>
              <Button type="submit" disabled={busy}>
                Create
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Assign role on this site</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={assignRole} className="space-y-3">
              <div>
                <Label>User email</Label>
                <Input
                  type="email"
                  value={assign.email}
                  onChange={(e) => setAssign({ ...assign, email: e.target.value })}
                  required
                />
              </div>
              <div>
                <Label>Role</Label>
                <Select
                  value={assign.role}
                  onChange={(e) => setAssign({ ...assign, role: e.target.value })}
                >
                  <option value="engineer">Site engineer — field data entry only</option>
                  <option value="accounts">Accounts — fund approvals only</option>
                </Select>
              </div>
              <Button type="submit" disabled={busy}>
                Assign
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
      {msg ? (
        <p
          className={cn(
            "rounded-lg px-3 py-2 text-sm",
            msg.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
          )}
        >
          {msg.text}
        </p>
      ) : null}
    </div>
  );
}

function MaterialsSection({
  materials,
  mixes,
  workTypes,
}: {
  materials: MaterialRow[];
  mixes: MixRow[];
  workTypes: { id: string; name: string; defaultUnit: string }[];
}) {
  const router = useRouter();
  const [material, setMaterial] = useState({
    name: "",
    unit: "CUM",
    category: "other",
    densityKgPerCum: "",
    unitsPerCum: "",
  });
  const [workType, setWorkType] = useState({ name: "", defaultUnit: "CUM" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const materialById = new Map(materials.map((m) => [m.id, m]));

  async function addMaterial(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/materials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: material.name,
          unit: material.unit,
          category: material.category,
          densityKgPerCum: material.densityKgPerCum ? Number(material.densityKgPerCum) : undefined,
          unitsPerCum: material.unitsPerCum ? Number(material.unitsPerCum) : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed");
        return;
      }
      setMaterial({ ...material, name: "" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function addWorkType(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/work-types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(workType),
      });
      if (res.ok) {
        setWorkType({ name: "", defaultUnit: "CUM" });
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Materials (density / units-per-CUM enable stockpile scans)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {materials.map((m) => (
              <span key={m.id} className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">
                {m.name} ({m.unit})
                {m.densityKgPerCum ? ` · ${m.densityKgPerCum} kg/cum` : ""}
                {m.unitsPerCum ? ` · ${m.unitsPerCum}/cum` : ""}
              </span>
            ))}
          </div>
          <form onSubmit={addMaterial} className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div className="col-span-2">
              <Label>Name</Label>
              <Input
                value={material.name}
                onChange={(e) => setMaterial({ ...material, name: e.target.value })}
                required
              />
            </div>
            <div>
              <Label>Unit</Label>
              <Select
                value={material.unit}
                onChange={(e) => setMaterial({ ...material, unit: e.target.value })}
              >
                {UNITS.map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Category</Label>
              <Select
                value={material.category}
                onChange={(e) => setMaterial({ ...material, category: e.target.value })}
              >
                {["cement", "sand", "aggregate", "brick", "steel", "other"].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label>kg per CUM</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={material.densityKgPerCum}
                onChange={(e) => setMaterial({ ...material, densityKgPerCum: e.target.value })}
              />
            </div>
            <div>
              <Label>Units per CUM (bricks/bags)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={material.unitsPerCum}
                onChange={(e) => setMaterial({ ...material, unitsPerCum: e.target.value })}
              />
            </div>
            <div className="col-span-2 sm:col-span-4">
              {error ? <p className="mb-1 text-sm text-red-700">{error}</p> : null}
              <Button type="submit" disabled={busy}>
                Add material
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Mix designs (drive the consumption audit)</CardTitle>
        </CardHeader>
        <CardContent>
          {mixes.length === 0 ? (
            <p className="text-sm text-slate-500">No mixes yet — the seed script adds M20/M25.</p>
          ) : (
            <div className="space-y-2">
              {mixes.map((mix) => (
                <div key={mix.id} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                  <span className="font-medium">{mix.code}</span>{" "}
                  <span className="text-slate-500">{mix.name}</span>
                  <p className="text-xs text-slate-400">
                    per cum:{" "}
                    {mix.coefficients
                      .map(
                        (c) =>
                          `${materialById.get(c.materialId)?.name ?? "?"} ${Number(c.qtyPerUnit)}`
                      )
                      .join(" · ")}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Work types (for departmental labour)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {workTypes.map((w) => (
              <span key={w.id} className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">
                {w.name} ({w.defaultUnit})
              </span>
            ))}
          </div>
          <form onSubmit={addWorkType} className="flex gap-2">
            <Input
              placeholder="e.g. Brickwork"
              value={workType.name}
              onChange={(e) => setWorkType({ ...workType, name: e.target.value })}
              required
            />
            <Select
              className="w-28"
              value={workType.defaultUnit}
              onChange={(e) => setWorkType({ ...workType, defaultUnit: e.target.value })}
            >
              {UNITS.map((u) => (
                <option key={u}>{u}</option>
              ))}
            </Select>
            <Button type="submit" disabled={busy}>
              Add
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function PoliciesSection({ policies }: { policies: PolicyRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function update(policy: PolicyRow, patch: Partial<PolicyRow>) {
    setBusy(true);
    try {
      await fetch("/api/amendment-policies", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...policy, ...patch }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Edit rights — who may amend a submitted record, and until when</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-sm text-slate-600">
          Nothing is ever edited in place: an amendment creates a new version with a mandatory
          reason and lands in the amendment log. You are always allowed to amend anything (also
          logged). These switches govern what the <em>author</em> may amend.
        </p>
        <div className="space-y-2">
          {policies.map((policy) => (
            <div
              key={policy.recordType}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2.5"
            >
              <div>
                <p className="text-sm font-medium text-slate-800">
                  {POLICY_LABELS[policy.recordType] ?? policy.recordType}
                </p>
                <p className="text-xs text-slate-400">
                  {policy.enabled
                    ? WINDOW_LABELS[policy.allowedWindow]
                    : "Author amendments disabled — owner only"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Select
                  className="w-56"
                  disabled={busy || !policy.enabled}
                  value={policy.allowedWindow}
                  onChange={(e) => update(policy, { allowedWindow: e.target.value })}
                >
                  {WINDOWS.map((w) => (
                    <option key={w} value={w}>
                      {WINDOW_LABELS[w]}
                    </option>
                  ))}
                </Select>
                <Button
                  variant={policy.enabled ? "secondary" : "primary"}
                  disabled={busy}
                  onClick={() => update(policy, { enabled: !policy.enabled })}
                >
                  {policy.enabled ? "Disable" : "Enable"}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
