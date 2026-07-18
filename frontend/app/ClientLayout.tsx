'use client';

import Sidebar from '@/components/Sidebar';
import AuthStateBridge from '@/components/AuthStateBridge';
import AuthDialog from '@/components/AuthDialog';
import UnlockDialog from '@/components/UnlockDialog';
import RegisterSuccessDialog from '@/components/RegisterSuccessDialog';

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="koc-app-shell flex overflow-hidden bg-transparent px-6 py-7 text-[var(--foreground)]">
      <AuthStateBridge />
      <UnlockDialog />
      <RegisterSuccessDialog />
      <AuthDialog />
      <Sidebar />
      <main className="relative ml-6 flex h-full min-w-0 flex-1 overflow-y-auto overflow-x-hidden rounded-[26px] border border-transparent bg-transparent">
        {children}
      </main>
    </div>
  );
}
