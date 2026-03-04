"use client";

import { useEffect, useRef, useState, useCallback, Fragment } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { getEventDisplayName } from "@/lib/events";
import { ALLOWED_COLLECTIONS, DISPLAY_NAME_MAP } from "@/lib/registrationCollections";

// Maps event display names → DB collection names (used by the Add form)
const EVENT_DISPLAY_TO_COLLECTION: Record<string, string> = Object.fromEntries(
  Object.entries(DISPLAY_NAME_MAP).map(([col, display]) => [display, col]),
);
const EVENT_OPTIONS = Object.values(DISPLAY_NAME_MAP);
import {
  formatDateTime,
  DATE_FIELD_KEYS,
  isIsoDateString,
} from "@/lib/dateFormat";

// ── Types ──────────────────────────────────────────────────────────────────────
interface Doc {
  _id: string;
  [key: string]: unknown;
}
interface Stats {
  total: number;
  approved: number;
  rejected: number;
  checkedIn: number;
  pending: number;
}
interface ToastItem {
  id: number;
  msg: string;
  type: "success" | "error" | "info";
}
interface AppState {
  db: string;
  col: string;
  docs: Doc[];
  filtered: Doc[];
  selected: Doc | null;
  details: Doc | null;
  rejectTargetId: string | null;
  editingDoc: Doc | null;
  deleteTargetId: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────
const formatKey = (k: string) =>
  k
    .replace(/([A-Z])/g, " $1")
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (l) => l.toUpperCase());

// Known field-key variants that represent payment mode – always exported as "Payment Mode"
const PAYMENT_MODE_KEYS = new Set([
  "paymentMode",
  "payment_mode",
  "modeOfPayment",
  "mode_of_payment",
  "payMode",
  "pay_mode",
  "transactionMode",
  "transaction_mode",
]);

// Returns the human-readable column header for a given document key
const getColHeader = (k: string): string => {
  if (k === "__eventName") return "Event Name";
  if (PAYMENT_MODE_KEYS.has(k)) return "Payment Mode";
  return formatKey(k);
};

const formatColName = (n: string) => getEventDisplayName(n);

const getDocName = (doc: Doc): string => {
  for (const k of [
    "fullName",
    "firstName",
    "candidateName",
    "name",
    "title",
    "email",
  ]) {
    if (doc[k]) return String(doc[k]);
  }
  return "Unknown";
};

const getDocEmail = (doc: Doc): string =>
  String(doc.email ?? doc.mail ?? doc.Email ?? "");

const isImageVal = (v: unknown): boolean => {
  if (typeof v !== "string") return false;
  return (
    v.startsWith("data:image") ||
    v.startsWith("/9j/") ||
    v.startsWith("iVBOR") ||
    (v.length > 200 && /^[A-Za-z0-9+/=]+$/.test(v.slice(0, 100)))
  );
};

const isImageKey = (k: string): boolean =>
  /(screenshot|receipt|receipt_image|payment_screenshot|payment_receipt|image|photo|picture|img|signature|avatar|profile)/i.test(
    k,
  );

const getDocStatus = (doc: Doc): string =>
  doc.checkedIn ? "checked_in" : String(doc.status ?? "pending");

// ─── Excel Export Column Configuration ────────────────────────────────────────
// Fixed column order for Excel export with proper field mapping
const EXCEL_EXPORT_COLUMNS = [
  { header: "Event Name", field: "__eventName" },
  { header: "Id", field: "_id" },
  { header: "First Name", field: "firstName" },
  { header: "Last Name", field: "lastName" },
  { header: "Email", field: "email" },
  { header: "Contact Number", field: "contactNumber" },
  { header: "Gender", field: "gender" },
  { header: "Payment Mode", field: "paymentMode" },
  { header: "Transaction Id", field: "transactionId" },
  { header: "College Name", field: "collegeName" },
  { header: "Department", field: "department" },
  { header: "Year Of Study", field: "yearOfStudy" },
  { header: "College Register Number", field: "collegeRegisterNumber" },
  { header: "City", field: "city" },
  { header: "Workshop Name", field: "workshopName" },
  { header: "Registration Date", field: "registrationDate" },
  { header: "Approved At", field: "approvedAt" },
  { header: "Check In Time", field: "checkInTime" },
  { header: "Checked In", field: "checkedIn" },
  { header: "Qr Code", field: "qrCode" },
  { header: "Qr Token", field: "qrToken" },
  { header: "Status", field: "status" },
  { header: "Updated At", field: "updatedAt" },
  { header: "Registered At", field: "registeredAt" },
  { header: "Created At", field: "createdAt" },
] as const;

// Helper to pick first truthy value from field name variations
const pickField = (doc: Doc, ...keys: string[]): any => {
  for (const k of keys) {
    const v = (doc as any)[k];
    if (v != null && v !== "") return v;
  }
  return null;
};

// Field name variations mapping for flexible data extraction
const FIELD_VARIATIONS: Record<string, string[]> = {
  contactNumber: ["contactNumber", "phone", "mobile", "phoneNumber", "contact", "mobileNumber"],
  gender: ["gender", "Gender"],
  paymentMode: ["paymentMode", "payment_mode", "modeOfPayment"],
  collegeName: ["collegeName", "college", "institution", "institutionName", "College"],
  department: ["department", "dept", "branch", "stream", "Department"],
  yearOfStudy: ["yearOfStudy", "year", "currentYear", "Year"],
  collegeRegisterNumber: ["collegeRegisterNumber", "registerNumber", "regNo", "registrationNumber", "rollNumber", "rollNo", "regno", "registerNo"],
  city: ["city", "City", "location", "place"],
  workshopName: ["workshopName", "workshop", "eventName"],
  registrationDate: ["registrationDate", "registration_date"],
};

// Helper to extract and format field value for Excel export
const getExcelValue = (doc: Doc, field: string): string => {
  // Try field variations if defined
  const variations = FIELD_VARIATIONS[field];
  const v = variations ? pickField(doc, ...variations) : (doc as any)[field];
  
  if (v == null) return "";
  if (DATE_FIELD_KEYS.has(field) || isIsoDateString(v)) {
    return formatDateTime(v as string | number | Date | null);
  }
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
};

// ─── API helper ────────────────────────────────────────────────────────────────
async function api<T = unknown>(
  method: string,
  url: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  try {
    if (typeof window !== "undefined") {
      const token = window.localStorage.getItem("authToken");
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const basic = window.localStorage.getItem("basicAuth");
      if (basic && !headers["Authorization"])
        headers["Authorization"] = `Basic ${basic}`;
    }
  } catch {
    /* ignore */
  }
  const opts: RequestInit = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch("/api" + url, opts);
  if (!r.ok) {
    const e = await r.json().catch(() => ({ error: r.statusText }));
    const err = new Error(e.error || r.statusText);
    (err as any).status = r.status;
    throw err;
  }
  return r.json() as T;
}

// Returns data + fromCache flag based on X-Cache response header
async function apiWithMeta<T = unknown>(
  method: string,
  url: string,
  body?: unknown,
): Promise<{ data: T; fromCache: boolean }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  try {
    if (typeof window !== "undefined") {
      const token = window.localStorage.getItem("authToken");
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const basic = window.localStorage.getItem("basicAuth");
      if (basic && !headers["Authorization"])
        headers["Authorization"] = `Basic ${basic}`;
    }
  } catch {
    /* ignore */
  }
  const opts: RequestInit = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch("/api" + url, opts);
  if (!r.ok) {
    const e = await r.json().catch(() => ({ error: r.statusText }));
    const err = new Error(e.error || r.statusText);
    (err as any).status = r.status;
    throw err;
  }
  const fromCache = r.headers.get("x-cache") === "HIT";
  return { data: (await r.json()) as T, fromCache };
}

// Centered warning modal used for scanner forbidden scans
function CenteredWarning({
  open,
  message,
  onClose,
}: {
  open: boolean;
  message: string;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div className="modal-centered" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
          <i
            className="fas fa-exclamation-triangle"
            style={{ color: "var(--accent)" }}
          />{" "}
          Warning
        </div>
        <div style={{ color: "var(--muted)", marginBottom: 16 }}>{message}</div>
        <div style={{ textAlign: "right" }}>
          <button className="btn btn-primary" onClick={onClose}>
            OK
          </button>
        </div>
      </div>
      <style>{`
        .modal-centered{ position: fixed; inset:0; display:flex; align-items:center; justify-content:center; background: rgba(0,0,0,0.45); z-index: 3000 }
        .modal-card{ background: var(--card); border: 1px solid var(--border); padding: 20px; border-radius: 12px; width: 90%; max-width: 420px }
      `}</style>
    </div>
  );
}

// ── Serialise Mongo docs (ObjectId → string) ───────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serialise(doc: any): Doc {
  return JSON.parse(JSON.stringify(doc));
}

// ── StatusPill ─────────────────────────────────────────────────────────────────
function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: "pending",
    approved: "approved",
    rejected: "rejected",
    checked_in: "checked_in",
  };
  const cls = map[status] ?? "";
  const label =
    status === "checked_in"
      ? "Checked In"
      : status
        ? status.charAt(0).toUpperCase() + status.slice(1)
        : "Pending";
  return <span className={`status-pill ${cls}`}>{label}</span>;
}

// ── Toast ──────────────────────────────────────────────────────────────────────
function Toasts({ toasts }: { toasts: ToastItem[] }) {
  const icons: Record<string, string> = {
    success: "check-circle",
    error: "exclamation-circle",
    info: "info-circle",
  };
  const colors: Record<string, string> = {
    success: "var(--green)",
    error: "var(--red)",
    info: "var(--accent)",
  };
  return (
    <div id="toast-container">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.type}`}>
          <i
            className={`fas fa-${icons[t.type]}`}
            style={{ color: colors[t.type] }}
          />
          <span>{t.msg}</span>
        </div>
      ))}
    </div>
  );
}

// ── Loading Overlay ─────────────────────────────────────────────────────────────
function LoadingOverlay({ show, text }: { show: boolean; text: string }) {
  return (
    <div className={`loading-overlay${show ? " show" : ""}`}>
      <div className="spinner" />
      <span style={{ color: "var(--muted)", fontSize: 14 }}>{text}</span>
    </div>
  );
}

// ── ImageModal ─────────────────────────────────────────────────────────────────
function ImageModal({ src, onClose }: { src: string; onClose: () => void }) {
  if (!src) return null;
  return (
    <div className="img-modal open" onClick={onClose}>
      <span className="img-modal-close">&times;</span>
      <img src={src} alt="Preview" />
    </div>
  );
}

// ── StatsGrid ─────────────────────────────────────────────────────────────────
function StatsGrid({ stats }: { stats: Stats }) {
  return (
    <div className="stats-grid">
      {[
        { cls: "total", icon: "users", val: stats.total, lbl: "Total" },
        {
          cls: "approved",
          icon: "check-circle",
          val: stats.approved,
          lbl: "Approved",
        },
        { cls: "pending", icon: "clock", val: stats.pending, lbl: "Pending" },
        {
          cls: "rejected",
          icon: "times-circle",
          val: stats.rejected,
          lbl: "Rejected",
        },
        {
          cls: "checked",
          icon: "sign-in-alt",
          val: stats.checkedIn,
          lbl: "Checked In",
        },
      ].map((s) => (
        <div key={s.cls} className={`stat-card ${s.cls}`}>
          <div className="stat-icon">
            <i className={`fas fa-${s.icon}`} />
          </div>
          <div className="stat-val">{s.val}</div>
          <div className="stat-lbl">{s.lbl}</div>
        </div>
      ))}
    </div>
  );
}

// ── CachePill ────────────────────────────────────────────────────────────────
function CachePill({ source }: { source: "redis" | "db" | "mixed" | null }) {
  if (!source) return null;
  const cfg = {
    redis: { icon: "⚡", label: "Redis", color: "#22c55e" },
    db:    { icon: "🗄️", label: "DB",    color: "#64748b" },
    mixed: { icon: "⚡", label: "Partial", color: "#f59e0b" },
  }[source];
  return (
    <span
      style={{
        fontSize: 10,
        padding: "2px 8px",
        borderRadius: 20,
        background: cfg.color + "22",
        border: `1px solid ${cfg.color}55`,
        color: cfg.color,
        fontWeight: 700,
        whiteSpace: "nowrap",
        letterSpacing: 0.3,
      }}
    >
      {cfg.icon} {cfg.label}
    </span>
  );
}

// ── DocDetail ─────────────────────────────────────────────────────────────────
function DocDetail({
  doc,
  onApprove,
  onOpenReject,
  onEdit,
  onDelete,
  onResend,
  isAdmin,
  stats,
  cacheSource,
}: {
  doc: Doc;
  onApprove: (id: string) => void;
  onOpenReject: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onResend?: (id: string) => void;
  isAdmin?: boolean;
  stats?: Stats;
  cacheSource?: "redis" | "db" | "mixed" | null;
}) {
  const [imgSrc, setImgSrc] = useState("");
  const name = getDocName(doc);
  const status = getDocStatus(doc);
  const isPending = !doc.status || doc.status === "pending";
  const isApproved = doc.status === "approved";
  const isRejected = doc.status === "rejected";

  const fields = Object.entries(doc).filter(
    ([k, v]) =>
      k !== "_id" && k !== "qrCode" && !(isImageKey(k) && isImageVal(v)),
  );
  const images = Object.entries(doc).filter(
    ([k, v]) => isImageKey(k) && isImageVal(v),
  );

  return (
    <>
      {imgSrc && <ImageModal src={imgSrc} onClose={() => setImgSrc("")} />}
      <div className="detail-card">
        <div className="detail-header">
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 4,
              }}
            >
              <div className="detail-name">{name}</div>
              {stats && (
                <div
                  style={{
                    fontSize: 12,
                    padding: "4px 12px",
                    background: "var(--accent)",
                    color: "white",
                    borderRadius: 20,
                  }}
                >
                  <i
                    className="fas fa-hourglass-half"
                    style={{ marginRight: 6 }}
                  />{" "}
                  {stats.pending} Pending
                </div>
              )}
            </div>
            <div style={{ marginTop: 4 }}>
              <StatusPill status={status} />
            </div>
            {cacheSource && (
              <div style={{ marginTop: 6 }}>
                <CachePill source={cacheSource} />
              </div>
            )}
            {isRejected && doc.rejectionReason != null && (
              <div style={{ marginTop: 8, fontSize: 13, color: "var(--red)" }}>
                <i className="fas fa-info-circle" /> Reason:{" "}
                {String(doc.rejectionReason)}
              </div>
            )}
          </div>
          <div className="detail-actions">
            {isAdmin && isPending && (
              <>
                <button
                  className="btn btn-success"
                  onClick={() => onApprove(String(doc._id))}
                >
                  <i className="fas fa-check" /> Approve
                </button>
                <button
                  className="btn btn-danger"
                  onClick={() => onOpenReject(String(doc._id))}
                >
                  <i className="fas fa-times" /> Reject
                </button>
              </>
            )}
            {isApproved && !doc.checkedIn && (
              <div style={{ color: "var(--muted)", fontSize: 13 }}>
                <i
                  className="fas fa-check-circle"
                  style={{ color: "var(--green)" }}
                />{" "}
                Approved – waiting check-in
              </div>
            )}
            {isAdmin && isApproved && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => onResend && onResend(String(doc._id))}
                style={{ marginLeft: 8 }}
              >
                <i className="fas fa-envelope" /> Resend Email
              </button>
            )}
            {isRejected && (
              <div style={{ color: "var(--red)", fontSize: 13 }}>
                <i className="fas fa-times-circle" /> Rejected
              </div>
            )}
            {isAdmin && (
              <>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => onEdit(String(doc._id))}
                >
                  <i className="fas fa-edit" /> Edit
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ color: "var(--red)" }}
                  onClick={() => onDelete(String(doc._id))}
                >
                  <i className="fas fa-trash" />
                </button>
              </>
            )}
          </div>
        </div>

        <div className="detail-body">
          <div className="fields-grid">
            {fields.map(([k, v]) => {
              let val: React.ReactNode;
              if (v === null || v === undefined)
                val = <em style={{ color: "var(--muted)" }}>—</em>;
              else if (typeof v === "object")
                val = (
                  <code
                    style={{
                      fontSize: 11,
                      background: "var(--bg)",
                      padding: "4px 8px",
                      borderRadius: 4,
                      display: "block",
                      overflowX: "auto",
                    }}
                  >
                    {JSON.stringify(v, null, 2)}
                  </code>
                );
              else if (typeof v === "boolean")
                val = (
                  <span style={{ color: v ? "var(--green)" : "var(--red)" }}>
                    {v ? "Yes" : "No"}
                  </span>
                );
              else if (DATE_FIELD_KEYS.has(k) || isIsoDateString(v)) {
                val = formatDateTime(v as string | number | Date | null);
              } else {
                const s = String(v);
                val = s.length > 200 ? s.substring(0, 200) + "…" : s;
              }
              return (
                <div key={k} className="field-item">
                  <div className="field-label">{formatKey(k)}</div>
                  <div className="field-value">{val}</div>
                </div>
              );
            })}
          </div>

          {doc.qrCode != null && (
            <div className="qr-section">
              <img
                className="qr-img"
                src={String(doc.qrCode)}
                alt="QR Code"
                onClick={() => setImgSrc(String(doc.qrCode))}
              />
              <div>
                <div
                  style={{
                    fontFamily: "Syne,sans-serif",
                    fontWeight: 700,
                    marginBottom: 6,
                  }}
                >
                  Entry QR Code
                </div>
                <p
                  style={{
                    fontSize: 13,
                    color: "var(--muted)",
                    marginBottom: 12,
                  }}
                >
                  Attendee uses this to check in
                </p>
                {doc.checkInTime != null && (
                  <div style={{ fontSize: 12, color: "var(--blue)" }}>
                    <i className="fas fa-clock" /> Checked in:{" "}
                    {formatDateTime(String(doc.checkInTime))}
                  </div>
                )}
                <a
                  className="btn btn-ghost btn-sm"
                  style={{ marginTop: 10, display: "inline-flex" }}
                  download={`qr_${String(doc._id)}.png`}
                  href={String(doc.qrCode)}
                >
                  <i className="fas fa-download" /> Download QR
                </a>
              </div>
            </div>
          )}

          {images.map(([k, v]) => {
            const src = String(v).startsWith("data:")
              ? String(v)
              : "data:image/jpeg;base64," + String(v);
            return (
              <div key={k} className="img-preview">
                <div
                  style={{
                    fontFamily: "Syne,sans-serif",
                    fontWeight: 700,
                    marginBottom: 12,
                    fontSize: 14,
                  }}
                >
                  <i
                    className="fas fa-image"
                    style={{ color: "var(--accent)" }}
                  />{" "}
                  {formatKey(k)}
                </div>
                <img src={src} onClick={() => setImgSrc(src)} alt={k} />
                <div className="img-actions">
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setImgSrc(src)}
                  >
                    <i className="fas fa-expand" /> View
                  </button>
                  <a
                    className="btn btn-ghost btn-sm"
                    download={`${k}_${Date.now()}.png`}
                    href={src}
                  >
                    <i className="fas fa-download" /> Download
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

// ── ScannerPanel ──────────────────────────────────────────────────────────────
function ScannerPanel({
  onToast,
}: {
  onToast: (m: string, t: "success" | "error" | "info") => void;
}) {
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<React.ReactNode>(null);
  const [manualInput, setManualInput] = useState("");
  const [forbiddenModal, setForbiddenModal] = useState({
    open: false,
    msg: "",
  });
  const scannerRef = useRef<unknown>(null);
  // Prevents duplicate processing while a scan API call is in-flight
  const processingRef = useRef(false);
  // Ref for the result section – used to auto-scroll after a scan
  const scanResultRef = useRef<HTMLDivElement>(null);

  const stopScanner = useCallback(async () => {
    setScanning(false);
    try {
      if (scannerRef.current) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const inst = scannerRef.current as any;
        await inst.stop().catch(() => {});
        try {
          await inst.clear().catch(() => {});
        } catch {}
        scannerRef.current = null;
      }
    } catch {
      scannerRef.current = null;
    }
  }, []);

  const startScanner = useCallback(async () => {
    const { Html5Qrcode } = await import("html5-qrcode");
    try {
      setScanning(true);
      // ensure single instance
      if (scannerRef.current) {
        try {
          await (scannerRef.current as any).stop();
        } catch {}
        scannerRef.current = null;
      }

      const scanner = new Html5Qrcode("qr-reader", { verbose: false });
      scannerRef.current = scanner;

      // try to select a rear camera if available
      let cameraIdOrConfig: any = { facingMode: "environment" };
      try {
        if (typeof (Html5Qrcode as any).getCameras === "function") {
          const cams = await (Html5Qrcode as any).getCameras();
          if (Array.isArray(cams) && cams.length) {
            // prefer camera labels containing 'back' or 'rear', otherwise use first
            const back = cams.find((c: any) =>
              /back|rear|environment/i.test(c.label || ""),
            );
            cameraIdOrConfig = back && back.id ? back.id : cams[0].id;
          }
        }
      } catch {
        // getCameras unavailable – facingMode fallback stays
      }

      const onDecode = async (decoded: string, result?: unknown) => {
        // Ignore rapid duplicate callbacks while a scan is already processing
        if (processingRef.current) return;
        processingRef.current = true;
        try {
          await processScan(decoded);
        } catch (e) {
          console.error("onDecode handler error", e);
        } finally {
          // Unlock after a short delay so the same QR isn't re-scanned immediately
          setTimeout(() => {
            processingRef.current = false;
          }, 2500);
        }
      };

      const onError = (_err: unknown) => {
        // decode attempt failed for a frame – not fatal
      };

      const config = { fps: 10, qrbox: { width: 250, height: 250 } } as any;
      await scanner.start(cameraIdOrConfig, config, onDecode, onError);
    } catch (e: unknown) {
      console.error("startScanner error", e);
      onToast("Camera error: " + String(e), "error");
      setScanning(false);
      try {
        await stopScanner();
      } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopScanner, onToast]);

  useEffect(() => {
    return () => {
      stopScanner();
    };
  }, [stopScanner]);

  // Auto-start camera when the ScannerPanel mounts
  useEffect(() => {
    let mounted = true;
    if (mounted) {
      startScanner();
    }
    return () => {
      mounted = false;
    };
  }, [startScanner]);

  // Auto-scroll to result whenever it changes
  useEffect(() => {
    if (scanResult && scanResultRef.current) {
      scanResultRef.current.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }
  }, [scanResult]);

  const processScan = async (data: string): Promise<void> => {
    setScanResult(
      <div style={{ textAlign: "center", padding: 24 }}>
        <div className="spinner" style={{ margin: "auto" }} />
      </div>,
    );
    try {
      const r = await api<{
        document: Doc;
        db: string;
        collection: string;
        eventName?: string;
      }>("POST", "/scan", { qrData: data });
      const doc = serialise(r.document);
      const name = getDocName(doc);
      const email = getDocEmail(doc);
      const eventName =
        r?.eventName ||
        (r?.collection ? getEventDisplayName(r.collection) : "");
      const alreadyIn = !!doc.checkedIn;

      setScanResult(
        <div className={`scan-result success`}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 12,
            }}
          >
            <i
              className="fas fa-user-circle"
              style={{ fontSize: 36, color: "var(--accent)" }}
            />
            <div>
              <div className="scan-attendee-name">{name}</div>
              {eventName ? (
                <div style={{ fontSize: 13, color: "var(--muted)" }}>
                  {eventName}
                </div>
              ) : null}
              {email && (
                <div style={{ fontSize: 13, color: "var(--muted)" }}>
                  {email}
                </div>
              )}
            </div>
          </div>
          {/* Event / Workshop name */}
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              background: "rgba(99,102,241,0.15)",
              border: "1px solid rgba(99,102,241,0.4)",
              borderRadius: 20,
              padding: "4px 12px",
              fontSize: 12,
              color: "var(--accent)",
              fontWeight: 600,
              marginBottom: 12,
            }}
          >
            <i className="fas fa-calendar-star" />
            {getEventDisplayName(r.collection)}
          </div>
          <div className={`checkin-status ${alreadyIn ? "in" : "out"}`}>
            <i className={`fas fa-${alreadyIn ? "check-circle" : "clock"}`} />
            {alreadyIn
              ? `Already Checked In at ${formatDateTime(String(doc.checkInTime))}`
              : "Not Yet Checked In"}
          </div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              marginBottom: 16,
            }}
          >
            {Object.entries(doc)
              .filter(
                ([k]) =>
                  k !== "_id" &&
                  k !== "qrCode" &&
                  k !== "qrToken" &&
                  !isImageKey(k),
              )
              .slice(0, 8)
              .map(([k, v]) => (
                <div
                  key={k}
                  style={{
                    background: "var(--surface2)",
                    borderRadius: 8,
                    padding: "8px 12px",
                  }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      color: "var(--muted)",
                      textTransform: "uppercase",
                    }}
                  >
                    {formatKey(k)}
                  </div>
                  <div style={{ fontSize: 13 }}>
                    {v == null
                      ? "—"
                      : DATE_FIELD_KEYS.has(k) || isIsoDateString(v)
                        ? formatDateTime(v as string | number | Date | null)
                        : String(v).substring(0, 40)}
                  </div>
                </div>
              ))}
          </div>
          {!alreadyIn ? (
            <button
              className="btn btn-success"
              style={{ width: "100%" }}
              onClick={() =>
                doCheckIn(String(doc._id), r.db, r.collection, data)
              }
            >
              <i className="fas fa-sign-in-alt" /> Confirm Check-In
            </button>
          ) : (
            <div
              style={{
                color: "var(--green)",
                textAlign: "center",
                fontWeight: 600,
              }}
            >
              <i className="fas fa-check-circle" /> Already Checked In
            </div>
          )}
        </div>,
      );
    } catch (e: unknown) {
      const err = e as any;
      if (err && err.status === 403) {
        // Assigned-event mismatch: show centered warning modal and clear scan result
        setScanResult(null);
        setForbiddenModal({
          open: true,
          msg: "This QR code does not belong to your assigned event.",
        });
        return;
      }
      setScanResult(
        <div className="scan-result error">
          <div
            style={{
              color: "var(--red)",
              fontFamily: "Syne,sans-serif",
              fontWeight: 700,
              marginBottom: 8,
            }}
          >
            <i className="fas fa-times-circle" /> Invalid QR Code
          </div>
          <p style={{ fontSize: 13, color: "var(--muted)" }}>
            {(e as Error).message}
          </p>
        </div>,
      );
    }
  };

  const doCheckIn = async (
    id: string,
    db: string,
    collection: string,
    rawData: string,
  ) => {
    try {
      // Extract token from raw QR payload when available
      let token: string | undefined;
      try {
        const p = JSON.parse(rawData);
        token = p?.token;
      } catch {
        token = undefined;
      }
      await api("POST", "/checkin", { id, db, collection, token });
      onToast("✅ Check-in successful!", "success");
      await processScan(rawData);
    } catch (e: unknown) {
      const err = e as any;
      if (err && err.status === 403) {
        setForbiddenModal({
          open: true,
          msg: "This QR code does not belong to your assigned event.",
        });
        return;
      }
      onToast((e as Error).message, "error");
    }
  };

  const manualScan = async () => {
    if (!manualInput.trim()) {
      onToast("Enter QR data", "error");
      return;
    }
    await processScan(manualInput.trim());
  };

  return (
    <div className="scanner-panel">
      <h2
        style={{
          fontFamily: "Syne,sans-serif",
          fontSize: 24,
          marginBottom: 24,
          alignSelf: "flex-start",
        }}
      >
        <i className="fas fa-qrcode" style={{ color: "var(--accent)" }} /> QR
        Check-In Scanner
      </h2>

      <div className="scanner-box">
        <div className="scanner-head">
          <i className="fas fa-camera" /> Point camera at attendee QR code
        </div>

        <div className="qr-wrapper">
          <div id="qr-reader" />
          <div className="qr-overlay" aria-hidden="true" />
        </div>
      </div>

      <div
        style={{
          width: "100%",
          maxWidth: 500,
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: 16,
          padding: 20,
          marginBottom: 24,
        }}
      >
        <div
          style={{
            fontFamily: "Syne,sans-serif",
            fontWeight: 700,
            marginBottom: 12,
            fontSize: 15,
          }}
        >
          <i className="fas fa-keyboard" style={{ color: "var(--accent)" }} />{" "}
          Manual QR Data Entry
        </div>
        <input
          type="text"
          className="form-input"
          placeholder="Paste QR JSON or token here"
          value={manualInput}
          onChange={(e) => setManualInput(e.target.value)}
        />
        <button
          className="btn btn-primary"
          style={{ marginTop: 10, width: "100%" }}
          onClick={manualScan}
        >
          <i className="fas fa-search" /> Lookup
        </button>
      </div>

      <div ref={scanResultRef} style={{ width: "100%", maxWidth: 500 }}>
        {scanResult}
      </div>
      <CenteredWarning
        open={forbiddenModal.open}
        message={forbiddenModal.msg}
        onClose={() => setForbiddenModal({ open: false, msg: "" })}
      />
    </div>
  );
}

// ── Dashboard (main) ─────────────────────────────────────────────────────────
export default function Dashboard() {
  const router = useRouter();
  const [userRole, setUserRole] = useState<string | null>(null);
  const [state, setState] = useState<AppState>({
    db: "test",
    col: "",
    docs: [],
    filtered: [],
    selected: null,
    details: null,
    rejectTargetId: null,
    editingDoc: null,
    deleteTargetId: null,
  });
  const [dbs, setDbs] = useState<string[]>([]);
  const [cols, setCols] = useState<string[]>([]);
  const [assignedEvent, setAssignedEvent] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState("Loading...");
  const [activeTab, setActiveTab] = useState<"records" | "scanner">("records");
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const isAdmin = userRole === "ADMIN";
  const isViewer = userRole === "ATTENDEE_VIEWER";
  const isScanner = userRole === "SCANNER";
  const isRegistrar = userRole === "REGISTRAR";
  const [searchQ, setSearchQ] = useState("");
  const [docsSource, setDocsSource] = useState<"redis" | "db" | "mixed" | null>(null);
  const [detailSource, setDetailSource] = useState<"redis" | "db" | null>(null);
  const [filterStatus, setFilterStatus] = useState("");
  // ── PDF transaction-ID filter ──────────────────────────────────────────────
  const [pdfTxIds, setPdfTxIds] = useState<Set<string> | null>(null);
  const [pdfFileName, setPdfFileName] = useState<string>("");
  const [pdfTxIdList, setPdfTxIdList] = useState<string[]>([]);
  const [showPdfIds, setShowPdfIds] = useState(false);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [editFormData, setEditFormData] = useState<Record<string, any>>({});
  const [modals, setModals] = useState({
    reject: false,
    doc: false,
    delete: false,
  });
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const restoringRef = useRef(false);
  const restoredOnceRef = useRef(false);
  const toastCounterRef = useRef(0);

  // ── URL sync helper ────────────────────────────────────────────────────────
  // Shallow-updates browser URL query params without Next.js navigation or
  // component re-mount. All navigation actions call this to keep URL in sync.
  const pushUrl = (col: string | null, docId: string | null) => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    col ? url.searchParams.set("col", col) : url.searchParams.delete("col");
    docId ? url.searchParams.set("id", docId) : url.searchParams.delete("id");
    window.history.replaceState(null, "", url.toString());
  };

  // Centralized persistence key and helpers (sessionStorage)
  const PERSIST_KEY = "dashboard:state";
  type PersistState = {
    collectionName?: string;
    selectedStatus?: string;
    selectedParticipantId?: string | null;
  };
  // Session storage TTL: 10 minutes
  const PERSIST_TTL_MS = 10 * 60 * 1000;
  const readPersist = (): PersistState | null => {
    if (typeof window === "undefined") return null;
    try {
      const s = sessionStorage.getItem(PERSIST_KEY);
      if (!s) return null;
      const parsed = JSON.parse(s) as PersistState & { _ts?: number };
      // Expire after 10 minutes
      if (parsed._ts && Date.now() - parsed._ts > PERSIST_TTL_MS) {
        sessionStorage.removeItem(PERSIST_KEY);
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  };
  const writePersist = (p: PersistState) => {
    if (typeof window === "undefined") return;
    try {
      sessionStorage.setItem(
        PERSIST_KEY,
        JSON.stringify({ ...p, _ts: Date.now() }),
      );
    } catch {}
  };
  const clearPersist = () => {
    if (typeof window === "undefined") return;
    try {
      sessionStorage.removeItem(PERSIST_KEY);
    } catch {}
  };

  const toast = useCallback(
    (msg: string, type: "success" | "error" | "info" = "info") => {
      const id = ++toastCounterRef.current;
      setToasts((prev) => [...prev, { id, msg, type }]);
      setTimeout(
        () => setToasts((prev) => prev.filter((t) => t.id !== id)),
        3500,
      );
    },
    [],
  );

  const openUsersModal = () => {
    router.push("/admin/manage-users");
  };

  const logout = () => {
    try {
      if (typeof window !== "undefined") {
        window.localStorage.removeItem("authToken");
        window.localStorage.removeItem("basicAuth");
        // Clear all session storage on logout
        sessionStorage.clear();
      }
    } catch {
      /* ignore */
    }
    try {
      clearPersist();
    } catch {}
    pushUrl(null, null);
    router.replace("/login");
  };

  const removeUser = async (username: string) => {
    if (!confirm(`Delete user ${username}?`)) return;
    try {
      await api("DELETE", "/admin/users", { username });
      toast("User deleted", "info");
    } catch (e: unknown) {
      toast((e as Error).message, "error");
    }
  };

  const showLoading = (text = "Loading...") => {
    setLoadingText(text);
    setLoading(true);
  };
  const hideLoading = () => setLoading(false);

  const openModal = (m: keyof typeof modals) =>
    setModals((prev) => ({ ...prev, [m]: true }));
  const closeModal = (m: keyof typeof modals) =>
    setModals((prev) => ({ ...prev, [m]: false }));

  // ── init ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        // fetch current role
        let role: string | null = null;
        let assigned: string | null = null;
        try {
          const r = await api<{
            user?: { role?: string; assignedEvent?: string };
          }>("GET", "/auth/me");
          role = r?.user?.role ? String(r.user.role) : null;
          setUserRole(role);
          assigned = r?.user?.assignedEvent
            ? String(r.user.assignedEvent)
            : null;
          setAssignedEvent(assigned);
          if (role === "SCANNER") setActiveTab("scanner");
        } catch {
          setUserRole(null);
        }
        // Redirect unauthenticated users to login
        if (!role) {
          router.push("/login");
          return;
        }

        // Read URL params – these take priority for state restoration
        const urlParams =
          typeof window !== "undefined"
            ? new URLSearchParams(window.location.search)
            : null;
        const urlCol = urlParams?.get("col") || null;
        const urlId = urlParams?.get("id") || null;

        // Load DBs / assigned event
        if (role === "ADMIN") {
          await onDbChange("test");
          // Restore from URL when params are present (on refresh / direct link)
          if (urlCol) {
            await onColChange(urlCol, "test");
            if (urlId) await selectDoc(urlId, "test", urlCol);
          }
        } else if (role === "ATTENDEE_VIEWER") {
          await onDbChange("test");
          if (assigned && assigned !== "*") {
            // Specific-event viewer: auto-load their one collection
            await onColChange(assigned, "test");
            setState((s) => ({ ...s, col: assigned }));
            if (urlId) await selectDoc(urlId, "test", assigned!);
          } else if (assigned === "*") {
            // All-events viewer: let them pick a collection; restore from URL if present
            if (urlCol) {
              await onColChange(urlCol, "test");
              if (urlId) await selectDoc(urlId, "test", urlCol);
            }
          }
        } else if (role === "SCANNER") {
          if (assigned) {
            setState((s) => ({ ...s, col: assigned }));
          }
          try {
            stopAutoRefresh();
          } catch {
            /* ignore */
          }
        } else if (role === "REGISTRAR") {
          // Pre-select assigned event for REGISTRAR so the Add modal can pre-fill
          if (assigned && assigned !== "*") {
            setState((s) => ({ ...s, col: assigned! }));
          }
        }
        setConnected(true);
      } catch (e: unknown) {
        setConnected(false);
        toast("Cannot connect to server: " + (e as Error).message, "error");
      }
    })();
  }, [toast]);

  // ── filter ────────────────────────────────────────────────────────────────
  const applyFilter = useCallback(
    (docs: Doc[], q: string, st: string): Doc[] => {
      const qLower = q.toLowerCase();
      return docs.filter((d) => {
        const name = getDocName(d).toLowerCase();
        const email = getDocEmail(d).toLowerCase();
        // Gather all known transaction-ID-like fields into one string for matching
        const txField = String(
          d.transactionId ??
            d.transaction_id ??
            d.utr ??
            d.upiTransactionId ??
            d.paymentId ??
            d.payment_id ??
            d.txnId ??
            d.txn_id ??
            d.referenceId ??
            "",
        ).toLowerCase();
        const matchQ =
          !q ||
          name.includes(qLower) ||
          email.includes(qLower) ||
          String(d.registrationId ?? "").includes(q) ||
          txField.includes(qLower);
        const docSt = getDocStatus(d);
        const matchS = !st || docSt === st;
        return matchQ && matchS;
      });
    },
    [],
  );

  // ── PDF match helper – checks if ANY field value in the doc contains one
  // of the transaction IDs extracted from the uploaded bank statement PDF.
  const docMatchesPdf = useCallback(
    (doc: Doc, txIds: Set<string> | null): boolean => {
      if (!txIds || txIds.size === 0) return false;
      const allVals = Object.values(doc).map((v) =>
        String(v ?? "").toLowerCase(),
      );
      for (const tid of Array.from(txIds)) {
        if (allVals.some((f) => f.includes(tid.toLowerCase()))) return true;
      }
      return false;
    },
    [],
  );

  useEffect(() => {
    setState((prev) => ({
      ...prev,
      filtered: applyFilter(prev.docs, searchQ, filterStatus),
    }));
  }, [searchQ, filterStatus, applyFilter]);

  // Centralized restoration: restore persisted selection after collections are loaded
  useEffect(() => {
    if (restoredOnceRef.current) return;
    if (typeof window === "undefined") {
      restoredOnceRef.current = true;
      return;
    }
    if (!cols || cols.length === 0) return;
    const p = readPersist();
    if (!p) {
      restoredOnceRef.current = true;
      return;
    }
    (async () => {
      restoringRef.current = true;
      try {
        const wantCol = p.collectionName;
        if (
          wantCol &&
          cols.map((c) => c.toLowerCase()).includes(wantCol.toLowerCase())
        ) {
          // If current user is a scanner, avoid calling protected endpoints (documents/stats)
          if (isScanner) {
            setState((s) => ({ ...s, col: wantCol }));
          } else {
            await onColChange(wantCol, state.db);
            setState((s) => ({ ...s, col: wantCol }));
            if (p.selectedParticipantId) {
              // ensure docs are loaded and select participant if present
              const docs =
                state.docs && state.docs.length
                  ? state.docs
                  : await loadDocs(state.db, wantCol);
              if (
                docs &&
                docs.map((d) => String(d._id)).includes(p.selectedParticipantId)
              ) {
                await selectDoc(p.selectedParticipantId, state.db, wantCol);
              }
            }
          }
        }
        if (p.selectedStatus != null) setFilterStatus(p.selectedStatus);
      } catch (e) {
        /* ignore */
      } finally {
        restoringRef.current = false;
        restoredOnceRef.current = true;
      }
    })();
  }, [cols]);

  // Centralized persistence: write single JSON blob when relevant state changes
  useEffect(() => {
    // Do not write until restoration has completed to avoid overwriting persisted values
    if (
      restoringRef.current ||
      typeof window === "undefined" ||
      !restoredOnceRef.current
    )
      return;
    const toSave: PersistState = {
      collectionName: state.col || undefined,
      selectedStatus: filterStatus || undefined,
      selectedParticipantId: state.selected
        ? String((state.selected as Doc)._id)
        : undefined,
    };
    try {
      writePersist(toSave);
    } catch {}
  }, [state.col, filterStatus, state.selected]);

  // ── DB change ─────────────────────────────────────────────────────────────
  const onDbChange = async (db: string): Promise<string[]> => {
    stopAutoRefresh();
    setState((prev) => ({
      ...prev,
      db,
      col: "",
      docs: [],
      filtered: [],
      selected: null,
      details: null,
    }));
    setCols([]);
    setStats(null);
    if (!db) return [];
    // Prevent scanners from calling protected collection listing endpoint
    if (isScanner) return [];
    try {
      const list = await api<string[]>("GET", `/databases/${db}/collections`);
      const lower = new Set(list.map((s) => String(s).toLowerCase()));
      const orderedAllowed = ALLOWED_COLLECTIONS.filter((c) => lower.has(c));
      setCols(orderedAllowed);
      try {
        /* no-op: persistence handled centrally */
      } catch (e) {
        /* ignore */
      }
      return orderedAllowed;
    } catch (e: unknown) {
      toast((e as Error).message, "error");
    }
    return [];
  };

  // ── Col change ────────────────────────────────────────────────────────────
  const onColChange = async (col: string, dbParam?: string): Promise<Doc[]> => {
    const dbToUse = dbParam ?? state.db;
    stopAutoRefresh();
    setDocsSource(null);
    setDetailSource(null);
    setState((prev) => ({
      ...prev,
      col,
      selected: null,
      docs: [],
      filtered: [],
      details: null,
      rejectTargetId: null,
      editingDoc: null,
      deleteTargetId: null,
    }));
    setStats(null);
    // If clearing selection, also reset search/filter and close modals for a clean blank state
    if (!col) {
      setSearchQ("");
      setFilterStatus("");
      setModals({ reject: false, doc: false, delete: false });
      pushUrl(null, null);
      return [];
    }
    // Update URL – collection selected, no participant yet
    pushUrl(col, null);
    if (isScanner) return [];

    // Special case: "All Events" – aggregate all collections
    if (col === "__all__") {
      const docs = await loadAllDocs();
      return docs;
    }

    const docs = await loadDocs(dbToUse, col);
    await loadStats(dbToUse, col);
    startAutoRefresh(dbToUse, col);
    return docs ?? [];
  };

  const loadDocs = async (db: string, col: string): Promise<Doc[]> => {
    if (isScanner) return [];
    showLoading("Fetching records...");
    try {
      const { data: rawDocs, fromCache } = await apiWithMeta<Doc[]>("GET", `/databases/${db}/collections/${col}/documents`);
      const docs = rawDocs.map(serialise);
      setDocsSource(fromCache ? "redis" : "db");
      const sorted = docs.sort((a, b) => {
        const ra = String(
          a.registrationId ?? a.regId ?? a.registerNumber ?? "",
        );
        const rb = String(
          b.registrationId ?? b.regId ?? b.registerNumber ?? "",
        );
        return ra.localeCompare(rb, undefined, { numeric: true });
      });
      setState((prev) => ({
        ...prev,
        docs: sorted,
        filtered: applyFilter(sorted, searchQ, filterStatus),
      }));
      return sorted;
    } catch (e: unknown) {
      toast((e as Error).message, "error");
    } finally {
      hideLoading();
    }
    return [];
  };

  const loadStats = async (db: string, col: string) => {
    if (isScanner) {
      setStats(null);
      return;
    }
    try {
      const s = await api<Stats>(
        "GET",
        `/databases/${db}/collections/${col}/stats`,
      );
      setStats(s);
    } catch (e: unknown) {
      // Surface stats errors so they're visible
      toast("Stats: " + (e as Error).message, "error");
    }
  };

  // ── load all events (admin "All Events" mode) ──────────────────────────────
  const loadAllDocs = async (): Promise<Doc[]> => {
    if (isScanner) return [];
    showLoading("Fetching all event records...");
    const allDocs: Doc[] = [];
    try {
      const results = await Promise.allSettled(
        ALLOWED_COLLECTIONS.map(async (col) => {
          const { data: rawDocs, fromCache } = await apiWithMeta<Doc[]>(
            "GET",
            `/databases/${state.db}/collections/${col}/documents`,
          );
          return { col, docs: rawDocs.map(serialise), fromCache };
        }),
      );

      let cacheHits = 0;
      let cacheMisses = 0;
      for (const result of results) {
        if (result.status !== "fulfilled") continue;
        const { col, docs, fromCache } = result.value;
        if (fromCache) cacheHits++;
        else cacheMisses++;
        const eventName = getEventDisplayName(col) || col;
        docs.forEach((d) => {
          (d as any).__eventName = eventName;
          (d as any).__col = col; // track source collection for per-doc actions
          allDocs.push(d);
        });
      }
      setDocsSource(cacheHits > 0 && cacheMisses === 0 ? "redis" : cacheHits === 0 ? "db" : "mixed");
      const sorted = allDocs.sort((a, b) => {
        const ra = String(
          a.registrationId ?? a.regId ?? a.registerNumber ?? "",
        );
        const rb = String(
          b.registrationId ?? b.regId ?? b.registerNumber ?? "",
        );
        return ra.localeCompare(rb, undefined, { numeric: true });
      });
      // Compute stats client-side from merged docs
      const computedStats: Stats = {
        total: sorted.length,
        approved: sorted.filter((d) => d.status === "approved").length,
        rejected: sorted.filter((d) => d.status === "rejected").length,
        checkedIn: sorted.filter((d) => !!d.checkedIn).length,
        pending: sorted.filter((d) => !d.status || d.status === "pending")
          .length,
      };
      setState((prev) => ({
        ...prev,
        docs: sorted,
        filtered: applyFilter(sorted, searchQ, filterStatus),
      }));
      setStats(computedStats);
      return sorted;
    } catch (e: unknown) {
      toast((e as Error).message, "error");
    } finally {
      hideLoading();
    }
    return [];
  };

  // ── parse PDF bank statement for transaction IDs ───────────────────────────
  const parsePdf = async (file: File): Promise<string[]> => {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdfjsLib = await import("pdfjs-dist");
      // Use locally served worker (copied to /public at build time) to avoid
      // CDN fetch failures in all environments including localhost.
      (pdfjsLib as any).GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      const pdf = await (pdfjsLib as any).getDocument({ data: arrayBuffer })
        .promise;

      // Collect every text token from every page individually (not joined)
      // so we can run per-token and joined-line matching.
      const allTokens: string[] = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        for (const item of content.items) {
          if ("str" in item && (item as any).str.trim()) {
            allTokens.push((item as any).str.trim());
          }
        }
      }

      // Join tokens; omit the space when a number is split across PDF text items
      // e.g. "6063774315" + "55" → "606377431555" instead of "6063774315 55"
      let fullText = allTokens[0] ?? "";
      for (let i = 1; i < allTokens.length; i++) {
        const sep = /\d$/.test(allTokens[i - 1]) && /^\d/.test(allTokens[i]) ? "" : " ";
        fullText += sep + allTokens[i];
      }

      const ids = new Set<string>();

      // ── Pattern 1 ── UPI/NAME/TXNID/UPI  (Description column)
      // Kotak format: UPI/VAMSI KASARANE/604786088621/UPI
      // The name portion may contain spaces so we use [^/]+ greedily
      const p1 = /UPI\/[^/]+?\/(\d{9,15})\/UPI/gi;

      // ── Pattern 2 ── UPI-XXXX or UPI/XXXX  (Chq/Ref No column)
      // Kotak format: UPI-604798425905
      const p2 = /UPI[-/](\d{9,15})/gi;

      // ── Pattern 3 ── Any standalone 12-digit number (UPI UTR standard length)
      const p3 = /\b(\d{12})\b/g;

      // ── Pattern 4 ── UTR followed by digits
      const p4 = /UTR\s*:?\s*(\d{9,15})/gi;

      // ── Pattern 5 ── UPI/CR/TXNID/NAME (Canara / SIB / DEP TFR format)
      // e.g. DEP TFR   UPI/CR/119465302404/KISHORE /CNRB/...
      const p5 = /UPI\/CR\/(\d{9,15})\//gi;

      for (const pat of [p5, p1, p2, p3, p4]) {
        let m: RegExpExecArray | null;
        while ((m = pat.exec(fullText)) !== null) {
          ids.add(m[1]);
        }
      }

      return Array.from(ids);
    } catch (e: unknown) {
      toast("PDF parse error: " + (e as Error).message, "error");
      return [];
    }
  };

  // ── parse Excel / CSV bank statement for transaction IDs ──────────────────
  const parseExcel = async (file: File): Promise<string[]> => {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: "array" });

      const textTokens: string[] = [];
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json<any[]>(sheet, {
          header: 1,
          raw: false,
          defval: "",
        }) as any[][];
        for (const row of rows) {
          for (const cell of row) {
            const s = String(cell ?? "").trim();
            if (s) textTokens.push(s);
          }
        }
      }

      // Join tokens; omit the space when a number is split across cells
      let fullText = textTokens[0] ?? "";
      for (let i = 1; i < textTokens.length; i++) {
        const sep = /\d$/.test(textTokens[i - 1]) && /^\d/.test(textTokens[i]) ? "" : " ";
        fullText += sep + textTokens[i];
      }
      const ids = new Set<string>();

      // ── Pattern 5 ── UPI/CR/TXNID/NAME  (DEP TFR / Canara / SIB)
      const e5 = /UPI\/CR\/(\d{9,15})\//gi;
      // ── Pattern 1 ── UPI/NAME/TXNID/UPI
      const e1 = /UPI\/[^/]+?\/(\d{9,15})\/UPI/gi;
      // ── Pattern 2 ── UPI- or UPI/  (ref-number column)
      const e2 = /UPI[-/](\d{9,15})/gi;
      // ── Pattern 3 ── standalone 12-digit UTR
      const e3 = /\b(\d{12})\b/g;
      // ── Pattern 4 ── UTR: digits
      const e4 = /UTR\s*:?\s*(\d{9,15})/gi;

      for (const pat of [e5, e1, e2, e3, e4]) {
        let m: RegExpExecArray | null;
        while ((m = pat.exec(fullText)) !== null) {
          ids.add(m[1]);
        }
      }

      return Array.from(ids);
    } catch (e: unknown) {
      toast("Excel parse error: " + (e as Error).message, "error");
      return [];
    }
  };

  // ── handle bank statement upload (PDF or Excel) ──────────────────────────
  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPdfFileName(file.name);
    const isExcel = /\.(xlsx|xls|csv)$/i.test(file.name);
    showLoading(isExcel ? "Parsing Excel statement..." : "Parsing PDF statement...");
    const ids = isExcel ? await parseExcel(file) : await parsePdf(file);
    hideLoading();
    if (ids.length === 0) {
      toast(`No transaction IDs found in the uploaded ${isExcel ? "Excel" : "PDF"}`, "error");
      setPdfTxIds(null);
      setPdfTxIdList([]);
      setPdfFileName("");
    } else {
      setPdfTxIds(new Set(ids));
      setPdfTxIdList(ids);
      toast(
        `Found ${ids.length} transaction ID(s) in ${isExcel ? "Excel" : "PDF"} – filtering list`,
        "success",
      );
    }
    // Reset file input so the same file can be re-uploaded
    if (pdfInputRef.current) pdfInputRef.current.value = "";
  };

  // ── select doc ────────────────────────────────────────────────────────────
  const selectDoc = async (id: string, dbParam?: string, colParam?: string) => {
    const dbToUse = dbParam ?? state.db;
    // In "All Events" mode, resolve the real collection from the doc's __col metadata
    const resolvedCol = colParam
      ? colParam
      : (() => {
          if (state.col === "__all__") {
            const found = state.docs.find((d) => String(d._id) === id);
            return found
              ? String((found as any).__col ?? state.col)
              : state.col;
          }
          return state.col;
        })();
    const colToUse = resolvedCol;
    setState((prev) => ({
      ...prev,
      selected: prev.docs.find((d) => String(d._id) === id) ?? null,
    }));
    // Sync URL immediately so refresh/share works
    pushUrl(colToUse, id);
    showLoading("Loading details...");
    try {
      if (isScanner) {
        setState((prev) => ({ ...prev, details: null }));
      } else {
        const { data: rawDoc, fromCache } = await apiWithMeta<Doc>(
          "GET",
          `/databases/${dbToUse}/collections/${colToUse}/documents/${id}`,
        );
        const doc = serialise(rawDoc);
        setDetailSource(fromCache ? "redis" : "db");
        // Preserve __eventName and __col metadata from the list entry (for all-events mode)
        const listEntry = state.docs.find((d) => String(d._id) === id);
        if (listEntry) {
          if ((listEntry as any).__eventName)
            (doc as any).__eventName = (listEntry as any).__eventName;
          if ((listEntry as any).__col)
            (doc as any).__col = (listEntry as any).__col;
        }
        setState((prev) => ({ ...prev, details: doc }));
      }
    } catch (e: unknown) {
      toast((e as Error).message, "error");
    } finally {
      hideLoading();
    }
  };

  // ── helper: resolve the real collection for currently selected doc ─────────
  // In "All Events" mode the true collection is stored in __col on the details doc.
  const effectiveCol = (): string => {
    if (state.col === "__all__" && state.details) {
      const c = (state.details as any).__col;
      if (c) return String(c);
    }
    return state.col;
  };

  // ── approve ───────────────────────────────────────────────────────────────
  const approveDoc = async (id: string) => {
    const col = effectiveCol();
    showLoading("Generating QR & sending email...");
    try {
      await api(
        "POST",
        `/databases/${state.db}/collections/${col}/documents/${id}/approve`,
      );
      toast("Approved! QR sent to attendee.", "success");
      if (state.col !== "__all__") {
        await loadDocs(state.db, col);
        await loadStats(state.db, col);
      } else {
        await loadAllDocs();
      }
      await selectDoc(id);
    } catch (e: unknown) {
      toast((e as Error).message, "error");
    } finally {
      hideLoading();
    }
  };

  // ── reject ────────────────────────────────────────────────────────────────
  const openRejectModal = (id: string) => {
    setState((prev) => ({ ...prev, rejectTargetId: id }));
    setRejectReason("");
    openModal("reject");
  };

  const submitReject = async () => {
    if (!rejectReason.trim()) {
      toast("Please enter a reason", "error");
      return;
    }
    closeModal("reject");
    const col = effectiveCol();
    showLoading("Rejecting & sending email...");
    try {
      await api(
        "POST",
        `/databases/${state.db}/collections/${col}/documents/${state.rejectTargetId}/reject`,
        { reason: rejectReason },
      );
      toast("Rejected. Email sent to attendee.", "info");
      if (state.col !== "__all__") {
        await loadDocs(state.db, col);
        await loadStats(state.db, col);
      } else {
        await loadAllDocs();
      }
      if (state.rejectTargetId) await selectDoc(state.rejectTargetId);
    } catch (e: unknown) {
      toast((e as Error).message, "error");
    } finally {
      hideLoading();
    }
  };

  // ── add / edit ────────────────────────────────────────────────────────────
  const openAddModal = () => {
    setState((prev) => ({ ...prev, editingDoc: null }));
    // Pre-select event when a specific collection is already open
    const preselectedEvent =
      state.col && state.col !== "__all__"
        ? (DISPLAY_NAME_MAP[state.col] ?? "")
        : isRegistrar && assignedEvent && assignedEvent !== "*"
          ? (DISPLAY_NAME_MAP[assignedEvent] ?? "")
          : "";
    setEditFormData({
      firstName: "",
      lastName: "",
      email: "",
      contactNumber: "",
      gender: "",
      paymentMode: "",
      transactionId: "",
      collegeName: "",
      department: "",
      yearOfStudy: "",
      collegeRegisterNumber: "",
      city: "",
      eventName: preselectedEvent,
    });
    openModal("doc");
  };

  const openEditModal = async (id: string) => {
    const col = effectiveCol();
    showLoading("Loading...");
    try {
      const doc = serialise(
        await api<Doc>(
          "GET",
          `/databases/${state.db}/collections/${col}/documents/${id}`,
        ),
      );
      setState((prev) => ({ ...prev, editingDoc: doc }));
      const clean = { ...doc } as Record<string, unknown>;
      delete clean._id;
      Object.keys(clean).forEach((k) => {
        if (isImageKey(k) && isImageVal(clean[k]))
          clean[k] = "[IMAGE DATA PRESERVED]";
      });
      setEditFormData(clean);
      openModal("doc");
    } catch (e: unknown) {
      toast((e as Error).message, "error");
    } finally {
      hideLoading();
    }
  };

  const saveDoc = async () => {
    const data: Record<string, unknown> = { ...editFormData };
    let col = effectiveCol();

    if (state.editingDoc) {
      Object.keys(data).forEach((k) => {
        if (data[k] === "[IMAGE DATA PRESERVED]" && state.editingDoc![k])
          data[k] = state.editingDoc![k];
      });
    } else {
      // For new docs: derive target collection from the chosen event name
      const colFromEvent =
        EVENT_DISPLAY_TO_COLLECTION[String(data.eventName ?? "")];
      if (colFromEvent) col = colFromEvent;
      // Drop transactionId when payment is Cash
      if (data.paymentMode !== "UPI") delete data.transactionId;
      // Validate required fields
      const required = [
        "firstName", "lastName", "email", "contactNumber",
        "gender", "paymentMode", "collegeName", "department",
        "yearOfStudy", "collegeRegisterNumber", "city", "eventName",
      ];
      for (const f of required) {
        if (!String(data[f] ?? "").trim()) {
          toast(`${formatKey(f)} is required`, "error");
          return;
        }
      }
      if (data.paymentMode === "UPI" && !String(data.transactionId ?? "").trim()) {
        toast("Transaction ID is required for UPI payment", "error");
        return;
      }
    }

    closeModal("doc");
    showLoading("Saving...");
    try {
      if (state.editingDoc) {
        await api(
          "PUT",
          `/databases/${state.db}/collections/${col}/documents/${String(state.editingDoc._id)}`,
          data,
        );
        toast("Document updated", "success");
        await selectDoc(String(state.editingDoc._id));
      } else {
        await api(
          "POST",
          `/databases/${state.db}/collections/${col}/documents`,
          data,
        );
        toast("Document created", "success");
      }
      if (state.col !== "__all__") {
        await loadDocs(state.db, col);
        await loadStats(state.db, col);
      } else {
        await loadAllDocs();
      }
    } catch (e: unknown) {
      toast((e as Error).message, "error");
    } finally {
      hideLoading();
    }
  };

  // ── delete ────────────────────────────────────────────────────────────────
  const openDeleteModal = (id: string) => {
    setState((prev) => ({ ...prev, deleteTargetId: id }));
    openModal("delete");
  };

  const confirmDelete = async () => {
    closeModal("delete");
    const col = effectiveCol();
    showLoading("Deleting...");
    try {
      await api(
        "DELETE",
        `/databases/${state.db}/collections/${col}/documents/${state.deleteTargetId}`,
      );
      toast("Document deleted", "info");
      setState((prev) => ({ ...prev, selected: null, details: null }));
      if (state.col !== "__all__") {
        await loadDocs(state.db, col);
        await loadStats(state.db, col);
      } else {
        await loadAllDocs();
      }
    } catch (e: unknown) {
      toast((e as Error).message, "error");
    } finally {
      hideLoading();
    }
  };

  // ── export ────────────────────────────────────────────────────────────────
  const exportExcel = async () => {
    const XLSX = await import("xlsx");
    // "__all__" mode: we already have all docs in state – export them directly
    if (state.col === "__all__") {
      // Always export `filtered` — when no filter is active, filtered === docs;
      // using docs as fallback would silently export everything when the filter returns 0 results
      const docs = state.filtered;
      if (!docs.length) {
        toast("No records to export", "info");
        return;
      }
      const headerRow = EXCEL_EXPORT_COLUMNS.map((col) => col.header);
      const rows = [
        headerRow,
        ...docs.map((d) =>
          EXCEL_EXPORT_COLUMNS.map((col) => getExcelValue(d, col.field)),
        ),
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet(rows),
        "All Events",
      );
      XLSX.writeFile(
        wb,
        `all_events_${new Date().toISOString().split("T")[0]}.xlsx`,
      );
      toast("Exported successfully", "success");
      return;
    }
    // If a specific collection is selected, use fixed column structure
    if (state.col) {
      const docs = state.docs;
      if (!docs.length) {
        toast("No records to export", "info");
        return;
      }
      // Add event name to each doc for consistent export
      const docsWithEvent = docs.map((d) => ({
        ...d,
        __eventName: getEventDisplayName(state.col) || state.col,
      }));
      const headerRow = EXCEL_EXPORT_COLUMNS.map((col) => col.header);
      const rows = [
        headerRow,
        ...docsWithEvent.map((d) =>
          EXCEL_EXPORT_COLUMNS.map((col) => getExcelValue(d, col.field)),
        ),
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet(rows),
        state.col.substring(0, 31),
      );
      XLSX.writeFile(
        wb,
        `${state.col}_${new Date().toISOString().split("T")[0]}.xlsx`,
      );
      toast("Exported successfully", "success");
      return;
    }

    // No collection selected: fetch all allowed collections and merge into one sheet
    try {
      const allDocs: Doc[] = [];
      for (const col of ALLOWED_COLLECTIONS) {
        try {
          const docs = (
            await api<Doc[]>(
              "GET",
              `/databases/${state.db}/collections/${col}/documents`,
            )
          ).map(serialise);
          // attach event/collection display name to each row for later
          const eventName = getEventDisplayName(col) || col;
          docs.forEach((d) => {
            (d as any).__eventName = eventName;
            allDocs.push(d);
          });
        } catch (e: unknown) {
          // skip collections we cannot fetch, but notify the user
          toast(`Could not fetch ${col}: ${(e as Error).message}`, "error");
        }
      }
      if (!allDocs.length) {
        toast("No records to export", "info");
        return;
      }

      // Use fixed column structure for consistent export
      const headerRow = EXCEL_EXPORT_COLUMNS.map((col) => col.header);

      const rows = [
        headerRow,
        ...allDocs.map((d) =>
          EXCEL_EXPORT_COLUMNS.map((col) => getExcelValue(d, col.field)),
        ),
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet(rows),
        "Registrations",
      );
      XLSX.writeFile(
        wb,
        `all_events_${new Date().toISOString().split("T")[0]}.xlsx`,
      );
      toast("Exported successfully", "success");
    } catch (e: unknown) {
      toast((e as Error).message, "error");
    }
  };

  // ── auto refresh ──────────────────────────────────────────────────────────
  const startAutoRefresh = (db: string, col: string) => {
    // Do not start auto-refresh for scanner role
    if (isScanner) return;
    // ensure any previous interval is cleared
    if (autoRefreshRef.current) {
      clearInterval(autoRefreshRef.current);
      autoRefreshRef.current = null;
    }
    autoRefreshRef.current = setInterval(async () => {
      if (!db || !col) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      try {
        const [docsRes, statsRes] = await Promise.all([
          apiWithMeta<Doc[]>(
            "GET",
            `/databases/${db}/collections/${col}/documents`,
          ),
          api<Stats>("GET", `/databases/${db}/collections/${col}/stats`).catch(() => null),
        ]);
        const docs = docsRes.data.map(serialise);
        setDocsSource(docsRes.fromCache ? "redis" : "db");
        setState((prev) => {
          if (
            JSON.stringify(docs.map((d) => d._id)) !==
            JSON.stringify(prev.docs.map((d) => d._id))
          ) {
            return {
              ...prev,
              docs,
              filtered: applyFilter(docs, searchQ, filterStatus),
            };
          }
          return prev;
        });
        if (statsRes) setStats(statsRes);
      } catch {
        /* silent */
      }
    }, 30000);
  };

  const stopAutoRefresh = () => {
    if (autoRefreshRef.current) {
      clearInterval(autoRefreshRef.current);
      autoRefreshRef.current = null;
    }
  };

  useEffect(() => {
    return () => stopAutoRefresh();
  }, []);

  const colHasData = !!state.col && state.docs.length > 0;
  // Export is enabled when __all__ has data, specific col has data, or cols list is non-empty
  const exportDisabled =
    state.col === "__all__"
      ? state.docs.length === 0
      : state.col
        ? !colHasData
        : !(cols && cols.length > 0);

  const allowedTabs = (() => {
    if (isScanner) return ["scanner"] as const;
    if (isViewer || isRegistrar) return ["records"] as const;
    return ["records", "scanner"] as const;
  })();

  // ── render ────────────────────────────────────────────────────────────────
  // Results list component (rendered in sidebar on desktop, in main on mobile)
  const ResultsList = ({
    inlineExpand = false,
  }: {
    inlineExpand?: boolean;
  }) => (
    <ul className="list">
      {state.filtered.length === 0 ? (
        <li className="empty">
          <i className="fas fa-inbox" />
          <br />
          {state.col ? "No records found" : "Select a collection"}
        </li>
      ) : (
        state.filtered.map((doc) => {
          const name = getDocName(doc);
          const email = getDocEmail(doc);
          const regId = String(
            doc.registrationId ?? doc.regId ?? doc.registerNumber ?? "",
          );
          const docStatus = getDocStatus(doc);
          const isActive = String(state.selected?._id) === String(doc._id);
          const eventName = (doc as any).__eventName as string | undefined;
          const txId = String(
            doc.transactionId ??
              doc.transaction_id ??
              doc.utr ??
              doc.upiTransactionId ??
              doc.paymentId ??
              doc.txnId ??
              "",
          );
          const docCol =
            state.col === "__all__"
              ? String((doc as any).__col ?? "")
              : undefined;

          // PDF match status – only computed when a PDF has been uploaded
          const pdfActive = !!pdfTxIds && pdfTxIds.size > 0;
          const hasMatch = pdfActive && docMatchesPdf(doc, pdfTxIds);

          return (
            <Fragment key={String(doc._id)}>
              <li
                className={`list-item${isActive ? " active" : ""}`}
                onClick={() => {
                  const clickedId = String(doc._id);
                  if (isActive) {
                    setState((prev) => ({
                      ...prev,
                      selected: null,
                      details: null,
                    }));
                    pushUrl(state.col, null);
                  } else {
                    selectDoc(clickedId, undefined, docCol);
                  }
                }}
              >
                <div className="list-item-name">{name}</div>
                {email && <div className="list-item-sub">{email}</div>}
                {eventName && (
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--accent)",
                      marginTop: 2,
                    }}
                  >
                    <i
                      className="fas fa-calendar-alt"
                      style={{ marginRight: 4 }}
                    />
                    {eventName}
                  </div>
                )}
                {txId && (
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--muted)",
                      marginTop: 2,
                    }}
                  >
                    <i className="fas fa-receipt" style={{ marginRight: 4 }} />
                    {txId}
                  </div>
                )}
                {/* PDF match badge – shown on every attendee when a PDF is active */}
                {pdfActive && (
                  <div
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      marginTop: 4,
                      fontSize: 11,
                      fontWeight: 600,
                      padding: "2px 8px",
                      borderRadius: 20,
                      background: hasMatch ? "var(--green)22" : "var(--red)18",
                      color: hasMatch ? "var(--green)" : "var(--red)",
                      border: `1px solid ${hasMatch ? "var(--green)55" : "var(--red)44"}`,
                    }}
                  >
                    <i
                      className={`fas fa-${hasMatch ? "check-circle" : "times-circle"}`}
                    />
                    {hasMatch ? "ID Match" : "No ID Found"}
                  </div>
                )}
                <div className="list-item-meta">
                  {regId ? (
                    <span style={{ fontSize: 11, color: "var(--muted)" }}>
                      #{regId.substring(0, 10)}
                    </span>
                  ) : (
                    <span />
                  )}
                  <StatusPill status={docStatus} />
                </div>
              </li>
              {/* Inline accordion expansion – only for mobile (inlineExpand mode) */}
              {inlineExpand && isActive && state.details && (
                <li
                  key={`${String(doc._id)}-detail`}
                  style={{ listStyle: "none", padding: 0 }}
                >
                  <DocDetail
                    doc={state.details}
                    onApprove={approveDoc}
                    onOpenReject={openRejectModal}
                    onEdit={openEditModal}
                    onDelete={openDeleteModal}
                    onResend={async (id: string) => {
                      const col = effectiveCol();
                      showLoading("Resending email...");
                      try {
                        await api(
                          "POST",
                          `/databases/${state.db}/collections/${col}/documents/${id}/resend`,
                        );
                        toast("Email resent to attendee.", "success");
                        if (state.col !== "__all__")
                          await loadDocs(state.db, col);
                        else await loadAllDocs();
                        await selectDoc(id);
                      } catch (e: unknown) {
                        toast((e as Error).message, "error");
                      } finally {
                        hideLoading();
                      }
                    }}
                    isAdmin={isAdmin}
                    cacheSource={detailSource}
                  />
                </li>
              )}
            </Fragment>
          );
        })
      )}
    </ul>
  );

  return (
    <>
      <LoadingOverlay show={loading} text={loadingText} />
      <Toasts toasts={toasts} />

      {/* HEADER */}
      <header className="header">
        <div className="logo">
          <div className="logo-icon">
            <i className="fas fa-bolt" />
          </div>
          <span className="logo-text">EventManager Pro</span>
        </div>
        {isAdmin ? (
          <div className="header-selects">
            <div
              style={{
                padding: "8px 12px",
                borderRadius: 6,
                background: "var(--card)",
                fontSize: 13,
              }}
            >
              Database: <strong style={{ marginLeft: 6 }}>test</strong>
            </div>
            <select
              value={state.col}
              onChange={(e) => onColChange(e.target.value)}
              disabled={!state.db}
            >
              <option value="">Select Event</option>
              <option value="__all__">All Events</option>
              {cols.map((c) => (
                <option key={c} value={c}>
                  {getEventDisplayName(c)}
                </option>
              ))}
            </select>
          </div>
        ) : isRegistrar ? (
          <div className="header-selects">
            <div
              style={{
                padding: "8px 12px",
                borderRadius: 6,
                background: "var(--card)",
                fontSize: 13,
              }}
            >
              Database: <strong style={{ marginLeft: 6 }}>test</strong>
            </div>
            {assignedEvent === "*" ? (
              <select
                value={state.col}
                onChange={(e) =>
                  setState((s) => ({ ...s, col: e.target.value }))
                }
              >
                <option value="">Select Event</option>
                {EVENT_OPTIONS.map((ev) => (
                  <option
                    key={ev}
                    value={EVENT_DISPLAY_TO_COLLECTION[ev] ?? ev}
                  >
                    {ev}
                  </option>
                ))}
              </select>
            ) : (
              <div
                style={{
                  padding: "8px 12px",
                  borderRadius: 6,
                  background: "var(--card)",
                  fontSize: 13,
                }}
              >
                Event:{" "}
                <strong style={{ marginLeft: 6 }}>
                  {assignedEvent ? getEventDisplayName(assignedEvent) : "—"}
                </strong>
              </div>
            )}
          </div>
        ) : isViewer ? (
          <div className="header-selects">
            <div
              style={{
                padding: "8px 12px",
                borderRadius: 6,
                background: "var(--card)",
                fontSize: 13,
              }}
            >
              Database: <strong style={{ marginLeft: 6 }}>test</strong>
            </div>
            {assignedEvent === "*" ? (
              <select
                value={state.col}
                onChange={(e) => onColChange(e.target.value)}
                disabled={!cols.length}
              >
                <option value="">Select Event</option>
                <option value="__all__">All Events</option>
                {cols.map((c) => (
                  <option key={c} value={c}>
                    {getEventDisplayName(c)}
                  </option>
                ))}
              </select>
            ) : (
              <div
                style={{
                  padding: "8px 12px",
                  borderRadius: 6,
                  background: "var(--card)",
                  fontSize: 13,
                }}
              >
                Event:{" "}
                <strong style={{ marginLeft: 6 }}>
                  {assignedEvent ? getEventDisplayName(assignedEvent) : "—"}
                </strong>
              </div>
            )}
          </div>
        ) : null}
        <style>{`
          .desktop-only { display: block; }
          .mobile-only { display: none; }
          @media (max-width: 768px) {
            .desktop-only { display: none !important; }
            .mobile-only { display: block !important; }
          }

          /* Stats grid responsive behavior: auto-fit on desktop, single column on mobile */
          .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; align-items: stretch; }
          .stats-grid .stat-card { padding: 12px; border-radius: 8px; background: var(--card); box-shadow: none; width: 100%; box-sizing: border-box; }
          @media (max-width: 768px) {
            /* Mobile: first card full width, remaining 4 cards in a single row */
            .stats-grid { grid-template-columns: repeat(4, 1fr) !important; gap: 10px; }
            .stats-grid .stat-card { width: 100% !important; }
            .stats-grid .stat-card:first-child { grid-column: 1 / -1; justify-self: center; }
            /* ensure the remaining cards shrink if needed to avoid overflow */
            .stats-grid .stat-card { min-width: 0; }
          }

          /* Ensure lists don't overflow on mobile */
          .list { margin: 0; padding: 0; list-style: none; }
          .list .list-item { box-sizing: border-box; }
        `}</style>
        <div className="header-right">
          {isViewer && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={exportExcel}
              disabled={exportDisabled}
            >
              <i className="fas fa-download" /> Export
            </button>
          )}
          {isRegistrar && (
            <button
              className="btn btn-primary btn-sm"
              onClick={openAddModal}
            >
              <i className="fas fa-plus" /> Add Participant
            </button>
          )}
          {isAdmin && (
            <>
              <button
                className="btn btn-ghost btn-sm"
                onClick={exportExcel}
                disabled={exportDisabled}
              >
                <i className="fas fa-download" /> Export
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={openAddModal}
              >
                <i className="fas fa-plus" /> Add
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={openUsersModal}
                style={{ marginLeft: 8 }}
              >
                <i className="fas fa-users-cog" /> Users
              </button>
            </>
          )}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              color: "var(--muted)",
            }}
          >
            <div
              className={`status-dot ${connected ? "connected" : "disconnected"}`}
            />
            <span>{connected ? "Connected" : "Disconnected"}</span>
          </div>
          <button
            className="btn btn-ghost btn-sm"
            onClick={logout}
            style={{ marginLeft: 8 }}
          >
            <i className="fas fa-sign-out-alt" /> Logout
          </button>
        </div>
      </header>

      {/* NAV TABS */}
      <nav className="nav-tabs">
        {allowedTabs.map((tab) => (
          <button
            key={tab}
            className={`nav-tab${activeTab === tab ? " active" : ""}`}
            onClick={() => setActiveTab(tab)}
          >
            <i className={`fas fa-${tab === "records" ? "table" : "qrcode"}`} />
            {tab === "records" ? "Records" : "QR Scanner"}
          </button>
        ))}
      </nav>

      {/* MAIN */}
      <div className={`main main--${activeTab}`}>
        {/* Desktop inline sidebar content (no drawer) */}
        {!isScanner && !isRegistrar && (
          <div
            className="sidebar-inline desktop-only"
            style={{
              width: 320,
              flexShrink: 0,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              minHeight: 0,
              borderRight: "1px solid var(--border)",
              background: "var(--surface)",
            }}
          >
            <div className="sidebar-head">
              <span className="sidebar-title">
                {state.col === "__all__"
                  ? "⚡ All Events"
                  : state.col
                    ? getEventDisplayName(state.col)
                    : "All Records"}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <CachePill source={docsSource} />
                <span className="badge">{state.filtered.length}</span>
                {isAdmin && state.col && (
                  <>
                    <button
                      className="btn btn-primary btn-sm"
                      style={{ padding: "2px 8px", fontSize: 11 }}
                      onClick={openAddModal}
                      title="Add Participant"
                    >
                      <i className="fas fa-plus" /> Add
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ padding: "2px 8px", fontSize: 11 }}
                      onClick={openUsersModal}
                      title="Manage Users"
                    >
                      <i className="fas fa-users-cog" />
                    </button>
                  </>
                )}
              </div>
            </div>
            <div
              style={{
                padding: 12,
                borderBottom: "1px solid var(--border)",
                display: "flex",
                gap: 6,
              }}
            >
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 12,
                  padding: "6px 10px",
                }}
              >
                <option value="">All Status</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option value="checked_in">Checked In</option>
              </select>
            </div>
            {/* Search – includes transaction ID matching */}
            <div className="search-wrap">
              <input
                type="text"
                placeholder="🔍 Search name, email or transaction ID..."
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
              />
            </div>
            {/* PDF bank-statement filter – admin only */}
            {isAdmin && (
              <div
                style={{
                  padding: "8px 12px",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <input
                  ref={pdfInputRef}
                  type="file"
                  accept=".pdf,.xlsx,.xls,.csv"
                  style={{ display: "none" }}
                  onChange={handlePdfUpload}
                />
                {pdfTxIds ? (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 12,
                      background: "var(--accent)18",
                      border: "1px solid var(--accent)44",
                      borderRadius: 8,
                      padding: "6px 10px",
                    }}
                  >
                    <i
                      className="fas fa-file-invoice"
                      style={{ color: "var(--accent)" }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          color: "var(--accent)",
                          fontWeight: 600,
                          fontSize: 11,
                        }}
                      >
                        {
                          state.filtered.filter((d) =>
                            docMatchesPdf(d, pdfTxIds),
                          ).length
                        }
                        {" / "}
                        {state.filtered.length} attendees matched
                      </div>
                      <div
                        style={{
                          color: "var(--muted)",
                          fontSize: 10,
                          marginTop: 1,
                        }}
                      >
                        {pdfTxIds?.size ?? 0} transaction ID(s) from statement
                      </div>
                    </div>
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ padding: "2px 6px", fontSize: 10 }}
                      onClick={() => setShowPdfIds(true)}
                      title="View extracted IDs"
                    >
                      <i className="fas fa-list" />
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ padding: "2px 6px", fontSize: 10 }}
                      onClick={() => {
                        setPdfTxIds(null);
                        setPdfFileName("");
                        setPdfTxIdList([]);
                      }}
                      title="Clear filter"
                    >
                      <i className="fas fa-times" />
                    </button>
                  </div>
                ) : (
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ width: "100%", fontSize: 12 }}
                    onClick={() => pdfInputRef.current?.click()}
                  >
                    <i
                      className="fas fa-file-invoice"
                      style={{ color: "var(--accent)", marginRight: 6 }}
                    />
                    Upload Bank Statement
                  </button>
                )}
              </div>
            )}
            <ResultsList />
          </div>
        )}

        {/* ── RECORDS PANEL ── */}
        <div
          className={`panel${activeTab === "records" ? " active" : ""}`}
          id="panel-records"
        >
          <div className="content">
            {stats && <StatsGrid stats={stats} />}
            {/* Registrar: only show a simple add-participant prompt */}
            {isRegistrar && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  minHeight: 320,
                  gap: 16,
                  textAlign: "center",
                  padding: 32,
                }}
              >
                <div
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: "50%",
                    background: "var(--accent)18",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 28,
                    color: "var(--accent)",
                  }}
                >
                  <i className="fas fa-user-plus" />
                </div>
                <h3 style={{ margin: 0, fontWeight: 700 }}>Register Participant</h3>
                <p style={{ margin: 0, color: "var(--muted)", fontSize: 14, maxWidth: 320 }}>
                  {assignedEvent && assignedEvent !== "*"
                    ? `You are authorised to add participants for: ${getEventDisplayName(assignedEvent)}`
                    : "Select an event from the header, then click Add Participant."}
                </p>
                <button
                  className="btn btn-primary"
                  onClick={openAddModal}
                >
                  <i className="fas fa-plus" /> Add Participant
                </button>
              </div>
            )}
            {/* Mobile: place filters below stats and results below filters */}
            {(isAdmin || isViewer) && (
              <div className="mobile-only" style={{ padding: "12px 0" }}>
                <div style={{ marginBottom: 8 }}>
                  <select
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
                    style={{
                      width: "100%",
                      fontSize: 12,
                      padding: "8px 10px",
                      borderRadius: 6,
                    }}
                  >
                    <option value="">All Status</option>
                    <option value="pending">Pending</option>
                    <option value="approved">Approved</option>
                    <option value="rejected">Rejected</option>
                    <option value="checked_in">Checked In</option>
                  </select>
                </div>
                <div>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="🔍 Search name, email or transaction ID..."
                    value={searchQ}
                    onChange={(e) => setSearchQ(e.target.value)}
                  />
                </div>
                {/* Mobile Add / Users buttons for admin */}
                {isAdmin && state.col && (
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button
                      className="btn btn-primary btn-sm"
                      style={{ flex: 1, fontSize: 12 }}
                      onClick={openAddModal}
                    >
                      <i className="fas fa-plus" /> Add Participant
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ fontSize: 12 }}
                      onClick={openUsersModal}
                    >
                      <i className="fas fa-users-cog" /> Users
                    </button>
                  </div>
                )}
                {/* Mobile PDF filter */}
                <div style={{ marginTop: 8 }}>
                  {pdfTxIds ? (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 12,
                        background: "var(--accent)18",
                        border: "1px solid var(--accent)44",
                        borderRadius: 8,
                        padding: "6px 10px",
                      }}
                    >
                      <i
                        className="fas fa-file-invoice"
                        style={{ color: "var(--accent)" }}
                      />
                      <span
                        style={{
                          flex: 1,
                          color: "var(--accent)",
                          fontWeight: 600,
                        }}
                      >
                        Statement: {pdfTxIds.size} ID(s) matched
                      </span>
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ padding: "2px 8px", fontSize: 11 }}
                        onClick={() => {
                          setPdfTxIds(null);
                          setPdfFileName("");
                          setPdfTxIdList([]);
                        }}
                      >
                        <i className="fas fa-times" /> Clear
                      </button>
                    </div>
                  ) : (
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ width: "100%", fontSize: 12 }}
                      onClick={() => pdfInputRef.current?.click()}
                    >
                      <i
                        className="fas fa-file-invoice"
                        style={{ color: "var(--accent)", marginRight: 6 }}
                      />
                      Upload Bank Statement
                    </button>
                  )}
                </div>
              </div>
            )}
            <div className="mobile-only" style={{ paddingTop: 12 }}>
              <ResultsList inlineExpand={true} />
            </div>
            {/* Desktop: detail panel shown alongside sidebar (hidden on mobile via CSS) */}
            <div className="desktop-only">
              {state.details ? (
                <DocDetail
                  doc={state.details}
                  onApprove={approveDoc}
                  onOpenReject={openRejectModal}
                  onEdit={openEditModal}
                  onDelete={openDeleteModal}
                  onResend={async (id: string) => {
                    const col = effectiveCol();
                    showLoading("Resending email...");
                    try {
                      await api(
                        "POST",
                        `/databases/${state.db}/collections/${col}/documents/${id}/resend`,
                      );
                      toast("Email resent to attendee.", "success");
                      if (state.col !== "__all__")
                        await loadDocs(state.db, col);
                      else await loadAllDocs();
                      await selectDoc(id);
                    } catch (e: unknown) {
                      toast((e as Error).message, "error");
                    } finally {
                      hideLoading();
                    }
                  }}
                  isAdmin={isAdmin}
                  cacheSource={detailSource}
                />
              ) : !state.col ? (
                <div className="placeholder">
                  <div className="placeholder-icon">
                    <i className="fas fa-database" />
                  </div>
                  <h3>
                    {state.col === "__all__"
                      ? "Showing all events"
                      : "Select a collection to begin"}
                  </h3>
                  <p style={{ fontSize: 14, marginTop: 8 }}>
                    {state.col === "__all__"
                      ? "All event attendees are listed below. Use search or upload a PDF to filter by transaction ID."
                      : "Choose a database and collection from the header"}
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {/* ── SCANNER PANEL ── */}
        <div
          className={`panel${activeTab === "scanner" ? " active" : ""}`}
          id="panel-scanner"
        >
          {activeTab === "scanner" && <ScannerPanel onToast={toast} />}
        </div>
      </div>

      {/* ── REJECT MODAL ── */}
      {modals.reject && (
        <div className="modal-overlay open">
          <div className="modal">
            <div className="modal-title">
              <i
                className="fas fa-times-circle"
                style={{ color: "var(--red)" }}
              />{" "}
              Reject Attendee
            </div>
            <p
              style={{ color: "var(--muted)", fontSize: 14, marginBottom: 20 }}
            >
              Please provide a reason for rejection. This will be emailed to the
              attendee.
            </p>
            <div className="form-group">
              <label className="form-label">Reason for Rejection *</label>
              <textarea
                className="form-input"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="e.g. Registration incomplete, missing documents, event capacity reached..."
              />
            </div>
            <div className="modal-actions">
              <button
                className="btn btn-ghost"
                onClick={() => closeModal("reject")}
              >
                Cancel
              </button>
              <button className="btn btn-danger" onClick={submitReject}>
                <i className="fas fa-times" /> Reject &amp; Notify
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── ADD/EDIT DOC MODAL ── */}
      {modals.doc && (
        <div className="modal-overlay open">
          <div className="modal" style={{ minWidth: 640, maxWidth: "95vw" }}>
            <div className="modal-title">
              <i
                className={`fas fa-${state.editingDoc ? "edit" : "plus"}`}
                style={{ color: "var(--accent)" }}
              />
              {state.editingDoc ? " Edit Participant" : " Add Participant"}
            </div>
            <p
              style={{ color: "var(--muted)", fontSize: 13, marginBottom: 16 }}
            >
              {state.editingDoc
                ? "Update participant details. Fields marked [IMAGE DATA PRESERVED] cannot be edited here."
                : "Fields marked * are required."}
            </p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
                gap: 16,
                maxHeight: "65vh",
                overflowY: "auto",
                paddingRight: 8,
              }}
            >
              {!state.editingDoc ? (
                /* ── Structured Add form ── */
                <>
                  {/* Event Name */}
                  <div className="form-group" style={{ marginBottom: 0, gridColumn: "1 / -1" }}>
                    <label className="form-label">Event Name *</label>
                    <select
                      className="form-input"
                      value={String(editFormData.eventName ?? "")}
                      disabled={
                        isRegistrar &&
                        !!assignedEvent &&
                        assignedEvent !== "*"
                      }
                      onChange={(e) =>
                        setEditFormData((prev) => ({ ...prev, eventName: e.target.value }))
                      }
                    >
                      <option value="">— Select Event —</option>
                      {EVENT_OPTIONS.map((ev) => (
                        <option key={ev} value={ev}>{ev}</option>
                      ))}
                    </select>
                  </div>

                  {/* First Name */}
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">First Name *</label>
                    <input
                      type="text"
                      className="form-input"
                      value={String(editFormData.firstName ?? "")}
                      onChange={(e) =>
                        setEditFormData((prev) => ({ ...prev, firstName: e.target.value }))
                      }
                    />
                  </div>

                  {/* Last Name */}
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Last Name *</label>
                    <input
                      type="text"
                      className="form-input"
                      value={String(editFormData.lastName ?? "")}
                      onChange={(e) =>
                        setEditFormData((prev) => ({ ...prev, lastName: e.target.value }))
                      }
                    />
                  </div>

                  {/* Email */}
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Email *</label>
                    <input
                      type="email"
                      className="form-input"
                      value={String(editFormData.email ?? "")}
                      onChange={(e) =>
                        setEditFormData((prev) => ({ ...prev, email: e.target.value }))
                      }
                    />
                  </div>

                  {/* Contact Number */}
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Contact Number *</label>
                    <input
                      type="tel"
                      className="form-input"
                      value={String(editFormData.contactNumber ?? "")}
                      onChange={(e) =>
                        setEditFormData((prev) => ({ ...prev, contactNumber: e.target.value }))
                      }
                    />
                  </div>

                  {/* Gender */}
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Gender *</label>
                    <select
                      className="form-input"
                      value={String(editFormData.gender ?? "")}
                      onChange={(e) =>
                        setEditFormData((prev) => ({ ...prev, gender: e.target.value }))
                      }
                    >
                      <option value="">— Select —</option>
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>

                  {/* Payment Mode */}
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Payment Mode *</label>
                    <select
                      className="form-input"
                      value={String(editFormData.paymentMode ?? "")}
                      onChange={(e) =>
                        setEditFormData((prev) => ({
                          ...prev,
                          paymentMode: e.target.value,
                          transactionId: e.target.value === "Cash" ? "" : prev.transactionId,
                        }))
                      }
                    >
                      <option value="">— Select —</option>
                      <option value="UPI">UPI</option>
                      <option value="Cash">Cash</option>
                    </select>
                  </div>

                  {/* Transaction ID – only for UPI */}
                  {editFormData.paymentMode === "UPI" && (
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">Transaction ID (UPI) *</label>
                      <input
                        type="text"
                        className="form-input"
                        value={String(editFormData.transactionId ?? "")}
                        onChange={(e) =>
                          setEditFormData((prev) => ({ ...prev, transactionId: e.target.value }))
                        }
                      />
                    </div>
                  )}

                  {/* College Name */}
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">College Name *</label>
                    <input
                      type="text"
                      className="form-input"
                      value={String(editFormData.collegeName ?? "")}
                      onChange={(e) =>
                        setEditFormData((prev) => ({ ...prev, collegeName: e.target.value }))
                      }
                    />
                  </div>

                  {/* Department */}
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Department *</label>
                    <input
                      type="text"
                      className="form-input"
                      value={String(editFormData.department ?? "")}
                      onChange={(e) =>
                        setEditFormData((prev) => ({ ...prev, department: e.target.value }))
                      }
                    />
                  </div>

                  {/* Year of Study */}
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Year of Study *</label>
                    <select
                      className="form-input"
                      value={String(editFormData.yearOfStudy ?? "")}
                      onChange={(e) =>
                        setEditFormData((prev) => ({ ...prev, yearOfStudy: e.target.value }))
                      }
                    >
                      <option value="">— Select —</option>
                      <option value="1st Year">1st Year</option>
                      <option value="2nd Year">2nd Year</option>
                      <option value="3rd Year">3rd Year</option>
                      <option value="4th Year">4th Year</option>
                    </select>
                  </div>

                  {/* College Register Number */}
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">College Register Number *</label>
                    <input
                      type="text"
                      className="form-input"
                      value={String(editFormData.collegeRegisterNumber ?? "")}
                      onChange={(e) =>
                        setEditFormData((prev) => ({
                          ...prev,
                          collegeRegisterNumber: e.target.value,
                        }))
                      }
                    />
                  </div>

                  {/* City */}
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">City *</label>
                    <input
                      type="text"
                      className="form-input"
                      value={String(editFormData.city ?? "")}
                      onChange={(e) =>
                        setEditFormData((prev) => ({ ...prev, city: e.target.value }))
                      }
                    />
                  </div>
                </>
              ) : (
                /* ── Generic Edit form ── */
                Object.entries(editFormData).map(([key, val]) => (
                  <div
                    key={key}
                    className="form-group"
                    style={{ marginBottom: 0 }}
                  >
                    <label
                      className="form-label"
                      style={{ textTransform: "capitalize" }}
                    >
                      {formatKey(key)}
                    </label>
                    <input
                      type={typeof val === "number" ? "number" : "text"}
                      className="form-input"
                      value={val === null || val === undefined ? "" : String(val)}
                      onChange={(e) => {
                        const v = e.target.value;
                        setEditFormData((prev) => ({
                          ...prev,
                          [key]: typeof val === "number" ? Number(v) : v,
                        }));
                      }}
                      disabled={val === "[IMAGE DATA PRESERVED]"}
                    />
                  </div>
                ))
              )}
            </div>
            <div className="modal-actions" style={{ marginTop: 24 }}>
              <button
                className="btn btn-ghost"
                onClick={() => closeModal("doc")}
              >
                Cancel
              </button>
              <button className="btn btn-primary" onClick={saveDoc}>
                <i className="fas fa-save" /> {state.editingDoc ? "Save" : "Add"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── DELETE CONFIRM ── */}
      {modals.delete && (
        <div className="modal-overlay open">
          <div className="modal">
            <div className="modal-title">
              <i className="fas fa-trash" style={{ color: "var(--red)" }} />{" "}
              Confirm Delete
            </div>
            <p style={{ color: "var(--muted)", fontSize: 14 }}>
              Are you sure you want to delete this record? This cannot be
              undone.
            </p>
            <div className="modal-actions">
              <button
                className="btn btn-ghost"
                onClick={() => closeModal("delete")}
              >
                Cancel
              </button>
              <button className="btn btn-danger" onClick={confirmDelete}>
                <i className="fas fa-trash" /> Delete
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Users are managed on a dedicated page: /admin/manage-users */}

      {/* ── PDF Extracted IDs Modal ── */}
      {showPdfIds && (
        <div className="modal-overlay open">
          <div className="modal" style={{ minWidth: 420, maxWidth: "90vw" }}>
            <div className="modal-title">
              <i className="fas fa-file-pdf" style={{ color: "var(--red)" }} />{" "}
              Extracted Transaction IDs from PDF
            </div>
            <p
              style={{ color: "var(--muted)", fontSize: 13, marginBottom: 12 }}
            >
              {pdfTxIdList.length} transaction ID(s) found in &quot;
              {pdfFileName}&quot;. Attendees whose records contain any of these
              IDs are shown in the list.
            </p>
            <div
              style={{
                maxHeight: 320,
                overflowY: "auto",
                background: "var(--bg)",
                borderRadius: 8,
                padding: 12,
                fontFamily: "monospace",
                fontSize: 13,
              }}
            >
              {pdfTxIdList.map((id, i) => {
                const matchCount = state.docs.filter((d) => {
                  const allVals = Object.values(d).map((v) =>
                    String(v ?? "").toLowerCase(),
                  );
                  return allVals.some((f) => f.includes(id.toLowerCase()));
                }).length;
                return (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "4px 0",
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    <span style={{ color: "var(--accent)" }}>{id}</span>
                    <span
                      style={{
                        fontSize: 11,
                        color: matchCount > 0 ? "var(--green)" : "var(--muted)",
                        fontFamily: "sans-serif",
                      }}
                    >
                      {matchCount > 0
                        ? `✓ ${matchCount} match${matchCount > 1 ? "es" : ""}`
                        : "no match"}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="modal-actions" style={{ marginTop: 16 }}>
              <button
                className="btn btn-ghost"
                onClick={() => setShowPdfIds(false)}
              >
                Close
              </button>
              <button
                className="btn btn-danger btn-sm"
                onClick={() => {
                  setPdfTxIds(null);
                  setPdfFileName("");
                  setPdfTxIdList([]);
                  setShowPdfIds(false);
                }}
              >
                <i className="fas fa-times" /> Clear Filter
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
