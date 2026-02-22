"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { getEventDisplayName } from "@/lib/events";
import { ALLOWED_COLLECTIONS } from "@/lib/registrationCollections";
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
  /screenshot|image|photo|picture|img|payment|receipt|signature|avatar|profile/i.test(
    k,
  );

const getDocStatus = (doc: Doc): string =>
  doc.checkedIn ? "checked_in" : String(doc.status ?? "pending");

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

// ── DocDetail ─────────────────────────────────────────────────────────────────
function DocDetail({
  doc,
  onApprove,
  onOpenReject,
  onEdit,
  onDelete,
  onResend,
  isAdmin,
}: {
  doc: Doc;
  onApprove: (id: string) => void;
  onOpenReject: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onResend?: (id: string) => void;
  isAdmin?: boolean;
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
            <div className="detail-name">{name}</div>
            <div style={{ marginTop: 4 }}>
              <StatusPill status={status} />
            </div>
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
                    {formatDateTime(
                      doc.checkInTime as string | number | Date | null,
                    )}
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
        await inst.stop().catch((err: unknown) => {
          console.warn("scanner stop error", err);
        });
        try {
          await inst.clear().catch(() => {});
        } catch {}
        scannerRef.current = null;
      }
    } catch (err) {
      console.warn("stopScanner error", err);
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
      } catch (e) {
        console.warn("getCameras failed, falling back to facingMode", e);
      }

      const onDecode = async (decoded: string, result?: unknown) => {
        // Ignore rapid duplicate callbacks while a scan is already processing
        if (processingRef.current) return;
        processingRef.current = true;
        try {
          console.log("qr decoded:", decoded);
          // Process but keep camera running
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

      const onError = (err: unknown) => {
        // decode attempt failed for a frame - not fatal
        // keep quiet in production but log for debugging
        // console.debug('qr decode fail', err);
      };

      const config = { fps: 10, qrbox: { width: 250, height: 250 } } as any;
      // Start scanner
      await scanner.start(cameraIdOrConfig, config, onDecode, onError);
      console.log("scanner started", cameraIdOrConfig, config);
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
          <div className={`checkin-status ${alreadyIn ? "in" : "out"}`}>
            <i className={`fas fa-${alreadyIn ? "check-circle" : "clock"}`} />
            {alreadyIn
              ? `Already Checked In at ${formatDateTime(doc.checkInTime as string | number | Date | null)}`
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
  const [searchQ, setSearchQ] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
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

  // Centralized persistence key and helpers (sessionStorage)
  const PERSIST_KEY = "dashboard:state";
  type PersistState = {
    collectionName?: string;
    selectedStatus?: string;
    selectedParticipantId?: string | null;
  };
  const readPersist = (): PersistState | null => {
    if (typeof window === "undefined") return null;
    try {
      const s = sessionStorage.getItem(PERSIST_KEY);
      return s ? (JSON.parse(s) as PersistState) : null;
    } catch {
      return null;
    }
  };
  const writePersist = (p: PersistState) => {
    if (typeof window === "undefined") return;
    try {
      sessionStorage.setItem(PERSIST_KEY, JSON.stringify(p));
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
      const id = Date.now();
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
      }
    } catch {
      /* ignore */
    }
    try {
      clearPersist();
    } catch {}
    router.push("/login");
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
        // Load DBs / assigned event
        if (role === "ADMIN") {
          await onDbChange("test");
        } else if (role === "ATTENDEE_VIEWER") {
          // attendee viewers are bound to a single assignedEvent
          await onDbChange("test");
          if (assigned) {
            // automatically select assigned event
            await onColChange(assigned, "test");
            setState((s) => ({ ...s, col: assigned }));
          }
        } else if (role === "SCANNER") {
          // scanners should not call the collections listing endpoint or fetch docs/stats
          if (assigned) {
            // directly select assigned event but do not call onColChange to avoid 403 on protected endpoints
            setState((s) => ({ ...s, col: assigned }));
          }
          // ensure any existing auto-refresh is stopped for scanner role
          try {
            stopAutoRefresh();
          } catch (e) {
            /* ignore */
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
      return docs.filter((d) => {
        const name = getDocName(d).toLowerCase();
        const email = getDocEmail(d).toLowerCase();
        const matchQ =
          !q ||
          name.includes(q) ||
          email.includes(q) ||
          String(d.registrationId ?? "").includes(q);
        const docSt = getDocStatus(d);
        const matchS = !st || docSt === st;
        return matchQ && matchS;
      });
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
    }
    try {
      /* no-op: persistence handled centrally */
    } catch (e) {
      /* ignore */
    }
    if (!col) return [];
    // If current user is a scanner, set the collection but avoid fetching protected endpoints
    if (isScanner) {
      // don't call loadDocs/loadStats for scanners
      // Do not start auto-refresh for scanners to avoid fetching full collection documents
      return [];
    }
    const docs = await loadDocs(dbToUse, col);
    await loadStats(dbToUse, col);
    startAutoRefresh(dbToUse, col);
    try {
      /* no-op: persistence handled centrally */
    } catch (e) {
      /* ignore */
    }
    return docs ?? [];
  };

  const loadDocs = async (db: string, col: string): Promise<Doc[]> => {
    if (isScanner) return [];
    showLoading("Fetching records...");
    try {
      const docs = (
        await api<Doc[]>("GET", `/databases/${db}/collections/${col}/documents`)
      ).map(serialise);
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
    } catch {
      /* silent */
    }
  };

  // ── select doc ────────────────────────────────────────────────────────────
  const selectDoc = async (id: string, dbParam?: string, colParam?: string) => {
    const dbToUse = dbParam ?? state.db;
    const colToUse = colParam ?? state.col;
    setState((prev) => ({
      ...prev,
      selected: prev.docs.find((d) => String(d._id) === id) ?? null,
    }));
    showLoading("Loading details...");
    try {
      if (isScanner) {
        // scanners are not allowed to request document details; keep selected summary only
        setState((prev) => ({ ...prev, details: null }));
      } else {
        const doc = serialise(
          await api<Doc>(
            "GET",
            `/databases/${dbToUse}/collections/${colToUse}/documents/${id}`,
          ),
        );
        setState((prev) => ({ ...prev, details: doc }));
      }
      try {
        /* persistence handled centrally */
      } catch (e) {
        /* ignore */
      }
    } catch (e: unknown) {
      toast((e as Error).message, "error");
    } finally {
      hideLoading();
    }
  };

  // ── approve ───────────────────────────────────────────────────────────────
  const approveDoc = async (id: string) => {
    showLoading("Generating QR & sending email...");
    try {
      await api(
        "POST",
        `/databases/${state.db}/collections/${state.col}/documents/${id}/approve`,
      );
      toast("Approved! QR sent to attendee.", "success");
      await loadDocs(state.db, state.col);
      await loadStats(state.db, state.col);
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
    showLoading("Rejecting & sending email...");
    try {
      await api(
        "POST",
        `/databases/${state.db}/collections/${state.col}/documents/${state.rejectTargetId}/reject`,
        { reason: rejectReason },
      );
      toast("Rejected. Email sent to attendee.", "info");
      await loadDocs(state.db, state.col);
      await loadStats(state.db, state.col);
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
    setEditFormData({ name: "", email: "", eventName: "" });
    openModal("doc");
  };

  const openEditModal = async (id: string) => {
    showLoading("Loading...");
    try {
      const doc = serialise(
        await api<Doc>(
          "GET",
          `/databases/${state.db}/collections/${state.col}/documents/${id}`,
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

    if (state.editingDoc) {
      Object.keys(data).forEach((k) => {
        if (data[k] === "[IMAGE DATA PRESERVED]" && state.editingDoc![k])
          data[k] = state.editingDoc![k];
      });
    }

    closeModal("doc");
    showLoading("Saving...");
    try {
      if (state.editingDoc) {
        await api(
          "PUT",
          `/databases/${state.db}/collections/${state.col}/documents/${String(state.editingDoc._id)}`,
          data,
        );
        toast("Document updated", "success");
        await selectDoc(String(state.editingDoc._id));
      } else {
        await api(
          "POST",
          `/databases/${state.db}/collections/${state.col}/documents`,
          data,
        );
        toast("Document created", "success");
      }
      await loadDocs(state.db, state.col);
      await loadStats(state.db, state.col);
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
    showLoading("Deleting...");
    try {
      await api(
        "DELETE",
        `/databases/${state.db}/collections/${state.col}/documents/${state.deleteTargetId}`,
      );
      toast("Document deleted", "info");
      setState((prev) => ({ ...prev, selected: null, details: null }));
      await loadDocs(state.db, state.col);
      await loadStats(state.db, state.col);
    } catch (e: unknown) {
      toast((e as Error).message, "error");
    } finally {
      hideLoading();
    }
  };

  // ── export ────────────────────────────────────────────────────────────────
  const exportExcel = async () => {
    const XLSX = await import("xlsx");
    // If a collection is selected, keep existing behavior
    if (state.col) {
      const docs = state.docs;
      if (!docs.length) {
        toast("No records to export", "info");
        return;
      }
      const keys = Object.keys(docs[0]).filter((k) => !isImageKey(k));
      const rows = [
        keys.map(formatKey),
        ...docs.map((d) =>
          keys.map((k) => {
            const v = d[k];
            if (v == null) return "";
            if (DATE_FIELD_KEYS.has(k) || isIsoDateString(v))
              return formatDateTime(v as string | number | Date | null);
            if (typeof v === "object") return JSON.stringify(v);
            return String(v);
          }),
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

      // build a consistent header set across all docs
      const keysSet = new Set<string>();
      allDocs.forEach((d) =>
        Object.keys(d).forEach((k) => {
          if (!isImageKey(k)) keysSet.add(k);
        }),
      );
      // ensure our synthetic event name column is first and has a friendly header
      keysSet.delete("__eventName");
      const keys = ["__eventName", ...Array.from(keysSet)];
      const headerRow = keys.map((k) =>
        k === "__eventName" ? "Event Name" : formatKey(k),
      );

      const rows = [
        headerRow,
        ...allDocs.map((d) =>
          keys.map((k) => {
            const v = (d as any)[k];
            if (v == null) return "";
            if (DATE_FIELD_KEYS.has(k) || isIsoDateString(v))
              return formatDateTime(v as string | number | Date | null);
            if (typeof v === "object") return JSON.stringify(v);
            return String(v);
          }),
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
      try {
        const docs = (
          await api<Doc[]>(
            "GET",
            `/databases/${db}/collections/${col}/documents`,
          )
        ).map(serialise);
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
        const s = await api<Stats>(
          "GET",
          `/databases/${db}/collections/${col}/stats`,
        ).catch(() => null);
        if (s) setStats(s);
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
  const exportDisabled = state.col ? !colHasData : !(cols && cols.length > 0);

  const allowedTabs = (() => {
    if (isScanner) return ["scanner"] as const;
    if (isViewer) return ["records"] as const;
    return ["records", "scanner"] as const;
  })();

  // ── render ────────────────────────────────────────────────────────────────
  // Results list component (rendered in sidebar on desktop, in main on mobile)
  const ResultsList = () => (
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
          return (
            <li
              key={String(doc._id)}
              className={`list-item${isActive ? " active" : ""}`}
              onClick={() => {
                selectDoc(String(doc._id));
              }}
            >
              <div className="list-item-name">{name}</div>
              {email && <div className="list-item-sub">{email}</div>}
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
              <option value="">Select Collection</option>
              {cols.map((c) => (
                <option key={c} value={c}>
                  {getEventDisplayName(c)}
                </option>
              ))}
            </select>
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
                disabled={!state.col}
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
        {!isScanner && (
          <div
            className="sidebar-inline desktop-only"
            style={{ width: 320, flexShrink: 0 }}
          >
            <div className="sidebar-head">
              <span className="sidebar-title">
                {state.col ? getEventDisplayName(state.col) : "All Records"}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="badge">{state.filtered.length}</span>
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
            <div className="search-wrap">
              <input
                type="text"
                placeholder="🔍 Search..."
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
              />
            </div>
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
                    placeholder="🔍 Search..."
                    value={searchQ}
                    onChange={(e) => setSearchQ(e.target.value)}
                  />
                </div>
              </div>
            )}
            <div className="mobile-only" style={{ paddingTop: 12 }}>
              <ResultsList />
            </div>
            {state.details ? (
              <DocDetail
                doc={state.details}
                onApprove={approveDoc}
                onOpenReject={openRejectModal}
                onEdit={openEditModal}
                onDelete={openDeleteModal}
                onResend={async (id: string) => {
                  showLoading("Resending email...");
                  try {
                    await api(
                      "POST",
                      `/databases/${state.db}/collections/${state.col}/documents/${id}/resend`,
                    );
                    toast("Email resent to attendee.", "success");
                    await loadDocs(state.db, state.col);
                    await selectDoc(id);
                  } catch (e: unknown) {
                    toast((e as Error).message, "error");
                  } finally {
                    hideLoading();
                  }
                }}
                isAdmin={isAdmin}
              />
            ) : !state.col ? (
              <div className="placeholder">
                <div className="placeholder-icon">
                  <i className="fas fa-database" />
                </div>
                <h3>Select a collection to begin</h3>
                <p style={{ fontSize: 14, marginTop: 8 }}>
                  Choose a database and collection from the header
                </p>
              </div>
            ) : null}
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
          <div className="modal" style={{ minWidth: 600, maxWidth: "90vw" }}>
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
                : "Fill out the participant details."}
            </p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
                gap: 16,
                maxHeight: "60vh",
                overflowY: "auto",
                paddingRight: 8,
              }}
            >
              {Object.entries(editFormData).map(([key, val]) => (
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
              ))}
            </div>
            <div className="modal-actions" style={{ marginTop: 24 }}>
              <button
                className="btn btn-ghost"
                onClick={() => closeModal("doc")}
              >
                Cancel
              </button>
              <button className="btn btn-primary" onClick={saveDoc}>
                <i className="fas fa-save" /> Save
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
    </>
  );
}
