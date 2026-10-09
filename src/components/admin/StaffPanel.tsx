"use client";

import { useEffect, useState, type FormEvent } from "react";
import { adminCall, AdminApiError } from "./admin-api";
import { useAdmin } from "./AdminShell";
import { roleLabel } from "./format";
import { Empty, ErrorNote, inputClass, quietButton } from "./ui";

interface StaffPerson {
  email: string;
  role: string;
  you: boolean;
}

export function StaffPanel() {
  const { role } = useAdmin();
  if (role !== "super_admin") {
    return (
      <div className="max-w-lg">
        <h1 className="text-xl font-semibold tracking-tight">Staff</h1>
        <p className="mt-2 text-sm text-white/60">Only a super admin can view or change staff roles.</p>
      </div>
    );
  }
  return <StaffDesk />;
}

function StaffDesk() {
  const [loaded, setLoaded] = useState<{ key: number; staff: StaffPerson[]; error: string | null } | null>(null);
  const [nonce, setNonce] = useState(0);
  const [email, setEmail] = useState("");
  const [staffRole, setStaffRole] = useState("admin");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    adminCall<{ staff: StaffPerson[] }>("staff_list")
      .then((body) => {
        if (!cancel) setLoaded({ key: nonce, staff: body.staff, error: null });
      })
      .catch((err: unknown) => {
        if (!cancel) setLoaded({ key: nonce, staff: [], error: err instanceof AdminApiError ? err.message : "Could not load staff." });
      });
    return () => {
      cancel = true;
    };
  }, [nonce]);

  async function assign(e: FormEvent) {
    e.preventDefault();
    await save(email.trim(), staffRole);
    setEmail("");
  }

  async function save(target: string, next: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const body = await adminCall<{ email: string; role: string; invited?: boolean }>("staff_set", { email: target, staffRole: next });
      const label = body.role === "remove" ? "removed" : roleLabel(body.role);
      setMessage(body.invited ? `${body.email} was invited and assigned as ${label}.` : `${body.email} is now ${label}.`);
      setNonce((value) => value + 1);
    } catch (err: unknown) {
      setError(err instanceof AdminApiError ? err.message : "Could not update that role.");
    } finally {
      setBusy(false);
    }
  }

  const current = loaded?.key === nonce ? loaded : null;

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-semibold tracking-tight">Staff</h1>
      <p className="mt-1 text-sm text-white/55">
        Assign Admin or Door staff. A new email receives an invitation. A super admin is created only by the one-time setup, and you cannot change your own role.
      </p>
      {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
      {message && <p className="mt-3 text-sm text-emerald-100">{message}</p>}

      <form onSubmit={assign} className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_auto]">
        <input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@email.com" aria-label="Staff email" required />
        <select className={inputClass} value={staffRole} onChange={(e) => setStaffRole(e.target.value)} aria-label="Role">
          <option value="admin">Admin</option>
          <option value="door_staff">Door staff</option>
        </select>
        <button className={quietButton} type="submit" disabled={busy}>Assign</button>
      </form>

      {!current && <p className="mt-4 text-sm text-white/50">Loading staff…</p>}
      {current?.error && <div className="mt-4"><ErrorNote>{current.error}</ErrorNote></div>}
      {current && !current.error && current.staff.length === 0 && <Empty>No staff roles yet.</Empty>}
      {current && current.staff.length > 0 && (
        <ul className="mt-4 divide-y divide-white/10 rounded-lg border border-white/10">
          {current.staff.map((person) => (
            <StaffRow key={`${person.email}:${person.role}`} person={person} busy={busy} onSave={save} />
          ))}
        </ul>
      )}
    </div>
  );
}

function StaffRow({
  person,
  busy,
  onSave,
}: {
  person: StaffPerson;
  busy: boolean;
  onSave: (email: string, role: string) => Promise<void>;
}) {
  const [next, setNext] = useState(person.role === "door_staff" ? "door_staff" : "admin");
  const locked = person.you || person.role === "super_admin";
  return (
    <li className="flex flex-col gap-2 px-3 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <span className="min-w-0">
        <span className="block truncate">{person.email}</span>
        <span className="text-xs text-white/45">{roleLabel(person.role)}{person.you ? " · you" : ""}</span>
      </span>
      {locked ? null : (
        <span className="flex flex-wrap gap-2">
          <select className={inputClass} value={next} onChange={(e) => setNext(e.target.value)} aria-label={`Role for ${person.email}`}>
            <option value="admin">Admin</option>
            <option value="door_staff">Door staff</option>
          </select>
          <button type="button" className={quietButton} disabled={busy || next === person.role} onClick={() => void onSave(person.email, next)}>Save</button>
          <button type="button" className={quietButton} disabled={busy} onClick={() => void onSave(person.email, "remove")}>Remove</button>
        </span>
      )}
    </li>
  );
}
