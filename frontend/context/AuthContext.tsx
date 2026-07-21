'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { API_BASE, isRecord, readJsonResponse } from '@/lib/api';
import { ANONYMOUS_PERSONA_GENERATED_STORAGE_KEY } from '@/lib/persona';
import { clearAgentChatScopeData, setAgentChatAccountScope } from '@/lib/agent-chat-store';

export interface AuthUser {
  id?: string;
  username?: string;
  email?: string;
  name?: string;
  avatar?: string;
}

type AuthStatus = 'loading' | 'authenticated' | 'anonymous';
export type AuthDialogMode = 'login' | 'register';

export interface AuthDialogState {
  open: boolean;
  mode: AuthDialogMode;
  title: string;
  description: string;
  redirectTo?: string;
  closeRedirectTo?: string;
  initialUsername?: string;
}

export interface UnlockDialogState {
  open: boolean;
  title: string;
  descriptionLines: string[];
  redirectTo?: string;
  closeRedirectTo?: string;
}

export type RegisterSuccessActionTarget = 'auth-dialog-login' | 'login-page';

export interface RegisterSuccessDialogState {
  open: boolean;
  title: string;
  actionLabel: string;
  actionTarget: RegisterSuccessActionTarget;
  redirectTo?: string;
}

export interface KnownAccount {
  id: string;
  username: string;
  name?: string;
  avatar?: string;
  lastUsedAt: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  status: AuthStatus;
  isAuthenticated: boolean;
  knownAccounts: KnownAccount[];
  authDialog: AuthDialogState;
  unlockDialog: UnlockDialogState;
  registerSuccessDialog: RegisterSuccessDialogState;
  refreshMe: () => Promise<AuthUser | null>;
  login: (payload: AuthCredentials) => Promise<AuthUser | null>;
  register: (payload: AuthCredentials) => Promise<AuthUser | null>;
  switchKnownAccount: (accountId: string) => Promise<AuthUser | null>;
  logout: () => Promise<void>;
  updateProfile: (payload: AuthProfileUpdate) => Promise<AuthUser | null>;
  deleteAccount: () => Promise<void>;
  removeKnownAccount: (accountId: string) => void;
  openAuthDialog: (overrides?: Partial<AuthDialogState>) => void;
  closeAuthDialog: () => void;
  setAuthDialogMode: (mode: AuthDialogMode) => void;
  openUnlockDialog: (overrides?: Partial<UnlockDialogState>) => void;
  closeUnlockDialog: () => void;
  openRegisterSuccessDialog: (overrides?: Partial<RegisterSuccessDialogState>) => void;
  closeRegisterSuccessDialog: () => void;
}

export interface AuthCredentials {
  username: string;
  password: string;
  name?: string;
  avatar?: string;
}

export interface AuthProfileUpdate {
  name?: string;
  avatar?: string;
}

export const SKIP_UNLOCK_ONCE_STORAGE_KEY = 'koc-agent-skip-unlock-once';
const KNOWN_ACCOUNTS_STORAGE_KEY = 'koc-agent-known-accounts';

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const DEFAULT_AUTH_DIALOG_STATE: AuthDialogState = {
  open: false,
  mode: 'login',
  title: '登录后解锁完整功能',
  description: '登录后可以保存人设、追踪热点，并保留你的内容草稿。',
};

const DEFAULT_UNLOCK_DIALOG_STATE: UnlockDialogState = {
  open: false,
  title: '登录后解锁完整功能',
  descriptionLines: ['热门追踪和内容撰写需要基于', '你的人设信息、历史记录和草稿内容生成'],
};

const DEFAULT_REGISTER_SUCCESS_DIALOG_STATE: RegisterSuccessDialogState = {
  open: false,
  title: '注册成功！',
  actionLabel: '去登录',
  actionTarget: 'auth-dialog-login',
};

function normalizeUser(value: unknown): AuthUser | null {
  if (!isRecord(value)) return null;
  const candidate = isRecord(value.user) ? value.user : value;
  if (!isRecord(candidate)) return null;

  const id = typeof candidate.id === 'string' ? candidate.id : typeof candidate.userId === 'string' ? candidate.userId : undefined;
  const username = typeof candidate.username === 'string' ? candidate.username : undefined;
  const email = typeof candidate.email === 'string' ? candidate.email : username;
  const name = typeof candidate.name === 'string' ? candidate.name : undefined;
  const avatar = typeof candidate.avatar === 'string' ? candidate.avatar : undefined;

  return id || username || email || name ? { id, username, email, name, avatar } : null;
}

function readUserFromResponse(payload: unknown) {
  const root = isRecord(payload) ? payload : {};
  return normalizeUser(root.data) || normalizeUser(root);
}

async function postAuth(endpoint: string, body?: unknown) {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${endpoint}`, {
      method: 'POST',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      credentials: 'include',
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error('无法连接后端服务，请确认 Docker 服务已启动后重试。');
  }
  const payload = await readJsonResponse(response).catch((error) => {
    if (response.ok) return {};
    throw error;
  });
  if (!response.ok) {
    const record = isRecord(payload) ? payload : {};
    throw new Error(
      (typeof record.message === 'string' && record.message) ||
        (typeof record.msg === 'string' && record.msg) ||
        '请求失败，请稍后重试',
    );
  }
  return payload;
}

async function patchAuth(endpoint: string, body: unknown) {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${endpoint}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('无法连接后端服务，请确认 Docker 服务已启动后重试。');
  }
  const payload = await readJsonResponse(response).catch((error) => {
    if (response.ok) return {};
    throw error;
  });
  if (!response.ok) {
    const record = isRecord(payload) ? payload : {};
    throw new Error(
      (typeof record.message === 'string' && record.message) ||
        (typeof record.msg === 'string' && record.msg) ||
        '请求失败，请稍后重试',
    );
  }
  return payload;
}

async function deleteAuth(endpoint: string) {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${endpoint}`, {
      method: 'DELETE',
      credentials: 'include',
    });
  } catch {
    throw new Error('无法连接后端服务，请确认 Docker 服务已启动后重试。');
  }
  const payload = await readJsonResponse(response).catch((error) => {
    if (response.ok) return {};
    throw error;
  });
  if (!response.ok) {
    const record = isRecord(payload) ? payload : {};
    throw new Error(
      (typeof record.message === 'string' && record.message) ||
        (typeof record.msg === 'string' && record.msg) ||
        '请求失败，请稍后重试',
    );
  }
  return payload;
}

function readKnownAccounts(): KnownAccount[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KNOWN_ACCOUNTS_STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is KnownAccount => {
        return (
          isRecord(item) &&
          typeof item.id === 'string' &&
          typeof item.username === 'string' &&
          typeof item.lastUsedAt === 'string'
        );
      })
      .slice(0, 5);
  } catch {
    return [];
  }
}

function writeKnownAccounts(accounts: KnownAccount[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(KNOWN_ACCOUNTS_STORAGE_KEY, JSON.stringify(accounts.slice(0, 5)));
}

function accountIdForUser(user: AuthUser) {
  return user.id || user.username || user.email || '';
}

function accountUsernameForUser(user: AuthUser) {
  return user.username || user.email || user.name || '';
}

function upsertKnownAccount(accounts: KnownAccount[], user: AuthUser): KnownAccount[] {
  const id = accountIdForUser(user);
  const username = accountUsernameForUser(user);
  if (!id || !username) return accounts;
  const existing = accounts.find((account) => account.id === id || account.username === username);

  const nextAccount: KnownAccount = {
    id,
    username,
    name: user.name,
    avatar: user.avatar,
    lastUsedAt: new Date().toISOString(),
  };
  const next = existing
    ? [nextAccount, ...accounts.filter((account) => account.id !== id && account.username !== username)]
    : accounts.length >= 5
      ? accounts
      : [nextAccount, ...accounts];
  writeKnownAccounts(next);
  return next;
}

function clearAnonymousPersonaTrialFlag() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(ANONYMOUS_PERSONA_GENERATED_STORAGE_KEY);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [knownAccounts, setKnownAccounts] = useState<KnownAccount[]>(() => readKnownAccounts());
  const [authDialog, setAuthDialog] = useState<AuthDialogState>(DEFAULT_AUTH_DIALOG_STATE);
  const [unlockDialog, setUnlockDialog] = useState<UnlockDialogState>(DEFAULT_UNLOCK_DIALOG_STATE);
  const [registerSuccessDialog, setRegisterSuccessDialog] = useState<RegisterSuccessDialogState>(
    DEFAULT_REGISTER_SUCCESS_DIALOG_STATE,
  );

  const rememberKnownAccount = useCallback((nextUser: AuthUser | null) => {
    if (!nextUser) return;
    setKnownAccounts((current) => upsertKnownAccount(current, nextUser));
  }, []);

  const removeKnownAccount = useCallback((accountId: string) => {
    setKnownAccounts((current) => {
      const next = current.filter((account) => account.id !== accountId);
      writeKnownAccounts(next);
      return next;
    });
  }, []);

  const refreshMe = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE}/api/auth/me`, {
        method: 'GET',
        credentials: 'include',
      });
      if (!response.ok) {
        setUser(null);
        setStatus('anonymous');
        return null;
      }
      const payload = await readJsonResponse(response);
      const nextUser = readUserFromResponse(payload);
      setUser(nextUser);
      setStatus(nextUser ? 'authenticated' : 'anonymous');
      rememberKnownAccount(nextUser);
      return nextUser;
    } catch (error) {
      console.error('Auth me failed', error);
      setUser(null);
      setStatus('anonymous');
      return null;
    }
  }, [rememberKnownAccount]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshMe();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshMe]);

  useEffect(() => {
    if (status === 'loading') return;
    setAgentChatAccountScope(user ? accountIdForUser(user) : null);
  }, [status, user?.id, user?.username, user?.email]);

  const login = useCallback(async (payload: AuthCredentials) => {
    const responsePayload = await postAuth('/api/auth/login', payload);
    const nextUser = readUserFromResponse(responsePayload) || (await refreshMe());
    clearAnonymousPersonaTrialFlag();
    setUser(nextUser);
    setStatus(nextUser ? 'authenticated' : 'anonymous');
    rememberKnownAccount(nextUser);
    return nextUser;
  }, [refreshMe, rememberKnownAccount]);

  const register = useCallback(async (payload: AuthCredentials) => {
    const responsePayload = await postAuth('/api/auth/register', payload);
    const nextUser = readUserFromResponse(responsePayload) || (await refreshMe());
    clearAnonymousPersonaTrialFlag();
    setUser(nextUser);
    setStatus(nextUser ? 'authenticated' : 'anonymous');
    rememberKnownAccount(nextUser);
    return nextUser;
  }, [refreshMe, rememberKnownAccount]);

  const switchKnownAccount = useCallback(async (accountId: string) => {
    const responsePayload = await postAuth('/api/auth/switch', { user_id: accountId });
    const nextUser = readUserFromResponse(responsePayload) || (await refreshMe());
    clearAnonymousPersonaTrialFlag();
    setUser(nextUser);
    setStatus(nextUser ? 'authenticated' : 'anonymous');
    rememberKnownAccount(nextUser);
    return nextUser;
  }, [refreshMe, rememberKnownAccount]);

  const logout = useCallback(async () => {
    try {
      await postAuth('/api/auth/logout');
    } catch (error) {
      console.error('Auth logout failed', error);
    } finally {
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem(SKIP_UNLOCK_ONCE_STORAGE_KEY, '1');
      }
      clearAnonymousPersonaTrialFlag();
      setUser(null);
      setStatus('anonymous');
    }
  }, []);

  const updateProfile = useCallback(async (payload: AuthProfileUpdate) => {
    const responsePayload = await patchAuth('/api/auth/profile', payload);
    const nextUser = readUserFromResponse(responsePayload) || (await refreshMe());
    setUser(nextUser);
    setStatus(nextUser ? 'authenticated' : 'anonymous');
    rememberKnownAccount(nextUser);
    return nextUser;
  }, [refreshMe, rememberKnownAccount]);

  const deleteAccount = useCallback(async () => {
    const currentUser = user;
    await deleteAuth('/api/auth/me');
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(SKIP_UNLOCK_ONCE_STORAGE_KEY, '1');
    }
    if (currentUser) {
      const id = accountIdForUser(currentUser);
      if (id) {
        clearAgentChatScopeData(id);
        setKnownAccounts((current) => {
          const next = current.filter((account) => account.id !== id);
          writeKnownAccounts(next);
          return next;
        });
      }
    }
    clearAnonymousPersonaTrialFlag();
    setUser(null);
    setStatus('anonymous');
  }, [user]);

  const openAuthDialog = useCallback((overrides: Partial<AuthDialogState> = {}) => {
    setAuthDialog({
      ...DEFAULT_AUTH_DIALOG_STATE,
      ...overrides,
      open: true,
      mode: overrides.mode ?? 'login',
    });
  }, []);

  const closeAuthDialog = useCallback(() => {
    setAuthDialog((current) => ({ ...current, open: false }));
  }, []);

  const setAuthDialogMode = useCallback((mode: AuthDialogMode) => {
    setAuthDialog((current) => ({ ...current, open: true, mode }));
  }, []);

  const openUnlockDialog = useCallback((overrides: Partial<UnlockDialogState> = {}) => {
    setUnlockDialog({
      ...DEFAULT_UNLOCK_DIALOG_STATE,
      ...overrides,
      descriptionLines:
        overrides.descriptionLines && overrides.descriptionLines.length > 0
          ? overrides.descriptionLines
          : DEFAULT_UNLOCK_DIALOG_STATE.descriptionLines,
      open: true,
    });
  }, []);

  const closeUnlockDialog = useCallback(() => {
    setUnlockDialog((current) => ({ ...current, open: false }));
  }, []);

  const openRegisterSuccessDialog = useCallback((overrides: Partial<RegisterSuccessDialogState> = {}) => {
    setRegisterSuccessDialog({
      ...DEFAULT_REGISTER_SUCCESS_DIALOG_STATE,
      ...overrides,
      open: true,
    });
  }, []);

  const closeRegisterSuccessDialog = useCallback(() => {
    setRegisterSuccessDialog((current) => ({ ...current, open: false }));
  }, []);

  const value = useMemo(
    () => ({
      user,
      status,
      isAuthenticated: status === 'authenticated',
      knownAccounts,
      authDialog,
      unlockDialog,
      registerSuccessDialog,
      refreshMe,
      login,
      register,
      switchKnownAccount,
      logout,
      updateProfile,
      deleteAccount,
      removeKnownAccount,
      openAuthDialog,
      closeAuthDialog,
      setAuthDialogMode,
      openUnlockDialog,
      closeUnlockDialog,
      openRegisterSuccessDialog,
      closeRegisterSuccessDialog,
    }),
    [
      authDialog,
      closeAuthDialog,
      closeUnlockDialog,
      closeRegisterSuccessDialog,
      login,
      logout,
      updateProfile,
      deleteAccount,
      removeKnownAccount,
      knownAccounts,
      openAuthDialog,
      openUnlockDialog,
      openRegisterSuccessDialog,
      refreshMe,
      register,
      switchKnownAccount,
      setAuthDialogMode,
      status,
      registerSuccessDialog,
      unlockDialog,
      user,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
