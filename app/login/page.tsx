"use client";
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Login failed');
      if (j.token) {
        localStorage.setItem('authToken', j.token);
      }
      router.push('/');
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally { setLoading(false); }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <form onSubmit={submit} style={{ width: 420, maxWidth: '100%', background: 'var(--card)', padding: 24, borderRadius: 12 }}>
        <h2 style={{ margin: 0, marginBottom: 12 }}>Event Manager Pro</h2>
        <p style={{ color: 'var(--muted)', marginTop: 0, marginBottom: 12 }}>Sign in with your account</p>
        {error && <div style={{ color: 'var(--red)', marginBottom: 12 }}>{error}</div>}
        <div style={{ marginBottom: 8 }}>
          <input className="form-input" placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
        </div>
        <div style={{ marginBottom: 12 }}>
          <input className="form-input" placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" type="submit" disabled={loading} style={{ width: '100%' }}>{loading ? 'Signing in…' : 'Sign in'}</button>
        </div>
      </form>
    </div>
  );
}
