'use client';

import { useEffect, useRef } from 'react';
import { useAppState } from '@/context/AppStateContext';
import { useAuth } from '@/context/AuthContext';
import { PERSONA_STORAGE_KEY } from '@/lib/persona';
import { clearAgentChatScopeData } from '@/lib/agent-chat-store';

const SESSION_KEYS_TO_CLEAR = [
  'koc-agent-profile-chat-state',
  'koc-agent-profile-form-draft',
  'koc-agent-trending-chat-state',
  'koc-agent-trending-chat-scroll-top',
  'koc-agent-trending-view-mode',
  'koc-agent-content-chat-state',
  'koc-agent-content-chat-scroll-top',
  'koc-agent-content-view-mode',
  'koc-agent-active-draft-id',
  'koc-agent-selected-persona',
];

export default function AuthStateBridge() {
  const { status } = useAuth();
  const { dispatch } = useAppState();
  const previousStatusRef = useRef(status);

  useEffect(() => {
    const previousStatus = previousStatusRef.current;
    previousStatusRef.current = status;
    if (status === 'anonymous') {
      clearAgentChatScopeData(null);
    }
    if (previousStatus !== 'authenticated' || status !== 'anonymous') return;

    dispatch({ type: 'CLEAR_PERSONA' });
    window.localStorage.removeItem(PERSONA_STORAGE_KEY);
    SESSION_KEYS_TO_CLEAR.forEach((key) => window.sessionStorage.removeItem(key));
  }, [dispatch, status]);

  return null;
}
