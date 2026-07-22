import './globals.css';
import type { Metadata } from 'next';
import ClientLayout from './ClientLayout';
import { AppStateProvider } from '@/context/AppStateContext';
import { AuthProvider } from '@/context/AuthContext';

export const metadata: Metadata = {
  title: '顶流养成计划',
  description: '顶流小猪梨 顶流养成计划',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <AuthProvider>
          <AppStateProvider>
            <ClientLayout>{children}</ClientLayout>
          </AppStateProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
