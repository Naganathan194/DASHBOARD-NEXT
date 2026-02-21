'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { getEventDisplayName } from '@/lib/events';

// ── Types ──────────────────────────────────────────────────────────────────────
interface Doc { _id: string; [key: string]: unknown; }
interface Stats { total: number; approved: number; rejected: number; checkedIn: number; pending: number; }
interface ToastItem { id: number; msg: string; type: 'success' | 'error' | 'info'; }
interface AppState {
  db: string; col: string; docs: Doc[]; filtered: Doc[];
  selected: Doc | null; details: Doc | null;
  rejectTargetId: string | null; editingDoc: Doc | null; deleteTargetId: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────
const formatKey = (k: string) =>
  k.replace(/([A-Z])/g, ' $1').replace(/[_-]/g, ' ').replace(/\s+/g, ' ').trim()
   .replace(/\b\w/g, (l) => l.toUpperCase());

const formatColName = (n: string) => getEventDisplayName(n);

const getDocName = (doc: Doc): string => {
  for (const k of ['fullName', 'firstName', 'candidateName', 'name', 'title', 'email']) {
    if (doc[k]) return String(doc[k]);
  }
  return 'Unknown';
};

const getDocEmail = (doc: Doc): string =>
  String(doc.email ?? doc.mail ?? doc.Email ?? '');

const isImageVal = (v: unknown): boolean => {
  if (typeof v !== 'string') return false;
  return (v.startsWith('data:image') || v.startsWith('/9j/') || v.startsWith('iVBOR') ||
    (v.length > 200 && /^[A-Za-z0-9+/=]+$/.test(v.slice(0, 100))));
};

const isImageKey = (k: string): boolean =>
  /screenshot|image|photo|picture|img|payment|receipt|signature|avatar|profile/i.test(k);

const getDocStatus = (doc: Doc): string =>
  doc.checkedIn ? 'checked_in' : String(doc.status ?? 'pending');

// ─── API helper ────────────────────────────────────────────────────────────────
async function api<T = unknown>(method: string, url: string, body?: unknown): Promise<T> {
  const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch('/api' + url, opts);
  if (!r.ok) {
    const e = await r.json().catch(() => ({ error: r.statusText }));
    throw new Error(e.error || r.statusText);
  }
  return r.json() as T;
}

// ── Serialise Mongo docs (ObjectId → string) ───────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serialise(doc: any): Doc {
  return JSON.parse(JSON.stringify(doc));
}

// ── StatusPill ─────────────────────────────────────────────────────────────────
function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: 'pending', approved: 'approved', rejected: 'rejected', checked_in: 'checked_in',
  };
  const cls = map[status] ?? '';
  const label = status === 'checked_in' ? 'Checked In' :
    status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Pending';
  return <span className={`status-pill ${cls}`}>{label}</span>;
}

// ── Toast ──────────────────────────────────────────────────────────────────────
function Toasts({ toasts }: { toasts: ToastItem[] }) {
  const icons: Record<string, string> = { success: 'check-circle', error: 'exclamation-circle', info: 'info-circle' };
  const colors: Record<string, string> = { success: 'var(--green)', error: 'var(--red)', info: 'var(--accent)' };
  return (
    <div id="toast-container">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.type}`}>
          <i className={`fas fa-${icons[t.type]}`} style={{ color: colors[t.type] }} />
          <span>{t.msg}</span>
        </div>
      ))}
    </div>
  );
}

// ── Loading Overlay ─────────────────────────────────────────────────────────────
function LoadingOverlay({ show, text }: { show: boolean; text: string }) {
  return (
    <div className={`loading-overlay${show ? ' show' : ''}`}>
      <div className="spinner" />
      <span style={{ color: 'var(--muted)', fontSize: 14 }}>{text}</span>
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
        { cls: 'total',    icon: 'users',        val: stats.total,     lbl: 'Total'      },
        { cls: 'approved', icon: 'check-circle',  val: stats.approved,  lbl: 'Approved'   },
        { cls: 'pending',  icon: 'clock',         val: stats.pending,   lbl: 'Pending'    },
        { cls: 'rejected', icon: 'times-circle',  val: stats.rejected,  lbl: 'Rejected'   },
        { cls: 'checked',  icon: 'sign-in-alt',   val: stats.checkedIn, lbl: 'Checked In' },
      ].map((s) => (
        <div key={s.cls} className={`stat-card ${s.cls}`}>
          <div className="stat-icon"><i className={`fas fa-${s.icon}`} /></div>
          <div className="stat-val">{s.val}</div>
          <div className="stat-lbl">{s.lbl}</div>
        </div>
      ))}
    </div>
  );
}

// ── DocDetail ─────────────────────────────────────────────────────────────────
function DocDetail({
  doc, onApprove, onOpenReject, onEdit, onDelete,
}: {
  doc: Doc;
  onApprove: (id: string) => void;
  onOpenReject: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [imgSrc, setImgSrc] = useState('');
  const name     = getDocName(doc);
  const status   = getDocStatus(doc);
  const isPending  = !doc.status || doc.status === 'pending';
  const isApproved = doc.status === 'approved';
  const isRejected = doc.status === 'rejected';

  const fields = Object.entries(doc).filter(
    ([k, v]) => k !== '_id' && k !== 'qrCode' && !(isImageKey(k) && isImageVal(v))
  );
  const images = Object.entries(doc).filter(([k, v]) => isImageKey(k) && isImageVal(v));

  return (
    <>
      {imgSrc && <ImageModal src={imgSrc} onClose={() => setImgSrc('')} />}
      <div className="detail-card">
        <div className="detail-header">
          <div>
            <div className="detail-name">{name}</div>
            <div style={{ marginTop: 4 }}><StatusPill status={status} /></div>
            {isRejected && doc.rejectionReason != null && (
              <div style={{ marginTop: 8, fontSize: 13, color: 'var(--red)' }}>
                <i className="fas fa-info-circle" /> Reason: {String(doc.rejectionReason)}
              </div>
            )}
          </div>
          <div className="detail-actions">
            {isPending && (
              <>
                <button className="btn btn-success" onClick={() => onApprove(String(doc._id))}>
                  <i className="fas fa-check" /> Approve
                </button>
                <button className="btn btn-danger" onClick={() => onOpenReject(String(doc._id))}>
                  <i className="fas fa-times" /> Reject
                </button>
              </>
            )}
            {isApproved && !doc.checkedIn && (
              <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                <i className="fas fa-check-circle" style={{ color: 'var(--green)' }} /> Approved – waiting check-in
              </div>
            )}
            {isRejected && (
              <div style={{ color: 'var(--red)', fontSize: 13 }}>
                <i className="fas fa-times-circle" /> Rejected
              </div>
            )}
            <button className="btn btn-ghost btn-sm" onClick={() => onEdit(String(doc._id))}>
              <i className="fas fa-edit" /> Edit
            </button>
            <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red)' }} onClick={() => onDelete(String(doc._id))}>
              <i className="fas fa-trash" />
            </button>
          </div>
        </div>

        <div className="detail-body">
          <div className="fields-grid">
            {fields.map(([k, v]) => {
              let val: React.ReactNode;
              if (v === null || v === undefined) val = <em style={{ color: 'var(--muted)' }}>—</em>;
              else if (typeof v === 'object') val = <code style={{ fontSize: 11, background: 'var(--bg)', padding: '4px 8px', borderRadius: 4, display: 'block', overflowX: 'auto' }}>{JSON.stringify(v, null, 2)}</code>;
              else if (typeof v === 'boolean') val = <span style={{ color: v ? 'var(--green)' : 'var(--red)' }}>{v ? 'Yes' : 'No'}</span>;
              else { const s = String(v); val = s.length > 200 ? s.substring(0, 200) + '…' : s; }
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
              <img className="qr-img" src={String(doc.qrCode)} alt="QR Code" onClick={() => setImgSrc(String(doc.qrCode))} />
              <div>
                <div style={{ fontFamily: 'Syne,sans-serif', fontWeight: 700, marginBottom: 6 }}>Entry QR Code</div>
                <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>Attendee uses this to check in</p>
                {doc.checkInTime != null && (
                  <div style={{ fontSize: 12, color: 'var(--blue)' }}>
                    <i className="fas fa-clock" /> Checked in: {new Date(String(doc.checkInTime)).toLocaleString()}
                  </div>
                )}
                <a className="btn btn-ghost btn-sm" style={{ marginTop: 10, display: 'inline-flex' }}
                  download={`qr_${String(doc._id)}.png`} href={String(doc.qrCode)}>
                  <i className="fas fa-download" /> Download QR
                </a>
              </div>
            </div>
          )}

          {images.map(([k, v]) => {
            const src = String(v).startsWith('data:') ? String(v) : 'data:image/jpeg;base64,' + String(v);
            return (
              <div key={k} className="img-preview">
                <div style={{ fontFamily: 'Syne,sans-serif', fontWeight: 700, marginBottom: 12, fontSize: 14 }}>
                  <i className="fas fa-image" style={{ color: 'var(--accent)' }} /> {formatKey(k)}
                </div>
                <img src={src} onClick={() => setImgSrc(src)} alt={k} />
                <div className="img-actions">
                  <button className="btn btn-ghost btn-sm" onClick={() => setImgSrc(src)}><i className="fas fa-expand" /> View</button>
                  <a className="btn btn-ghost btn-sm" download={`${k}_${Date.now()}.png`} href={src}><i className="fas fa-download" /> Download</a>
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
function ScannerPanel({ onToast }: { onToast: (m: string, t: 'success' | 'error' | 'info') => void }) {
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<React.ReactNode>(null);
  const [manualInput, setManualInput] = useState('');
  const scannerRef = useRef<unknown>(null);

  const stopScanner = useCallback(async () => {
    setScanning(false);
    if (scannerRef.current) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (scannerRef.current as any).stop().catch(() => {});
      scannerRef.current = null;
    }
  }, []);

  const startScanner = useCallback(async () => {
    const { Html5Qrcode } = await import('html5-qrcode');
    setScanning(true);
    const scanner = new Html5Qrcode('qr-reader');
    scannerRef.current = scanner;
    scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: 250 },
      async (decoded: string) => { await stopScanner(); processScan(decoded); },
      () => {}
    ).catch((e: unknown) => {
      onToast('Camera error: ' + String(e), 'error');
      stopScanner();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopScanner]);

  useEffect(() => { return () => { stopScanner(); }; }, [stopScanner]);

  const processScan = async (data: string) => {
    setScanResult(
      <div style={{ textAlign: 'center', padding: 24 }}>
        <div className="spinner" style={{ margin: 'auto' }} />
      </div>
    );
    try {
      const r = await api<{ document: Doc; db: string; collection: string }>('POST', '/scan', { qrData: data });
      const doc = serialise(r.document);
      const name        = getDocName(doc);
      const email       = getDocEmail(doc);
      const alreadyIn   = !!doc.checkedIn;

      setScanResult(
        <div className={`scan-result success`}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <i className="fas fa-user-circle" style={{ fontSize: 36, color: 'var(--accent)' }} />
            <div>
              <div className="scan-attendee-name">{name}</div>
              {email && <div style={{ fontSize: 13, color: 'var(--muted)' }}>{email}</div>}
            </div>
          </div>
          <div className={`checkin-status ${alreadyIn ? 'in' : 'out'}`}>
            <i className={`fas fa-${alreadyIn ? 'check-circle' : 'clock'}`} />
            {alreadyIn ? `Already Checked In at ${new Date(String(doc.checkInTime)).toLocaleTimeString()}` : 'Not Yet Checked In'}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            {Object.entries(doc)
              .filter(([k]) => k !== '_id' && k !== 'qrCode' && k !== 'qrToken' && !isImageKey(k))
              .slice(0, 8)
              .map(([k, v]) => (
                <div key={k} style={{ background: 'var(--surface2)', borderRadius: 8, padding: '8px 12px' }}>
                  <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase' }}>{formatKey(k)}</div>
                  <div style={{ fontSize: 13 }}>{v == null ? '—' : String(v).substring(0, 40)}</div>
                </div>
              ))}
          </div>
          {!alreadyIn ? (
            <button className="btn btn-success" style={{ width: '100%' }}
              onClick={() => doCheckIn(String(doc._id), r.db, r.collection, data)}>
              <i className="fas fa-sign-in-alt" /> Confirm Check-In
            </button>
          ) : (
            <div style={{ color: 'var(--green)', textAlign: 'center', fontWeight: 600 }}>
              <i className="fas fa-check-circle" /> Already Checked In
            </div>
          )}
        </div>
      );
    } catch (e: unknown) {
      setScanResult(
        <div className="scan-result error">
          <div style={{ color: 'var(--red)', fontFamily: 'Syne,sans-serif', fontWeight: 700, marginBottom: 8 }}>
            <i className="fas fa-times-circle" /> Invalid QR Code
          </div>
          <p style={{ fontSize: 13, color: 'var(--muted)' }}>{(e as Error).message}</p>
        </div>
      );
    }
  };

  const doCheckIn = async (id: string, db: string, collection: string, rawData: string) => {
    try {
      await api('POST', '/checkin', { id, db, collection });
      onToast('✅ Check-in successful!', 'success');
      await processScan(rawData);
    } catch (e: unknown) { onToast((e as Error).message, 'error'); }
  };

  const manualScan = async () => {
    if (!manualInput.trim()) { onToast('Enter QR data', 'error'); return; }
    await processScan(manualInput.trim());
  };

  return (
    <div className="scanner-panel">
      <h2 style={{ fontFamily: 'Syne,sans-serif', fontSize: 24, marginBottom: 24, alignSelf: 'flex-start' }}>
        <i className="fas fa-qrcode" style={{ color: 'var(--accent)' }} /> QR Check-In Scanner
      </h2>

      <div className="scanner-box">
        <div className="scanner-head"><i className="fas fa-camera" /> Point camera at attendee QR code</div>
        <div id="qr-reader" />
        <div style={{ padding: 16, display: 'flex', gap: 10, justifyContent: 'center' }}>
          {!scanning ? (
            <button className="btn btn-primary" onClick={startScanner}><i className="fas fa-play" /> Start Camera</button>
          ) : (
            <button className="btn btn-ghost" onClick={stopScanner}><i className="fas fa-stop" /> Stop</button>
          )}
        </div>
      </div>

      <div style={{ width: '100%', maxWidth: 500, background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, marginBottom: 24 }}>
        <div style={{ fontFamily: 'Syne,sans-serif', fontWeight: 700, marginBottom: 12, fontSize: 15 }}>
          <i className="fas fa-keyboard" style={{ color: 'var(--accent)' }} /> Manual QR Data Entry
        </div>
        <input type="text" className="form-input" placeholder="Paste QR JSON or token here"
          value={manualInput} onChange={(e) => setManualInput(e.target.value)} />
        <button className="btn btn-primary" style={{ marginTop: 10, width: '100%' }} onClick={manualScan}>
          <i className="fas fa-search" /> Lookup
        </button>
      </div>

      <div style={{ width: '100%', maxWidth: 500 }}>{scanResult}</div>
    </div>
  );
}

// ── Dashboard (main) ─────────────────────────────────────────────────────────
export default function Dashboard() {
  const [state, setState] = useState<AppState>({
    db: '', col: '', docs: [], filtered: [], selected: null, details: null,
    rejectTargetId: null, editingDoc: null, deleteTargetId: null,
  });
  const [dbs, setDbs] = useState<string[]>([]);
  const [cols, setCols] = useState<string[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState('Loading...');
  const [activeTab, setActiveTab] = useState<'records' | 'scanner'>('records');
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [searchQ, setSearchQ] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [docJsonInput, setDocJsonInput] = useState('');
  const [modals, setModals] = useState({ reject: false, doc: false, delete: false });
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const toast = useCallback((msg: string, type: 'success' | 'error' | 'info' = 'info') => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, msg, type }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3500);
  }, []);

  const showLoading = (text = 'Loading...') => { setLoadingText(text); setLoading(true); };
  const hideLoading = () => setLoading(false);

  const openModal  = (m: keyof typeof modals) => setModals((prev) => ({ ...prev, [m]: true }));
  const closeModal = (m: keyof typeof modals) => setModals((prev) => ({ ...prev, [m]: false }));

  // ── init ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const list = await api<string[]>('GET', '/databases');
        setDbs(list);
        setConnected(true);
      } catch (e: unknown) {
        setConnected(false);
        toast('Cannot connect to server: ' + (e as Error).message, 'error');
      }
    })();
  }, [toast]);

  // ── filter ────────────────────────────────────────────────────────────────
  const applyFilter = useCallback((docs: Doc[], q: string, st: string): Doc[] => {
    return docs.filter((d) => {
      const name  = getDocName(d).toLowerCase();
      const email = getDocEmail(d).toLowerCase();
      const matchQ = !q || name.includes(q) || email.includes(q) || String(d.registrationId ?? '').includes(q);
      const docSt  = getDocStatus(d);
      const matchS = !st || docSt === st;
      return matchQ && matchS;
    });
  }, []);

  useEffect(() => {
    setState((prev) => ({ ...prev, filtered: applyFilter(prev.docs, searchQ, filterStatus) }));
  }, [searchQ, filterStatus, applyFilter]);

  // ── DB change ─────────────────────────────────────────────────────────────
  const onDbChange = async (db: string) => {
    stopAutoRefresh();
    setState((prev) => ({ ...prev, db, col: '', docs: [], filtered: [], selected: null, details: null }));
    setCols([]);
    setStats(null);
    if (!db) return;
    try {
      const list = await api<string[]>('GET', `/databases/${db}/collections`);
      setCols(list);
    } catch (e: unknown) { toast((e as Error).message, 'error'); }
  };

  // ── Col change ────────────────────────────────────────────────────────────
  const onColChange = async (col: string) => {
    stopAutoRefresh();
    setState((prev) => ({ ...prev, col, selected: null, docs: [] }));
    setStats(null);
    if (!col) return;
    await loadDocs(state.db, col);
    await loadStats(state.db, col);
    startAutoRefresh(state.db, col);
  };

  const loadDocs = async (db: string, col: string) => {
    showLoading('Fetching records...');
    try {
      const docs = (await api<Doc[]>('GET', `/databases/${db}/collections/${col}/documents`)).map(serialise);
      const sorted = docs.sort((a, b) => {
        const ra = String(a.registrationId ?? a.regId ?? a.registerNumber ?? '');
        const rb = String(b.registrationId ?? b.regId ?? b.registerNumber ?? '');
        return ra.localeCompare(rb, undefined, { numeric: true });
      });
      setState((prev) => ({
        ...prev, docs: sorted,
        filtered: applyFilter(sorted, searchQ, filterStatus),
      }));
    } catch (e: unknown) { toast((e as Error).message, 'error'); }
    finally { hideLoading(); }
  };

  const loadStats = async (db: string, col: string) => {
    try {
      const s = await api<Stats>('GET', `/databases/${db}/collections/${col}/stats`);
      setStats(s);
    } catch { /* silent */ }
  };

  // ── select doc ────────────────────────────────────────────────────────────
  const selectDoc = async (id: string) => {
    setState((prev) => ({
      ...prev,
      selected: prev.docs.find((d) => String(d._id) === id) ?? null,
    }));
    showLoading('Loading details...');
    try {
      const doc = serialise(await api<Doc>('GET', `/databases/${state.db}/collections/${state.col}/documents/${id}`));
      setState((prev) => ({ ...prev, details: doc }));
    } catch (e: unknown) { toast((e as Error).message, 'error'); }
    finally { hideLoading(); }
  };

  // ── approve ───────────────────────────────────────────────────────────────
  const approveDoc = async (id: string) => {
    showLoading('Generating QR & sending email...');
    try {
      await api('POST', `/databases/${state.db}/collections/${state.col}/documents/${id}/approve`);
      toast('Approved! QR sent to attendee.', 'success');
      await loadDocs(state.db, state.col);
      await loadStats(state.db, state.col);
      await selectDoc(id);
    } catch (e: unknown) { toast((e as Error).message, 'error'); }
    finally { hideLoading(); }
  };

  // ── reject ────────────────────────────────────────────────────────────────
  const openRejectModal = (id: string) => {
    setState((prev) => ({ ...prev, rejectTargetId: id }));
    setRejectReason('');
    openModal('reject');
  };

  const submitReject = async () => {
    if (!rejectReason.trim()) { toast('Please enter a reason', 'error'); return; }
    closeModal('reject');
    showLoading('Rejecting & sending email...');
    try {
      await api('POST', `/databases/${state.db}/collections/${state.col}/documents/${state.rejectTargetId}/reject`, { reason: rejectReason });
      toast('Rejected. Email sent to attendee.', 'info');
      await loadDocs(state.db, state.col);
      await loadStats(state.db, state.col);
      if (state.rejectTargetId) await selectDoc(state.rejectTargetId);
    } catch (e: unknown) { toast((e as Error).message, 'error'); }
    finally { hideLoading(); }
  };

  // ── add / edit ────────────────────────────────────────────────────────────
  const openAddModal = () => {
    setState((prev) => ({ ...prev, editingDoc: null }));
    setDocJsonInput('{\n  "name": "",\n  "email": "",\n  "eventName": ""\n}');
    openModal('doc');
  };

  const openEditModal = async (id: string) => {
    showLoading('Loading...');
    try {
      const doc = serialise(await api<Doc>('GET', `/databases/${state.db}/collections/${state.col}/documents/${id}`));
      setState((prev) => ({ ...prev, editingDoc: doc }));
      const clean = { ...doc } as Record<string, unknown>;
      delete clean._id;
      Object.keys(clean).forEach((k) => { if (isImageKey(k) && isImageVal(clean[k])) clean[k] = '[IMAGE DATA PRESERVED]'; });
      setDocJsonInput(JSON.stringify(clean, null, 2));
      openModal('doc');
    } catch (e: unknown) { toast((e as Error).message, 'error'); }
    finally { hideLoading(); }
  };

  const saveDoc = async () => {
    let data: Record<string, unknown>;
    try { data = JSON.parse(docJsonInput); }
    catch (e: unknown) { toast('Invalid JSON: ' + (e as Error).message, 'error'); return; }

    if (state.editingDoc) {
      Object.keys(data).forEach((k) => {
        if (data[k] === '[IMAGE DATA PRESERVED]' && state.editingDoc![k]) data[k] = state.editingDoc![k];
      });
    }

    closeModal('doc');
    showLoading('Saving...');
    try {
      if (state.editingDoc) {
        await api('PUT', `/databases/${state.db}/collections/${state.col}/documents/${String(state.editingDoc._id)}`, data);
        toast('Document updated', 'success');
        await selectDoc(String(state.editingDoc._id));
      } else {
        await api('POST', `/databases/${state.db}/collections/${state.col}/documents`, data);
        toast('Document created', 'success');
      }
      await loadDocs(state.db, state.col);
      await loadStats(state.db, state.col);
    } catch (e: unknown) { toast((e as Error).message, 'error'); }
    finally { hideLoading(); }
  };

  // ── delete ────────────────────────────────────────────────────────────────
  const openDeleteModal = (id: string) => {
    setState((prev) => ({ ...prev, deleteTargetId: id }));
    openModal('delete');
  };

  const confirmDelete = async () => {
    closeModal('delete');
    showLoading('Deleting...');
    try {
      await api('DELETE', `/databases/${state.db}/collections/${state.col}/documents/${state.deleteTargetId}`);
      toast('Document deleted', 'info');
      setState((prev) => ({ ...prev, selected: null, details: null }));
      await loadDocs(state.db, state.col);
      await loadStats(state.db, state.col);
    } catch (e: unknown) { toast((e as Error).message, 'error'); }
    finally { hideLoading(); }
  };

  // ── export ────────────────────────────────────────────────────────────────
  const exportExcel = async () => {
    const XLSX = await import('xlsx');
    const docs = state.docs;
    if (!docs.length) return;
    const keys = Object.keys(docs[0]).filter((k) => !isImageKey(k));
    const rows = [keys.map(formatKey), ...docs.map((d) => keys.map((k) => {
      const v = d[k];
      if (v == null) return '';
      if (typeof v === 'object') return JSON.stringify(v);
      return String(v);
    }))];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), state.col.substring(0, 31));
    XLSX.writeFile(wb, `${state.col}_${new Date().toISOString().split('T')[0]}.xlsx`);
    toast('Exported successfully', 'success');
  };

  // ── auto refresh ──────────────────────────────────────────────────────────
  const startAutoRefresh = (db: string, col: string) => {
    autoRefreshRef.current = setInterval(async () => {
      if (!db || !col) return;
      try {
        const docs = (await api<Doc[]>('GET', `/databases/${db}/collections/${col}/documents`)).map(serialise);
        setState((prev) => {
          if (JSON.stringify(docs.map((d) => d._id)) !== JSON.stringify(prev.docs.map((d) => d._id))) {
            return { ...prev, docs, filtered: applyFilter(docs, searchQ, filterStatus) };
          }
          return prev;
        });
        const s = await api<Stats>('GET', `/databases/${db}/collections/${col}/stats`).catch(() => null);
        if (s) setStats(s);
      } catch { /* silent */ }
    }, 30000);
  };

  const stopAutoRefresh = () => {
    if (autoRefreshRef.current) { clearInterval(autoRefreshRef.current); autoRefreshRef.current = null; }
  };

  useEffect(() => { return () => stopAutoRefresh(); }, []);

  const colHasData = !!state.col && state.docs.length > 0;

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <>
      <LoadingOverlay show={loading} text={loadingText} />
      <Toasts toasts={toasts} />

      {/* HEADER */}
      <header className="header">
        <div className="logo">
          <div className="logo-icon"><i className="fas fa-bolt" /></div>
          EventManager Pro
        </div>
        <div className="header-selects">
          <select value={state.db} onChange={(e) => onDbChange(e.target.value)}>
            <option value="">Select Database</option>
            {dbs.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <select value={state.col} onChange={(e) => onColChange(e.target.value)} disabled={!state.db}>
            <option value="">Select Collection</option>
            {cols.map((c) => <option key={c} value={c}>{getEventDisplayName(c)}</option>)}
          </select>
        </div>
        <div className="header-right">
          <button className="btn btn-ghost btn-sm" onClick={exportExcel} disabled={!colHasData}>
            <i className="fas fa-download" /> Export
          </button>
          <button className="btn btn-primary btn-sm" onClick={openAddModal} disabled={!state.col}>
            <i className="fas fa-plus" /> Add
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted)' }}>
            <div className={`status-dot ${connected ? 'connected' : 'disconnected'}`} />
            <span>{connected ? 'Connected' : 'Disconnected'}</span>
          </div>
        </div>
      </header>

      {/* NAV TABS */}
      <nav className="nav-tabs">
        {(['records', 'scanner'] as const).map((tab) => (
          <button key={tab} className={`nav-tab${activeTab === tab ? ' active' : ''}`} onClick={() => setActiveTab(tab)}>
            <i className={`fas fa-${tab === 'records' ? 'table' : 'qrcode'}`} />
            {tab === 'records' ? 'Records' : 'QR Scanner'}
          </button>
        ))}
      </nav>

      {/* MAIN */}
      <div className="main">

        {/* ── RECORDS PANEL ── */}
        <div className={`panel${activeTab === 'records' ? ' active' : ''}`} id="panel-records">
          <aside className="sidebar">
            <div className="sidebar-head">
              <span className="sidebar-title">{state.col ? getEventDisplayName(state.col) : 'All Records'}</span>
              <span className="badge">{state.filtered.length}</span>
            </div>
            <div style={{ padding: 12, borderBottom: '1px solid var(--border)', display: 'flex', gap: 6 }}>
              <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
                style={{ flex: 1, minWidth: 0, fontSize: 12, padding: '6px 10px' }}>
                <option value="">All Status</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option value="checked_in">Checked In</option>
              </select>
            </div>
            <div className="search-wrap">
              <input type="text" placeholder="🔍 Search..." value={searchQ} onChange={(e) => setSearchQ(e.target.value)} />
            </div>
            <ul className="list">
              {state.filtered.length === 0 ? (
                <li className="empty">
                  <i className="fas fa-inbox" /><br />
                  {state.col ? 'No records found' : 'Select a collection'}
                </li>
              ) : (
                state.filtered.map((doc) => {
                  const name    = getDocName(doc);
                  const email   = getDocEmail(doc);
                  const regId   = String(doc.registrationId ?? doc.regId ?? doc.registerNumber ?? '');
                  const docStatus = getDocStatus(doc);
                  const isActive  = String(state.selected?._id) === String(doc._id);
                  return (
                    <li key={String(doc._id)} className={`list-item${isActive ? ' active' : ''}`}
                      onClick={() => selectDoc(String(doc._id))}>
                      <div className="list-item-name">{name}</div>
                      {email && <div className="list-item-sub">{email}</div>}
                      <div className="list-item-meta">
                        {regId ? <span style={{ fontSize: 11, color: 'var(--muted)' }}>#{regId.substring(0, 10)}</span> : <span />}
                        <StatusPill status={docStatus} />
                      </div>
                    </li>
                  );
                })
              )}
            </ul>
          </aside>

          <div className="content">
            {stats && <StatsGrid stats={stats} />}
            {state.details ? (
              <DocDetail
                doc={state.details}
                onApprove={approveDoc}
                onOpenReject={openRejectModal}
                onEdit={openEditModal}
                onDelete={openDeleteModal}
              />
            ) : !state.col ? (
              <div className="placeholder">
                <div className="placeholder-icon"><i className="fas fa-database" /></div>
                <h3>Select a collection to begin</h3>
                <p style={{ fontSize: 14, marginTop: 8 }}>Choose a database and collection from the header</p>
              </div>
            ) : null}
          </div>
        </div>

        {/* ── SCANNER PANEL ── */}
        <div className={`panel${activeTab === 'scanner' ? ' active' : ''}`} id="panel-scanner">
          {activeTab === 'scanner' && <ScannerPanel onToast={toast} />}
        </div>
      </div>

      {/* ── REJECT MODAL ── */}
      {modals.reject && (
        <div className="modal-overlay open">
          <div className="modal">
            <div className="modal-title"><i className="fas fa-times-circle" style={{ color: 'var(--red)' }} /> Reject Attendee</div>
            <p style={{ color: 'var(--muted)', fontSize: 14, marginBottom: 20 }}>
              Please provide a reason for rejection. This will be emailed to the attendee.
            </p>
            <div className="form-group">
              <label className="form-label">Reason for Rejection *</label>
              <textarea className="form-input" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
                placeholder="e.g. Registration incomplete, missing documents, event capacity reached..." />
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => closeModal('reject')}>Cancel</button>
              <button className="btn btn-danger" onClick={submitReject}><i className="fas fa-times" /> Reject &amp; Notify</button>
            </div>
          </div>
        </div>
      )}

      {/* ── ADD/EDIT DOC MODAL ── */}
      {modals.doc && (
        <div className="modal-overlay open">
          <div className="modal" style={{ minWidth: 600 }}>
            <div className="modal-title">
              <i className={`fas fa-${state.editingDoc ? 'edit' : 'plus'}`} style={{ color: 'var(--accent)' }} />
              {state.editingDoc ? 'Edit Document' : 'Add Document'}
            </div>
            <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 16 }}>
              {state.editingDoc
                ? 'Edit the JSON. Image fields marked [IMAGE DATA PRESERVED] will remain unchanged.'
                : 'Enter fields as JSON key-value pairs'}
            </p>
            <div className="form-group">
              <label className="form-label">JSON Data</label>
              <textarea className="form-input" style={{ minHeight: 200, fontFamily: 'monospace', fontSize: 13 }}
                value={docJsonInput} onChange={(e) => setDocJsonInput(e.target.value)} />
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => closeModal('doc')}>Cancel</button>
              <button className="btn btn-primary" onClick={saveDoc}><i className="fas fa-save" /> Save</button>
            </div>
          </div>
        </div>
      )}

      {/* ── DELETE CONFIRM ── */}
      {modals.delete && (
        <div className="modal-overlay open">
          <div className="modal">
            <div className="modal-title"><i className="fas fa-trash" style={{ color: 'var(--red)' }} /> Confirm Delete</div>
            <p style={{ color: 'var(--muted)', fontSize: 14 }}>Are you sure you want to delete this record? This cannot be undone.</p>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => closeModal('delete')}>Cancel</button>
              <button className="btn btn-danger" onClick={confirmDelete}><i className="fas fa-trash" /> Delete</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
