"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ALLOWED_COLLECTIONS } from "@/lib/registrationCollections";
import { getEventDisplayName } from "@/lib/events";

interface User {
  _id?: string;
  username: string;
  role: string;
  assignedEvent?: string | null;
}

export default function ManageUsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    username: "",
    password: "",
    role: "ATTENDEE_VIEWER",
    assignedEvent: "",
  });
  const [editing, setEditing] = useState<string | null>(null); // will hold user._id when editing
  const [editForm, setEditForm] = useState({
    username: "",
    password: "",
    role: "ATTENDEE_VIEWER",
    assignedEvent: "",
  });
  const [originalUser, setOriginalUser] = useState<User | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showEditPassword, setShowEditPassword] = useState(false);

  const api = async (method: string, url: string, body?: unknown) => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    try {
      const token =
        typeof window !== "undefined"
          ? window.localStorage.getItem("authToken")
          : null;
      if (token) headers["Authorization"] = `Bearer ${token}`;
    } catch {}
    const r = await fetch("/api" + url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) throw new Error((await r.json()).error || r.statusText);
    return r.json();
  };

  const load = async () => {
    setLoading(true);
    try {
      const list = await api("GET", "/admin/users");
      setUsers(list || []);
    } catch (e: unknown) {
      alert((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const createUser = async () => {
    if (!form.username.trim() || !form.password || form.password.length < 8) {
      alert("Username and password (min 8 chars) required");
      return;
    }
    // Assigned event required for Viewer/Scanner
    if (
      (form.role === "ATTENDEE_VIEWER" || form.role === "SCANNER") &&
      !form.assignedEvent
    ) {
      alert("Assigned Event required for selected role");
      return;
    }
    setCreating(true);
    try {
      await api("POST", "/admin/users", form);
      setForm({
        username: "",
        password: "",
        role: "ATTENDEE_VIEWER",
        assignedEvent: "",
      });
      await load();
    } catch (e: unknown) {
      alert((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const startEdit = (u: User) => {
    setEditing(String(u._id ?? u.username));
    setOriginalUser(u);
    setEditForm({
      username: u.username,
      password: "",
      role: u.role,
      assignedEvent: u.assignedEvent ?? "",
    });
  };

  const cancelEdit = () => {
    // Revert any accidental in-place mutations to the users list by restoring the original snapshot
    if (originalUser) {
      setUsers((prev) =>
        prev.map((u) =>
          String(u._id ?? u.username) ===
          String(originalUser._id ?? originalUser.username)
            ? originalUser
            : u,
        ),
      );
    }
    setEditing(null);
    setOriginalUser(null);
    setEditForm({
      username: "",
      password: "",
      role: "ATTENDEE_VIEWER",
      assignedEvent: "",
    });
  };

  const saveEdit = async () => {
    if (!editForm.username.trim()) {
      alert("Username required");
      return;
    }
    if (editForm.password && editForm.password.length < 8) {
      alert("Password must be at least 8 characters");
      return;
    }
    // Prevent elevating role to ADMIN
    if (editForm.role === "ADMIN") {
      alert("Cannot assign ADMIN role");
      return;
    }
    // Assigned event required for Viewer/Scanner
    if (
      (editForm.role === "ATTENDEE_VIEWER" || editForm.role === "SCANNER") &&
      !editForm.assignedEvent
    ) {
      alert("Assigned Event required for selected role");
      return;
    }
    try {
      // send id when available for robust ID-based updates
      const payload: Record<string, unknown> = {
        newUsername: editForm.username,
        password: editForm.password || undefined,
        role: editForm.role,
        assignedEvent: editForm.assignedEvent || undefined,
      };
      if (editing) payload.id = editing;
      await api("PUT", "/admin/users", payload);
      cancelEdit();
      await load();
    } catch (e: unknown) {
      alert((e as Error).message);
    }
  };

  const deleteUser = async (username: string) => {
    if (!confirm(`Delete ${username}?`)) return;
    try {
      await api("DELETE", "/admin/users", { username });
      await load();
    } catch (e: unknown) {
      alert((e as Error).message);
    }
  };

  return (
    <div style={{ padding: 20 }}>
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 8,
          }}
        >
          <h2 style={{ margin: 0 }}>Manage Users</h2>
          <button
            className="btn btn-ghost btn-back"
            onClick={() => router.push("/")}
          >
            Back
          </button>
        </div>

        {/* Create / Edit User Card */}
        <div className="card">
          <div className="card-body">
            <div className="card-title">Create / Edit User</div>
            <div className="form-grid">
              <input
                className="form-input"
                placeholder="Username"
                value={form.username}
                onChange={(e) =>
                  setForm((s) => ({ ...s, username: e.target.value }))
                }
              />

              <div style={{ position: "relative" }}>
                <input
                  className="form-input"
                  placeholder="Password"
                  value={form.password}
                  type={showPassword ? "text" : "password"}
                  onChange={(e) =>
                    setForm((s) => ({ ...s, password: e.target.value }))
                  }
                />
                <button
                  aria-label="toggle"
                  onClick={() => setShowPassword((s) => !s)}
                  className="eye-btn"
                >
                  <i className={`fas fa-eye${showPassword ? "" : "-slash"}`} />
                </button>
              </div>

              <select
                className="form-input"
                value={form.role}
                onChange={(e) =>
                  setForm((s) => ({ ...s, role: e.target.value }))
                }
              >
                <option value="ATTENDEE_VIEWER">Attendee Viewer</option>
                <option value="SCANNER">Scanner</option>
              </select>

              <select
                className="form-input"
                value={form.assignedEvent}
                onChange={(e) =>
                  setForm((s) => ({ ...s, assignedEvent: e.target.value }))
                }
              >
                <option value="">Select event...</option>
                {ALLOWED_COLLECTIONS.map((c) => (
                  <option key={c} value={c}>
                    {getEventDisplayName(c)}
                  </option>
                ))}
              </select>

              <div
                style={{
                  gridColumn: "1 / -1",
                  display: "flex",
                  justifyContent: "flex-end",
                }}
              >
                <button
                  className="btn btn-primary"
                  onClick={createUser}
                  disabled={creating}
                >
                  {creating ? "Creating..." : "Create"}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Users List Card */}
        <div style={{ height: 16 }} />
        <div className="card">
          <div className="card-body">
            <div className="card-title">Registered Users</div>
            <div className="divider" />

            {/* Desktop table */}
            <div className="users-table-wrap">
              <table className="users-table">
                <thead>
                  <tr>
                    <th>Username</th>
                    <th>Role</th>
                    <th>Assigned Event</th>
                    <th style={{ textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={String(u._id ?? u.username)} className="users-row">
                      <td>
                        {editing === (u._id ?? u.username) ? (
                          <input
                            className="form-input"
                            value={editForm.username}
                            onChange={(e) =>
                              setEditForm((s) => ({
                                ...s,
                                username: e.target.value,
                              }))
                            }
                          />
                        ) : (
                          u.username
                        )}
                      </td>
                      <td>
                        {editing === (u._id ?? u.username) ? (
                          <select
                            className="form-input"
                            value={editForm.role}
                            onChange={(e) =>
                              setEditForm((s) => ({
                                ...s,
                                role: e.target.value,
                              }))
                            }
                          >
                            <option value="ATTENDEE_VIEWER">
                              Attendee Viewer
                            </option>
                            <option value="SCANNER">Scanner</option>
                          </select>
                        ) : (
                          <span
                            className={`role-badge ${u.role === "SCANNER" ? "badge-scanner" : "badge-viewer"}`}
                          >
                            {u.role === "SCANNER"
                              ? "Scanner"
                              : "Attendee Viewer"}
                          </span>
                        )}
                      </td>
                      <td>
                        {editing === (u._id ?? u.username) ? (
                          <select
                            className="form-input"
                            value={editForm.assignedEvent}
                            onChange={(e) =>
                              setEditForm((s) => ({
                                ...s,
                                assignedEvent: e.target.value,
                              }))
                            }
                            disabled={editForm.role === "ADMIN"}
                          >
                            <option value="">(none)</option>
                            {ALLOWED_COLLECTIONS.map((c) => (
                              <option key={c} value={c}>
                                {getEventDisplayName(c)}
                              </option>
                            ))}
                          </select>
                        ) : u.assignedEvent ? (
                          getEventDisplayName(u.assignedEvent)
                        ) : (
                          "—"
                        )}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        {editing === (u._id ?? u.username) ? (
                          <div
                            style={{
                              display: "flex",
                              gap: 8,
                              justifyContent: "flex-end",
                            }}
                          >
                            <div
                              style={{ position: "relative", minWidth: 220 }}
                            >
                              <input
                                className="form-input"
                                placeholder="New password (leave blank to keep)"
                                value={editForm.password}
                                type={showEditPassword ? "text" : "password"}
                                onChange={(e) =>
                                  setEditForm((s) => ({
                                    ...s,
                                    password: e.target.value,
                                  }))
                                }
                              />
                              <button
                                aria-label="toggle"
                                onClick={() => setShowEditPassword((s) => !s)}
                                className="eye-btn"
                              >
                                <i
                                  className={`fas fa-eye${showEditPassword ? "" : "-slash"}`}
                                />
                              </button>
                            </div>
                            <button
                              className="btn btn-primary"
                              onClick={saveEdit}
                            >
                              Save
                            </button>
                            <button
                              className="btn btn-ghost"
                              onClick={cancelEdit}
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div
                            style={{
                              display: "flex",
                              gap: 8,
                              justifyContent: "flex-end",
                            }}
                          >
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() => startEdit(u)}
                            >
                              Edit
                            </button>
                            <button
                              className="btn btn-ghost btn-sm"
                              style={{ color: "var(--red)" }}
                              onClick={() => deleteUser(u.username)}
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile stacked cards */}
            <div className="mobile-cards">
              {users.map((u) => {
                const isEditingThis = editing === String(u._id ?? u.username);
                return (
                  <div key={String(u._id ?? u.username)} className="user-card">
                    {isEditingThis ? (
                      /* ── Edit mode ── */
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 10,
                        }}
                      >
                        <input
                          className="form-input"
                          placeholder="Username"
                          value={editForm.username}
                          onChange={(e) =>
                            setEditForm((s) => ({
                              ...s,
                              username: e.target.value,
                            }))
                          }
                        />
                        <select
                          className="form-input"
                          value={editForm.role}
                          onChange={(e) =>
                            setEditForm((s) => ({ ...s, role: e.target.value }))
                          }
                        >
                          <option value="ATTENDEE_VIEWER">
                            Attendee Viewer
                          </option>
                          <option value="SCANNER">Scanner</option>
                        </select>
                        <select
                          className="form-input"
                          value={editForm.assignedEvent}
                          onChange={(e) =>
                            setEditForm((s) => ({
                              ...s,
                              assignedEvent: e.target.value,
                            }))
                          }
                          disabled={editForm.role === "ADMIN"}
                        >
                          <option value="">(none)</option>
                          {ALLOWED_COLLECTIONS.map((c) => (
                            <option key={c} value={c}>
                              {getEventDisplayName(c)}
                            </option>
                          ))}
                        </select>
                        <div style={{ position: "relative" }}>
                          <input
                            className="form-input"
                            placeholder="New password (leave blank to keep)"
                            value={editForm.password}
                            type={showEditPassword ? "text" : "password"}
                            onChange={(e) =>
                              setEditForm((s) => ({
                                ...s,
                                password: e.target.value,
                              }))
                            }
                          />
                          <button
                            aria-label="toggle"
                            onClick={() => setShowEditPassword((s) => !s)}
                            className="eye-btn"
                          >
                            <i
                              className={`fas fa-eye${showEditPassword ? "" : "-slash"}`}
                            />
                          </button>
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            className="btn btn-primary"
                            style={{ flex: 1 }}
                            onClick={saveEdit}
                          >
                            Save
                          </button>
                          <button
                            className="btn btn-ghost"
                            style={{ flex: 1 }}
                            onClick={cancelEdit}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* ── Read mode ── */
                      <>
                        <div className="user-card-row">
                          <div style={{ fontWeight: 600 }}>{u.username}</div>
                          <div>
                            <span
                              className={`role-badge ${u.role === "SCANNER" ? "badge-scanner" : "badge-viewer"}`}
                            >
                              {u.role === "SCANNER"
                                ? "Scanner"
                                : "Attendee Viewer"}
                            </span>
                          </div>
                        </div>
                        <div style={{ color: "var(--muted)", marginTop: 6 }}>
                          {u.assignedEvent
                            ? getEventDisplayName(u.assignedEvent)
                            : "—"}
                        </div>
                        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                          <button
                            className="btn btn-ghost"
                            style={{ flex: 1 }}
                            onClick={() => startEdit(u)}
                          >
                            Edit
                          </button>
                          <button
                            className="btn btn-ghost"
                            style={{ flex: 1, color: "var(--red)" }}
                            onClick={() => deleteUser(u.username)}
                          >
                            Delete
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <style>{`
          .card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; box-shadow: 0 6px 18px rgba(0,0,0,0.03); margin-bottom: 12px; }
          .card-body { padding: 18px; }
          .card-title { font-weight: 700; margin-bottom: 8px; font-size: 14px; }
          .divider { height: 1px; background: var(--border); margin: 8px 0 12px; }
          .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; align-items: center; }
          .eye-btn { position: absolute; right: 8px; top: 8px; background: transparent; border: none; cursor: pointer; }
          .users-table-wrap { overflow-x: auto; }
          .users-table { width: 100%; border-collapse: collapse; }
          .users-table thead th { text-align: left; padding: 10px 8px; font-size: 13px; background: rgba(0,0,0,0.03); border-bottom: 1px solid var(--border); }
          .users-table tbody td { padding: 12px 8px; border-bottom: 1px solid var(--border); vertical-align: middle; }
          .users-row:hover { background: rgba(0,0,0,0.02); }
          .role-badge { display: inline-block; padding: 6px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; }
          .badge-scanner { background: rgba(254,243,199,0.8); color: #b26b00; }
          .badge-viewer { background: rgba(221,235,255,0.9); color: #0b3d91; }

          /* Mobile cards (hidden on desktop) */
          .mobile-cards { display: none; gap: 12px; }
          .user-card { border: 1px solid var(--border); border-radius: 10px; padding: 12px; background: var(--surface2); }
          .user-card-row { display: flex; justify-content: space-between; align-items: center; }

          @media (max-width: 700px) {
            .form-grid { grid-template-columns: 1fr; }
            .card { box-shadow: none; }
            .users-table-wrap { display: none; }
            .mobile-cards { display: flex; flex-direction: column; }
            .card-body { padding: 14px; }
            .eye-btn { top: 10px; }
            .card-title { font-size: 16px; }
            button.btn:not(.btn-back) { width: 100%; }
          }
        `}</style>
      </div>
    </div>
  );
}
