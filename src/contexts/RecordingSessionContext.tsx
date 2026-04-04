import React, { createContext, useCallback, useContext, useMemo, useState, useEffect } from 'react';
import type { TranscriptItem } from '../types';

/** Legacy key — cleared on load so F5 does not restore transcript (in-memory only for SPA navigation). */
const LEGACY_STORAGE_KEY = 'sonic_lens_recording_draft_meta_v1';

export interface RecordingDraftSnapshot {
  fullTranscript: TranscriptItem[];
  sessionSummary: string;
  newRecordingTitle: string;
  recordingSource: 'live' | 'upload';
  modelIndicators: [number, string][];
  finalAudioBlob: Blob | null;
  transcriptError: string | null;
  currentTranscript: string;
  duration: number;
  saveStatus: 'idle' | 'saving' | 'success' | 'error';
  isGeneratingSummary: boolean;
}

function emptySnapshot(): RecordingDraftSnapshot {
  return {
    fullTranscript: [],
    sessionSummary: '',
    newRecordingTitle: '',
    recordingSource: 'live',
    modelIndicators: [],
    finalAudioBlob: null,
    transcriptError: null,
    currentTranscript: '',
    duration: 0,
    saveStatus: 'idle',
    isGeneratingSummary: false,
  };
}

function clearLegacySessionStorage() {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

type RecordingSessionContextValue = {
  getDraft: () => RecordingDraftSnapshot | null;
  patchDraft: (p: Partial<RecordingDraftSnapshot>) => void;
  clearDraft: () => void;
};

const RecordingSessionContext = createContext<RecordingSessionContextValue | null>(null);

export function RecordingSessionProvider({ children }: { children: React.ReactNode }) {
  const [draft, setDraft] = useState<RecordingDraftSnapshot | null>(null);

  useEffect(() => {
    clearLegacySessionStorage();
  }, []);

  const getDraft = useCallback(() => draft, [draft]);

  const patchDraft = useCallback((p: Partial<RecordingDraftSnapshot>) => {
    setDraft((prev) => {
      const base = prev ?? emptySnapshot();
      return { ...base, ...p };
    });
  }, []);

  const clearDraft = useCallback(() => {
    setDraft(null);
    clearLegacySessionStorage();
  }, []);

  const value = useMemo(
    () => ({
      getDraft,
      patchDraft,
      clearDraft,
    }),
    [getDraft, patchDraft, clearDraft],
  );

  return <RecordingSessionContext.Provider value={value}>{children}</RecordingSessionContext.Provider>;
}

export function useRecordingDraft() {
  const ctx = useContext(RecordingSessionContext);
  if (!ctx) {
    throw new Error('useRecordingDraft must be used within RecordingSessionProvider');
  }
  return ctx;
}
