"use client";
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Dashboard from '@/components/Dashboard';

export default function Home() {
  const [ready, setReady] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const router = useRouter();

  useEffect(() => {
    try {
      const token = typeof window !== 'undefined' ? window.localStorage.getItem('authToken') : null;
      const basic = typeof window !== 'undefined' ? window.localStorage.getItem('basicAuth') : null;
      if (!token && !basic) {
        router.push('/login');
        return;
      }
      setAllowed(true);
    } catch (e) {
      router.push('/login');
      return;
    } finally {
      setReady(true);
    }
  }, [router]);

  if (!ready) return null;
  if (!allowed) return null;
  return <Dashboard />;
}
