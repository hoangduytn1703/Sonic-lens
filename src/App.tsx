import React, { useState, useEffect, useRef, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useNavigate, useLocation } from 'react-router-dom';
import { Mic, Settings, User, Play, Square, Pause, Trash2, Star, ChevronRight, ChevronLeft, ChevronUp, LogOut, LayoutDashboard, ShieldCheck, Download, Share2, Search, MoreVertical, Upload, Edit3, FileText, Save, RotateCcw, Key, ExternalLink, Eye, EyeOff, CheckCircle2, AlertCircle, Lock, Info, Loader2, GripVertical, Sparkles, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import { saveAs } from 'file-saver';
import { cn, formatDuration } from './lib/utils';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import { transcribeAudio } from './services/transcribe';
import { resetProviderBlacklist } from './services/transcribe';
import { Recording, TranscriptItem } from './types';
import { getAIConfig, saveAIConfig, isProviderEnabled, providerHasCredentials, getProviderPriority, type AIProvider, OPENAI_API_KEYS_URL, GEMINI_API_KEYS_URL, GROQ_API_KEYS_URL, CLAUDE_API_KEYS_URL, NVIDIA_NIM_EXPLORE_URL } from './lib/aiConfig';
import { GoTopButton } from './components/GoTopButton';
import { AiSummaryBlock } from './components/AiSummaryBlock';
import { generateFinalSummary } from './lib/generateSummary';

const PROVIDER_ORDER_LABELS: Record<AIProvider, string> = {
  gemini: 'Gemini',
  nvidiaNim: 'NVIDIA NIM',
  groq: 'Groq',
  openai: 'OpenAI',
  claude: 'Claude',
};

// --- Components ---

// Parse "mm:ss" or "hh:mm:ss" timestamp string to seconds
function parseTimestamp(ts: string): number {
  if (!ts) return 0;
  const parts = ts.trim().split(':').map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

// Reusable audio player + synced transcript component
interface SyncedTranscriptPlayerProps {
  audioSrc: string;
  transcript: TranscriptItem[];
  modelIndicators?: Map<number, string>;
}

const SyncedTranscriptPlayer = ({ audioSrc, transcript, modelIndicators }: SyncedTranscriptPlayerProps) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const transcriptScrollRef = useRef<HTMLDivElement>(null);
  const [showTranscriptScrollTop, setShowTranscriptScrollTop] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [activeIdx, setActiveIdx] = useState<number>(-1);
  const activeItemRef = useRef<HTMLDivElement>(null);

  // Build a lookup: each item has a start time (from timestamp) and end time (next item's timestamp)
  const timeMap = transcript.map((item, idx) => ({
    idx,
    start: parseTimestamp(item.timestamp),
    end: idx + 1 < transcript.length ? parseTimestamp(transcript[idx + 1].timestamp) : Infinity,
  }));

  const handleTimeUpdate = useCallback(() => {
    if (!audioRef.current || transcript.length === 0) return;
    const t = audioRef.current.currentTime;
    setCurrentTime(t);

    // Find the segment that covers this time
    // We want the HIGHEST index where segment.start <= t
    let foundIdx = -1;
    for (let i = 0; i < timeMap.length; i++) {
      if (t >= timeMap[i].start) {
        foundIdx = i;
      } else {
        // Since segments are chronological, if t < current segment.start, 
        // we've passed the active one
        break;
      }
    }
    setActiveIdx(foundIdx);
  }, [timeMap]);

  // Auto-scroll the active item into view
  useEffect(() => {
    if (activeItemRef.current && audioRef.current && !audioRef.current.paused) {
      activeItemRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activeIdx]);

  const seekTo = (ts: string) => {
    if (!audioRef.current) return;
    const seconds = parseTimestamp(ts);
    audioRef.current.currentTime = seconds;
    audioRef.current.play();
  };

  return (
    <div className="space-y-4">
      {/* Synced Audio Player */}
      <div className="bg-surface-container-low p-3 rounded-xl border border-outline-variant/10">
        <audio
          ref={audioRef}
          controls
          src={audioSrc}
          onTimeUpdate={handleTimeUpdate}
          className="w-full h-10 cursor-pointer"
        />
        {transcript.length > 0 && (
          <p className="text-[10px] text-on-surface-variant mt-1.5 text-center opacity-50">
            Click vao doan transcript de nhay den vi tri tuong ung trong audio
          </p>
        )}
      </div>

      {/* Synced Transcript — max height 1.5× previous (600px → 900px) */}
      {transcript.length > 0 && (
        <div className="relative">
          <div
            ref={transcriptScrollRef}
            onScroll={() => {
              const el = transcriptScrollRef.current;
              setShowTranscriptScrollTop(!!el && el.scrollTop > 100);
            }}
            className="max-h-[900px] space-y-1.5 overflow-y-auto pr-2"
          >
          {transcript.map((item, idx) => {
            const isActive = idx === activeIdx;
            return (
              <React.Fragment key={idx}>
                {/* Model indicator badge */}
                {modelIndicators?.has(idx) && (
                  <div className="flex items-center gap-2 py-1.5">
                    <div className="flex-1 h-px bg-outline-variant/15" />
                    <span className={cn(
                      "text-[9px] px-2.5 py-1 rounded-full font-bold uppercase tracking-wider flex items-center gap-1.5 border",
                      modelIndicators.get(idx) === 'gemini' ? "bg-primary/5 text-primary border-primary/20" :
                      modelIndicators.get(idx) === 'groq' ? "bg-[#f55036]/5 text-[#f55036] border-[#f55036]/20" :
                      modelIndicators.get(idx) === 'openai' ? "bg-[#10a37f]/5 text-[#10a37f] border-[#10a37f]/20" :
                      modelIndicators.get(idx) === 'claude' ? "bg-[#d97706]/5 text-[#d97706] border-[#d97706]/20" :
                      "bg-surface-container text-on-surface-variant border-outline-variant/20"
                    )}>
                      <span className="w-1.5 h-1.5 rounded-full bg-current" />
                      {modelIndicators.get(idx)}
                    </span>
                    <div className="flex-1 h-px bg-outline-variant/15" />
                  </div>
                )}
                <div
                  ref={isActive ? activeItemRef : null}
                  onClick={() => seekTo(item.timestamp)}
                  className={cn(
                    "flex gap-3 p-3 rounded-xl cursor-pointer transition-all duration-300 group",
                    isActive
                      ? "bg-primary/8 border border-primary/20 shadow-sm"
                      : "hover:bg-surface-container-low border border-transparent"
                  )}
                >
                  {/* Timestamp + play indicator */}
                  <div className="w-10 shrink-0 pt-0.5">
                    <span className={cn(
                      "block rounded-md py-0.5 text-center font-mono text-[9px] leading-tight transition-all",
                      isActive
                        ? "bg-primary text-white font-bold"
                        : "text-on-surface-variant opacity-40 group-hover:opacity-70"
                    )}>
                      {item.timestamp}
                    </span>
                  </div>
                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={cn(
                        "px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider",
                        item.gender === 'Nam' ? "bg-blue-100 text-blue-700" :
                        item.gender === 'Nữ' ? "bg-pink-100 text-pink-700" :
                        "bg-surface-container-highest text-on-surface-variant"
                      )}>
                        {item.speaker}{item.gender ? ` • ${item.gender}` : ''}
                      </span>
                      {isActive && (
                        <span className="text-[9px] text-primary font-bold uppercase tracking-wider animate-pulse">
                          dang phat
                        </span>
                      )}
                    </div>
                    <p className={cn(
                      "text-base leading-relaxed font-body transition-all",
                      isActive ? "text-on-surface font-medium" :
                      item.isUncertain ? "text-error font-medium italic opacity-80" :
                      "text-on-surface-variant"
                    )}>
                      {item.text}
                      {item.isUncertain && (
                        <span className="ml-2 inline-flex items-center gap-1 text-[9px] bg-error/10 text-error px-1.5 py-0.5 rounded border border-error/20 not-italic font-bold uppercase tracking-tighter">
                          AI khong chac chan
                        </span>
                      )}
                    </p>
                  </div>
                </div>
              </React.Fragment>
            );
          })}
          </div>
          {showTranscriptScrollTop && (
            <button
              type="button"
              aria-label="Len dau transcript"
              onClick={() => transcriptScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
              className="absolute bottom-2 right-2 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-primary text-white shadow-md shadow-primary/30 ring-2 ring-white/40 transition hover:scale-105"
            >
              <ChevronUp className="h-5 w-5" strokeWidth={2.5} />
            </button>
          )}
        </div>
      )}
    </div>
  );
};

const Navbar = () => {
  const location = useLocation();
  const isAdmin = location.pathname.startsWith('/admin');

  return (
    <header className="bg-surface fixed top-0 left-0 right-0 z-50 border-b border-surface-container-low">
      <div className="flex justify-between items-center px-8 py-4 w-full max-w-full mx-auto">
        <div className="flex items-center gap-8">
          <Link to="/" className="cursor-pointer text-2xl font-black tracking-tighter text-primary font-headline">Sonic Lens</Link>
          <nav className="hidden md:flex gap-6 items-center">
            <Link
              to="/"
              className={cn(
                "cursor-pointer font-headline tracking-tight transition-colors duration-200",
                !isAdmin ? "text-primary font-bold border-b-2 border-primary" : "text-on-surface-variant font-medium hover:text-primary"
              )}
            >
              Dashboard
            </Link>
            <Link
              to="/admin"
              className={cn(
                "cursor-pointer font-headline tracking-tight transition-colors duration-200",
                isAdmin ? "text-primary font-bold border-b-2 border-primary" : "text-on-surface-variant font-medium hover:text-primary"
              )}
            >
              Admin
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          {/* Removed 3 icons as requested */}
        </div>
      </div>
    </header>
  );
};

// --- Pages ---

// Parse raw API errors into friendly Vietnamese messages
function parseFriendlyError(raw: string): string {
  const lower = raw.toLowerCase();

  if (lower.includes('429') || lower.includes('rate limit') || lower.includes('quota') || lower.includes('resource_exhausted') || lower.includes('exceeded')) {
    return 'Da het gioi han su dung AI (rate limit/quota). Vui long doi vai phut hoac chuyen sang model khac trong Admin > API Settings.';
  }
  if (lower.includes('too large') || lower.includes('payload') || lower.includes('content-length') || lower.includes('request entity')) {
    return 'File am thanh qua lon. Thu ghi am ngan hon hoac bat che do Multi-Model de tu dong chia nho file.';
  }
  if (lower.includes('missing') && lower.includes('key')) {
    return 'Chua cau hinh API Key. Vui long vao Admin > API Settings de them key.';
  }
  if (lower.includes('unauthorized') || lower.includes('401') || lower.includes('invalid') && lower.includes('key')) {
    return 'API Key khong hop le hoac da het han. Vui long kiem tra lai key trong Admin > API Settings.';
  }
  if (lower.includes('network') || lower.includes('fetch') || lower.includes('failed to fetch') || lower.includes('cors') || lower.includes('load failed')) {
    return 'Khong goi duoc API (mang hoac trinh duyet chan CORS). Voi NVIDIA NIM: can proxy /nvidia-nim-api tren server (giong npm run dev), hoac chay npm run serve:prod sau build, hoac dat VITE_NVIDIA_NIM_CHAT_URL. Kiem tra API key tren build.nvidia.com.';
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return 'Yeu cau qua thoi gian cho. Thu ghi am ngan hon hoac chon model nhanh hon (Groq).';
  }
  if (lower.includes('all ai providers failed')) {
    return 'Tat ca cac AI model deu that bai. Vui long kiem tra API key hoac thu lai sau vai phut.';
  }
  if (lower.includes('no whisper') || lower.includes('no stt')) {
    return 'Khong co dich vu chuyen giong noi. Vui long them Groq API Key (mien phi) trong Admin > API Settings.';
  }

  // Default: clean up the message
  if (raw.length > 200) {
    return 'Da xay ra loi khi xu ly am thanh. Vui long thu lai hoac kiem tra cau hinh AI trong Admin.';
  }
  return raw;
}

const Dashboard = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [duration, setDuration] = useState(0);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [processingCount, setProcessingCount] = useState(0);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const isProcessing = processingCount > 0 || isFinalizing;
  const [currentTranscript, setCurrentTranscript] = useState<string>("");
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [fullTranscript, setFullTranscript] = useState<TranscriptItem[]>([]);
  const [lastAudioUrl, setLastAudioUrl] = useState<string | null>(null);
  const [finalAudioBlob, setFinalAudioBlob] = useState<Blob | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [isNamingModalOpen, setIsNamingModalOpen] = useState(false);
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [recordingSource, setRecordingSource] = useState<'live' | 'upload'>('live');
  const [namingError, setNamingError] = useState("");
  const [newRecordingTitle, setNewRecordingTitle] = useState("");
  const [renderToast, setRenderToast] = useState<{ variant: 'success' | 'error' | 'info'; message: string } | null>(null);
  const renderCompletionToastShownRef = useRef(false);
  const transcriptPanelRef = useRef<HTMLElement | null>(null);
  const liveTranscriptScrollRef = useRef<HTMLDivElement>(null);
  const [showLiveTranscriptGoTop, setShowLiveTranscriptGoTop] = useState(false);
  const recordingResultCardRef = useRef<HTMLDivElement | null>(null);
  const recordingSourceRef = useRef(recordingSource);
  const fullTranscriptRef = useRef<TranscriptItem[]>(fullTranscript);
  const fullTranscriptLengthRef = useRef(fullTranscript.length);
  recordingSourceRef.current = recordingSource;
  fullTranscriptRef.current = fullTranscript;
  fullTranscriptLengthRef.current = fullTranscript.length;
  const allBlobsRef = useRef<Blob[]>([]);
  const isWaitingForFinalBlobRef = useRef(false);
  const [sessionSummary, setSessionSummary] = useState('');
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const autoChunkTimerRef = useRef<any>(null);
  const isAutoChunkingRef = useRef(false);
  const lastUsedProviderRef = useRef<string | null>(null);
  const chunkStartTimeRef = useRef<number>(0);

  // UI-only model indicators: maps transcript index to provider name
  // These are NOT saved to DB or exported
  const [modelIndicators, setModelIndicators] = useState<Map<number, string>>(new Map());

  // Auto-chunk interval in milliseconds (2 minutes - keeps WAV under 15MB)
  const AUTO_CHUNK_INTERVAL = 2 * 60 * 1000;
  // Max chunk duration in seconds for file splitting
  const MAX_CHUNK_SECONDS = 2 * 60;

  useEffect(() => {
    if (!renderToast) return;
    const t = window.setTimeout(() => setRenderToast(null), 5000);
    return () => window.clearTimeout(t);
  }, [renderToast]);

  // Toast when AI finished (success or error); user saves manually via "Luu ban ghi"
  useEffect(() => {
    if (isRecording || isFinalizing || isProcessing || !lastAudioUrl) return;
    if (renderCompletionToastShownRef.current) return;
    renderCompletionToastShownRef.current = true;
    if (transcriptError) {
      setRenderToast({ variant: 'error', message: transcriptError });
    } else {
      setRenderToast({
        variant: 'success',
        message:
          'Đã xử lý xong, vui lòng review trước khi thao tác (lưu, xuất file, hủy bỏ)',
      });
    }

    const scrollToResults = () => {
      const uploadWithTranscript =
        recordingSourceRef.current === 'upload' &&
        fullTranscriptLengthRef.current > 0;
      const el = uploadWithTranscript
        ? recordingResultCardRef.current
        : transcriptPanelRef.current;
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    window.setTimeout(scrollToResults, 200);
  }, [isRecording, isFinalizing, isProcessing, lastAudioUrl, transcriptError]);

  const resetRecording = () => {
    setCurrentTranscript("");
    setFullTranscript([]);
    setLastAudioUrl(null);
    setFinalAudioBlob(null);
    setDuration(0);
    setSaveStatus('idle');
    setNewRecordingTitle("");
    setNamingError("");
    setRenderToast(null);
    renderCompletionToastShownRef.current = false;
    allBlobsRef.current = [];
    setSessionSummary('');
    setIsGeneratingSummary(false);
    setIsResetModalOpen(false);
  };

  const saveToSupabase = async (customTitle?: string) => {
    if (!isSupabaseConfigured) {
      console.warn("Supabase chưa được cấu hình. Vui lòng kiểm tra API Key.");
      return;
    }

    const blobToSave = finalAudioBlob || (allBlobsRef.current.length > 0 ? allBlobsRef.current[0] : null);
    if (!blobToSave) {
      console.error("Không có dữ liệu âm thanh để lưu.");
      return;
    }

    const titleToSave = customTitle || `Meeting ${format(new Date(), 'yyyy-MM-dd HH:mm')}`;
    setNamingError("");

    // Kiểm tra trùng tên
    const { data: existing } = await supabase
      .from('recordings')
      .select('id')
      .eq('title', titleToSave)
      .maybeSingle();

    if (existing) {
      setNamingError("Tên bản ghi đã tồn tại. Vui lòng chọn tên khác.");
      setIsNamingModalOpen(true);
      return;
    }

    setSaveStatus('saving');
    try {
      // Xác định extension dựa trên mimeType
      let extension = 'webm';
      if (blobToSave.type.includes('wav')) extension = 'wav';
      else if (blobToSave.type.includes('mp4')) extension = 'mp4';
      else if (blobToSave.type.includes('mpeg')) extension = 'mp3';
      else if (blobToSave.type.includes('m4a')) extension = 'm4a';

      const fileName = `recording_${Date.now()}.${extension}`;

      console.log(`Đang lưu bản ghi (${blobToSave.size} bytes)...`);

      const { error: uploadError } = await supabase.storage
        .from('recordings')
        .upload(fileName, blobToSave);

      if (uploadError) throw new Error(`Lỗi upload Storage: ${uploadError.message}`);

      const { data: { publicUrl } } = supabase.storage
        .from('recordings')
        .getPublicUrl(fileName);

      const { error: dbError } = await supabase.from('recordings').insert({
        title: titleToSave,
        audio_url: publicUrl,
        transcript: fullTranscript,
        summary: sessionSummary,
        duration: duration,
        is_important: false,
        source: recordingSource
      });

      if (dbError) {
        console.error("Chi tiết lỗi Database:", dbError);
        throw new Error(`Lỗi lưu Database: ${dbError.message}`);
      }

      console.log("Đã lưu vào Supabase thành công!");
      setSaveStatus('success');
      setNamingError("");
      setIsNamingModalOpen(false);
      setRenderToast({
        variant: 'info',
        message:
          'Đã lưu thành công. Bạn có thể vào Admin > Bản ghi âm để xem lại transcript và tóm tắt AI.',
      });
      // Reset status after a while
      setTimeout(() => setSaveStatus('idle'), 5000);
    } catch (storageErr: any) {
      console.error("Lỗi Supabase khi lưu bản ghi:", storageErr);
      setSaveStatus('error');
    }
  };

  const exportToWord = (title: string, transcript: TranscriptItem[]) => {
    const doc = new Document({
      sections: [{
        properties: {},
        children: [
          new Paragraph({
            children: [
              new TextRun({
                text: `Transcript: ${title}`,
                bold: true,
                size: 32,
              }),
            ],
          }),
          new Paragraph({ text: "" }),
          ...transcript.map(item => new Paragraph({
            children: [
              new TextRun({
                text: `[${item.timestamp}] ${item.speaker} (${item.gender}): `,
                bold: true,
              }),
              new TextRun({
                text: item.text,
              }),
            ],
          })),
        ],
      }],
    });

    Packer.toBlob(doc).then(blob => {
      saveAs(blob, `${title}.docx`);
    });
  };

  useEffect(() => {
    let interval: any;
    if (isRecording && !isPaused) {
      interval = setInterval(() => {
        setDuration(prev => prev + 1);
      }, 1000);
    } else {
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [isRecording, isPaused]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      allBlobsRef.current = [];
      setFinalAudioBlob(null);
      isWaitingForFinalBlobRef.current = false;
      isAutoChunkingRef.current = false;
      setSessionSummary('');
      setIsGeneratingSummary(false);
      setFullTranscript([]);
      setModelIndicators(new Map());
      lastUsedProviderRef.current = null;
      setProcessingCount(0);
      setTranscriptError(null);
      setSaveStatus('idle');
      renderCompletionToastShownRef.current = false;

      setupRecorder(recorder);

      recorder.start();
      setMediaRecorder(recorder);
      setIsRecording(true);
      setIsPaused(false);
      setDuration(0);
      setRecordingSource('live'); // It's a live recording
      chunkStartTimeRef.current = 0;
      setCurrentTranscript("");
      setLastAudioUrl(null);

      // Start auto-chunk timer: every 5 minutes, stop current recorder
      // and start a new one to process the chunk
      startAutoChunkTimer(recorder);
    } catch (err) {
      console.error("Error accessing microphone:", err);
      alert("Khong the truy cap microphone. Vui long kiem tra quyen truy cap.");
    }
  };

  const startAutoChunkTimer = (initialRecorder?: MediaRecorder) => {
    clearAutoChunkTimer();
    autoChunkTimerRef.current = setInterval(() => {
      autoChunkSegment();
    }, AUTO_CHUNK_INTERVAL);
    console.log(`[Auto-Chunk] Timer started: every ${AUTO_CHUNK_INTERVAL / 1000}s`);
  };

  const clearAutoChunkTimer = () => {
    if (autoChunkTimerRef.current) {
      clearInterval(autoChunkTimerRef.current);
      autoChunkTimerRef.current = null;
    }
  };

  // Auto-chunk: stop current recorder to flush audio, then immediately start a new segment
  const autoChunkSegment = () => {
    // Access the latest mediaRecorder from DOM state via a workaround
    // We set a flag so setupRecorder knows to auto-restart
    isAutoChunkingRef.current = true;
    // We need to get current recorder - use a callback pattern
    setMediaRecorder(prev => {
      if (prev && prev.state === 'recording') {
        console.log('[Auto-Chunk] Stopping current segment for processing...');
        chunkStartTimeRef.current = duration; // The NEW chunk will start from current total duration
        prev.stop(); // This triggers onstop -> handleSegmentTranscription + auto-restart
      }
      return prev;
    });
  };

  const finalizeRecording = async () => {
    if (allBlobsRef.current.length > 0) {
      setIsFinalizing(true);
      try {
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const audioBuffers: AudioBuffer[] = [];

        for (const blob of allBlobsRef.current) {
          const arrayBuffer = await blob.arrayBuffer();
          try {
            const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
            audioBuffers.push(audioBuffer);
          } catch (e) {
            console.error("Error decoding audio segment:", e);
          }
        }

        if (audioBuffers.length > 0) {
          // Merge buffers
          const totalLength = audioBuffers.reduce((acc, buf) => acc + buf.length, 0);
          const mergedBuffer = audioCtx.createBuffer(
            audioBuffers[0].numberOfChannels,
            totalLength,
            audioBuffers[0].sampleRate
          );

          let offset = 0;
          for (const buf of audioBuffers) {
            for (let channel = 0; channel < buf.numberOfChannels; channel++) {
              mergedBuffer.getChannelData(channel).set(buf.getChannelData(channel), offset);
            }
            offset += buf.length;
          }

          // Convert to WAV
          const wavBlob = bufferToWav(mergedBuffer);
          setFinalAudioBlob(wavBlob);
          const url = URL.createObjectURL(wavBlob);
          setLastAudioUrl(url);
          setNewRecordingTitle(`Meeting ${format(new Date(), 'yyyy-MM-dd HH:mm')}`);
          console.log(`Ghi âm hoàn tất. Đã hợp nhất ${audioBuffers.length} đoạn thành file WAV.`);

          // Generate summary from complete transcript (use ref to get latest value)
          console.log('[finalizeRecording] Generating final summary...');
          setIsGeneratingSummary(true);
          try {
            const summary = await generateFinalSummary(fullTranscriptRef.current);
            setSessionSummary(summary);
            if (summary) {
              console.log('[finalizeRecording] Summary generated successfully');
            }
          } finally {
            setIsGeneratingSummary(false);
          }
        }
      } catch (err) {
        console.error("Error finalizing recording:", err);
      } finally {
        setIsFinalizing(false);
      }
    }
    isWaitingForFinalBlobRef.current = false;
  };

  // Helper function to convert AudioBuffer to WAV blob
  const bufferToWav = (abuffer: AudioBuffer) => {
    const numOfChan = abuffer.numberOfChannels;
    const length = abuffer.length * numOfChan * 2 + 44;
    const buffer = new ArrayBuffer(length);
    const view = new DataView(buffer);
    const channels = [];
    let i;
    let sample;
    let offset = 0;
    let pos = 0;

    // write WAVE header
    setUint32(0x46464952); // "RIFF"
    setUint32(length - 8); // file length - 8
    setUint32(0x45564157); // "WAVE"

    setUint32(0x20746d66); // "fmt " chunk
    setUint32(16); // length = 16
    setUint16(1); // PCM (uncompressed)
    setUint16(numOfChan);
    setUint32(abuffer.sampleRate);
    setUint32(abuffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
    setUint16(numOfChan * 2); // block-align
    setUint16(16); // 16-bit (hardcoded in this demo)

    setUint32(0x61746164); // "data" - chunk
    setUint32(length - pos - 4); // chunk length

    // write interleaved data
    for (i = 0; i < numOfChan; i++) {
      channels.push(abuffer.getChannelData(i));
    }

    while (pos < length) {
      for (i = 0; i < numOfChan; i++) {
        // interleave channels
        sample = Math.max(-1, Math.min(1, channels[i][offset])); // clamp
        sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0; // scale to 16-bit signed int
        view.setInt16(pos, sample, true); // write 16-bit sample
        pos += 2;
      }
      offset++; // next source sample
    }

    return new Blob([buffer], { type: "audio/wav" });

    function setUint16(data: number) {
      view.setUint16(pos, data, true);
      pos += 2;
    }

    function setUint32(data: number) {
      view.setUint32(pos, data, true);
      pos += 4;
    }
  };

  const setupRecorder = (recorder: MediaRecorder) => {
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    recorder.onstop = async () => {
      const audioBlob = new Blob(chunks, { type: 'audio/webm' });
      allBlobsRef.current.push(audioBlob);
      console.log(`[Recorder] Collected segment #${allBlobsRef.current.length} (${(audioBlob.size / 1024 / 1024).toFixed(2)} MB)`);

      handleSegmentTranscription(audioBlob);

      // If this was an auto-chunk (not pause or stop), restart recording immediately
      if (isAutoChunkingRef.current) {
        isAutoChunkingRef.current = false;
        if (streamRef.current) {
          console.log('[Auto-Chunk] Starting new segment...');
          const newRecorder = new MediaRecorder(streamRef.current);
          setupRecorder(newRecorder);
          newRecorder.start();
          setMediaRecorder(newRecorder);
        }
        return;
      }

      // If this is the final segment (triggered from stopRecording)
      if (isWaitingForFinalBlobRef.current) {
        await finalizeRecording();
      }
    };
  };

  const handleSegmentTranscription = async (blob: Blob) => {
    setProcessingCount(prev => prev + 1);
    try {
      // Use the precisely tracked start time of this chunk as the offset
      const offsetSeconds = chunkStartTimeRef.current;

      const base64Audio = await blobToBase64(blob);
      const result = await transcribeAudio(base64Audio, blob.type);
      setTranscriptError(null);

      // Adjust timestamps to be relative to the total recording
      const adjustedTranscript = result.transcript.map((item: TranscriptItem) => {
        const [mins, secs] = (item.timestamp || '00:00').split(':').map(Number);
        const totalSecs = mins * 60 + secs + offsetSeconds;
        const newMins = Math.floor(totalSecs / 60);
        const newSecs = totalSecs % 60;
        return {
          ...item,
          timestamp: `${String(newMins).padStart(2, '0')}:${String(newSecs).padStart(2, '0')}`
        };
      });

      // Track model changes for UI indicator
      const usedProvider = result._usedProvider as string | undefined;
      setFullTranscript(prev => {
        const insertIndex = prev.length;
        if (usedProvider && usedProvider !== lastUsedProviderRef.current) {
          setModelIndicators(indicators => {
            const newMap = new Map(indicators);
            newMap.set(insertIndex, usedProvider);
            return newMap;
          });
          lastUsedProviderRef.current = usedProvider;
        }
        return [...prev, ...adjustedTranscript];
      });

      // Do not accumulate summary per chunk - we'll generate once at the end
    } catch (err: any) {
      console.error("Transcription error:", err);
      setTranscriptError(parseFriendlyError(err.message));
    } finally {
      setProcessingCount(prev => Math.max(0, prev - 1));
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Support .mp4, .m4a, .mp3, .wav, .mpeg
    const isAudio = file.type.startsWith('audio/');
    const isVideo = file.type.startsWith('video/') || file.name.endsWith('.mp4') || file.name.endsWith('.m4a');

    if (!isAudio && !isVideo) {
      alert("Vui long chon file am thanh hoac video (.mp3, .wav, .m4a, .mp4, ...)");
      return;
    }

    setIsFinalizing(true);
    setSaveStatus('idle');
    setTranscriptError(null);
    renderCompletionToastShownRef.current = false;
    allBlobsRef.current = [file];
    setFinalAudioBlob(file);
    setRecordingSource('upload'); // It's an uploaded file
    setSessionSummary('');
    setIsGeneratingSummary(false);
    setFullTranscript([]);
    setModelIndicators(new Map());
    lastUsedProviderRef.current = null;

    // Reset provider blacklist for fresh import
    resetProviderBlacklist();

    // Get duration of uploaded file
    const audioDuration = await getAudioDuration(file);
    setDuration(Math.round(audioDuration));
    const audioUrl = URL.createObjectURL(file);
    setLastAudioUrl(audioUrl);

    const totalChunks = Math.ceil(audioDuration / MAX_CHUNK_SECONDS);
    const isLongFile = audioDuration > MAX_CHUNK_SECONDS;

    if (isLongFile) {
      // ── CHUNKED PROCESSING for long files ──
      setCurrentTranscript(`File dai ${Math.round(audioDuration / 60)} phut. Dang chia thanh ${totalChunks} doan de xu ly...`);
      console.log(`[Chunked Import] File duration: ${Math.round(audioDuration)}s, splitting into ${totalChunks} chunks of ${MAX_CHUNK_SECONDS}s`);

      try {
        const arrayBuffer = await file.arrayBuffer();
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const fullBuffer = await audioCtx.decodeAudioData(arrayBuffer);

        const sampleRate = fullBuffer.sampleRate;
        const numChannels = fullBuffer.numberOfChannels;
        const samplesPerChunk = MAX_CHUNK_SECONDS * sampleRate;

        let allTranscripts: TranscriptItem[] = [];
        let allSummaries: string[] = [];

        for (let i = 0; i < totalChunks; i++) {
          const startSample = i * samplesPerChunk;
          const endSample = Math.min(startSample + samplesPerChunk, fullBuffer.length);
          const chunkLength = endSample - startSample;

          setCurrentTranscript(`Dang xu ly doan ${i + 1}/${totalChunks} (phut ${Math.round(startSample / sampleRate / 60)}-${Math.round(endSample / sampleRate / 60)})...`);

          // Extract chunk from full buffer
          const chunkBuffer = audioCtx.createBuffer(numChannels, chunkLength, sampleRate);
          for (let ch = 0; ch < numChannels; ch++) {
            const fullData = fullBuffer.getChannelData(ch);
            const chunkData = chunkBuffer.getChannelData(ch);
            for (let s = 0; s < chunkLength; s++) {
              chunkData[s] = fullData[startSample + s];
            }
          }

          // Convert chunk to WAV blob
          const wavBlob = bufferToWav(chunkBuffer);
          console.log(`[Chunked Import] Chunk ${i + 1}/${totalChunks}: ${(wavBlob.size / 1024 / 1024).toFixed(2)} MB`);

          // Read as base64 and transcribe
          try {
            const base64 = await blobToBase64(wavBlob);
            const result = await transcribeAudio(base64, 'audio/wav');

            // Adjust timestamps to be relative to the full file
            const offsetMinutes = Math.floor((startSample / sampleRate) / 60);
            const offsetSeconds = Math.round((startSample / sampleRate) % 60);
            const adjustedTranscript = result.transcript.map((item: TranscriptItem) => {
              // Parse existing timestamp and add offset
              const [mins, secs] = (item.timestamp || '00:00').split(':').map(Number);
              const totalSecs = (mins + offsetMinutes) * 60 + (secs + offsetSeconds);
              const newMins = Math.floor(totalSecs / 60);
              const newSecs = totalSecs % 60;
              return {
                ...item,
                timestamp: `${String(newMins).padStart(2, '0')}:${String(newSecs).padStart(2, '0')}`
              };
            });

            allTranscripts = [...allTranscripts, ...adjustedTranscript];
            if (result.summary) allSummaries.push(result.summary);

            // Track model changes for UI indicator
            const usedProvider = result._usedProvider as string | undefined;
            if (usedProvider && usedProvider !== lastUsedProviderRef.current) {
              setModelIndicators(indicators => {
                const newMap = new Map(indicators);
                newMap.set(allTranscripts.length - adjustedTranscript.length, usedProvider);
                return newMap;
              });
              lastUsedProviderRef.current = usedProvider;
            }

        // Update UI progressively
        setFullTranscript([...allTranscripts]);
          } catch (err: any) {
            // Silently log error - do NOT add to transcript
            console.warn(`[Chunked Import] Chunk ${i + 1} failed (silently skipped):`, err.message);
          }
        }

        audioCtx.close();
        if (allTranscripts.length === 0) {
          setTranscriptError('Khong tao duoc transcript tu file. Vui long kiem tra file hoac cau hinh API.');
        } else {
          console.log('[Chunked Import] Generating final summary...');
          setIsGeneratingSummary(true);
          try {
            const summary = await generateFinalSummary(allTranscripts);
            setSessionSummary(summary);
            if (summary) {
              console.log('[Chunked Import] Summary generated successfully');
            }
          } finally {
            setIsGeneratingSummary(false);
          }
        }
        setIsFinalizing(false);
        setCurrentTranscript("");

        setNewRecordingTitle(file.name.split('.')[0] || `Imported ${format(new Date(), 'yyyy-MM-dd HH:mm')}`);
        console.log(`[Chunked Import] Complete! ${totalChunks} chunks processed, ${allTranscripts.length} transcript items.`);
      } catch (err: any) {
        console.error("[Chunked Import] Error:", err);
        setCurrentTranscript(`[Loi xu ly file: ${err.message}]`);
        setIsFinalizing(false);
      }
    } else {
      // ── DIRECT PROCESSING for short files (< 5 min) ──
      setCurrentTranscript("Dang tai file va phan tich noi dung...");
      try {
        const base64Audio = await blobToBase64(file);
        const result = await transcribeAudio(base64Audio, file.type || 'audio/mp4');

        setFullTranscript(result.transcript);
        console.log('[Direct Import] Generating final summary...');
        setIsGeneratingSummary(true);
        try {
          const summary = await generateFinalSummary(result.transcript);
          setSessionSummary(summary);
          if (summary) {
            console.log('[Direct Import] Summary generated successfully');
          }
        } finally {
          setIsGeneratingSummary(false);
        }
        setIsFinalizing(false);
        setCurrentTranscript("");

        setNewRecordingTitle(file.name.split('.')[0] || `Imported ${format(new Date(), 'yyyy-MM-dd HH:mm')}`);
        console.log("Import file completed.");
      } catch (err: any) {
        setTranscriptError(parseFriendlyError(err.message));
        setCurrentTranscript("");
        setIsFinalizing(false);
      }
    }
  };

  // Helper: get audio duration from file
  const getAudioDuration = (file: File): Promise<number> => {
    return new Promise((resolve) => {
      const audio = new Audio();
      audio.src = URL.createObjectURL(file);
      audio.onloadedmetadata = () => {
        resolve(audio.duration);
        URL.revokeObjectURL(audio.src);
      };
      audio.onerror = () => resolve(0);
    });
  };

  // Helper: convert Blob to base64 string (without data URL prefix)
  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(blob);
      reader.onloadend = () => {
        const base64 = (reader.result as string).split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
    });
  };

  const pauseRecording = () => {
    if (mediaRecorder && isRecording && !isPaused) {
      clearAutoChunkTimer();
      setIsPaused(true);
      mediaRecorder.stop();
    }
  };

  const resumeRecording = () => {
    if (isRecording && isPaused) {
      setIsPaused(false);
      startNewSegment();
      startAutoChunkTimer();
    }
  };

  const startNewSegment = () => {
    if (!streamRef.current) return;
    try {
      const recorder = new MediaRecorder(streamRef.current);
      setupRecorder(recorder);
      recorder.start();
      setMediaRecorder(recorder);
    } catch (err) {
      console.error("Error resuming microphone:", err);
    }
  };

  const stopRecording = async () => {
    if (mediaRecorder && isRecording) {
      clearAutoChunkTimer();
      const currentRecorder = mediaRecorder;

      setIsRecording(false);
      setIsPaused(false);

      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }

      if (currentRecorder.state !== 'inactive') {
        isWaitingForFinalBlobRef.current = true;
        currentRecorder.stop();
      } else {
        // Recorder already stopped (paused state), finalize directly
        finalizeRecording();
      }
    }
  };

  return (
    <main className="flex-1 mx-auto flex w-full max-w-6xl flex-col items-center justify-center gap-16 px-[15px] pt-32 pb-12">
      <AnimatePresence>
        {renderToast && (
          <motion.div
            role="status"
            initial={{ opacity: 0, y: -24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className={cn(
              'fixed top-24 left-1/2 z-[110] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 rounded-2xl border px-5 py-4 shadow-2xl font-body text-sm font-semibold leading-snug',
              renderToast.variant === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                : renderToast.variant === 'info'
                  ? 'bg-sky-50 border-sky-200 text-sky-950'
                  : 'bg-error text-white border-error',
            )}
          >
            <div className="flex items-start gap-3">
              {renderToast.variant === 'success' ? (
                <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-600 mt-0.5" />
              ) : renderToast.variant === 'info' ? (
                <Info className="w-5 h-5 shrink-0 text-sky-600 mt-0.5" />
              ) : (
                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              )}
              <span>{renderToast.message}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Naming Modal */}
      <AnimatePresence>
        {isNamingModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-surface p-8 rounded-2xl shadow-2xl w-full max-w-md border border-surface-container-low"
            >
              <h3 className="text-2xl font-black mb-6 font-headline tracking-tighter text-on-surface">Save Recording</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-bold text-on-surface-variant mb-2 uppercase tracking-widest">Recording Title</label>
                  <input
                    type="text"
                    value={newRecordingTitle}
                    onChange={(e) => {
                      setNewRecordingTitle(e.target.value);
                      if (namingError) setNamingError("");
                    }}
                    className={cn(
                      "w-full bg-surface-container-low border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 transition-all text-on-surface",
                      namingError ? "border-error focus:ring-error" : "border-surface-container-high focus:ring-primary"
                    )}
                    placeholder="Enter title..."
                  />
                  {namingError && (
                    <p className="mt-2 text-xs font-bold text-error uppercase tracking-wider animate-shake">
                      {namingError}
                    </p>
                  )}
                </div>
                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setIsNamingModalOpen(false)}
                    className="flex-1 px-6 py-3 rounded-xl font-bold text-on-surface-variant hover:bg-surface-container-high transition-colors cursor-pointer"
                  >
                    Discard
                  </button>
                  <button
                    type="button"
                    onClick={() => saveToSupabase(newRecordingTitle)}
                    disabled={saveStatus === 'saving'}
                    className="flex-1 bg-primary text-white px-6 py-3 rounded-xl font-bold shadow-lg hover:shadow-primary/20 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {saveStatus === 'saving' ? 'Saving...' : 'Save Now'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {isResetModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-surface p-8 rounded-2xl shadow-2xl w-full max-w-md border border-surface-container-low"
            >
              <div className="bg-error/10 w-16 h-16 rounded-full flex items-center justify-center mb-6 mx-auto">
                <RotateCcw className="text-error w-8 h-8" />
              </div>
              <h3 className="text-2xl font-black mb-2 font-headline tracking-tighter text-on-surface text-center">Reset Recording?</h3>
              <p className="text-on-surface-variant text-center mb-8">
                Hành động này sẽ xóa toàn bộ dữ liệu hiện tại (transcript, audio). Bạn có chắc chắn muốn tiếp tục?
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsResetModalOpen(false)}
                  className="flex-1 px-6 py-3 rounded-xl font-bold text-on-surface-variant hover:bg-surface-container-high transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={resetRecording}
                  className="flex-1 bg-error text-white px-6 py-3 rounded-xl font-bold shadow-lg hover:shadow-error/20 transition-all cursor-pointer"
                >
                  Reset Now
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <section className="flex w-full max-w-6xl flex-col items-center gap-8">
        <div className="relative group flex w-full flex-col items-center gap-6">
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className={cn(
                "absolute inset-0 bg-primary opacity-20 blur-3xl rounded-full transition-opacity",
                isRecording && !isPaused ? "opacity-40 animate-pulse" : "group-hover:opacity-30"
              )}></div>
              <button
                onClick={isRecording ? stopRecording : startRecording}
                disabled={isProcessing}
                className={cn(
                  "relative w-24 h-24 rounded-full flex items-center justify-center text-white shadow-2xl transition-all active:scale-90 hover:scale-105 group cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
                  isRecording ? "bg-error" : "bg-gradient-to-br from-primary to-secondary"
                )}
              >
                {isRecording ? <Square className="w-8 h-8 fill-current" /> : <Mic className="w-10 h-10 fill-current" />}
              </button>
            </div>

            {isRecording && (
              <button
                onClick={isPaused ? resumeRecording : pauseRecording}
                disabled={isProcessing}
                className={cn(
                  "w-16 h-16 rounded-full flex items-center justify-center shadow-xl transition-all active:scale-90 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed",
                  isPaused ? "bg-primary text-white" : "bg-surface-container-high text-on-surface"
                )}
              >
                {isPaused ? <Play className="w-6 h-6 fill-current" /> : <Pause className="w-6 h-6 fill-current" />}
              </button>
            )}

            {!isRecording && (
              <>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept="audio/*,video/*,.m4a,.mp4"
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isProcessing}
                  className="w-16 h-16 rounded-full bg-surface-container-high text-on-surface flex items-center justify-center shadow-xl transition-all active:scale-90 hover:bg-surface-container-highest cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Import file âm thanh"
                >
                  <Upload className="w-6 h-6" />
                </button>
              </>
            )}
          </div>

          {lastAudioUrl && !isRecording && (
            <div className="flex w-full flex-col gap-6 scroll-mt-28 xl:flex-row xl:items-start">
              <div
                ref={recordingResultCardRef}
                className="relative flex min-w-0 flex-1 flex-col gap-6 overflow-hidden rounded-2xl border-2 border-primary/25 bg-gradient-to-b from-surface via-surface-container-lowest to-primary/5 p-6 shadow-[0_16px_48px_-12px_rgba(79,70,229,0.22)] ring-1 ring-primary/10"
              >
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary via-secondary to-primary opacity-80"
                />
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 shadow-inner ring-2 ring-primary/10">
                      <Mic className="h-6 w-6 text-primary" />
                    </div>
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-primary/80">Bản ghi vừa hoàn tất</p>
                      <h4 className="font-headline text-lg font-bold text-on-surface">{newRecordingTitle || "Chưa đặt tên"}</h4>
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 sm:flex-nowrap">
                    {saveStatus !== 'success' && (
                      <>
                        <button
                          type="button"
                          onClick={() => setIsNamingModalOpen(true)}
                          disabled={isProcessing}
                          className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-primary via-primary to-secondary px-5 py-2.5 text-sm font-black uppercase tracking-wide text-white shadow-[0_8px_24px_-4px_rgba(79,70,229,0.55)] ring-2 ring-white/25 transition-all hover:scale-[1.02] hover:shadow-[0_12px_28px_-4px_rgba(79,70,229,0.6)] active:scale-[0.98] cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100 disabled:hover:shadow-[0_8px_24px_-4px_rgba(79,70,229,0.55)]"
                        >
                          <Save className="h-4 w-4" />
                          Lưu bản ghi
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsResetModalOpen(true)}
                          disabled={isProcessing}
                          className="flex cursor-pointer items-center gap-2 rounded-xl bg-surface-container-high px-4 py-2.5 text-xs font-bold text-error transition-all hover:bg-error/10 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          Hủy
                        </button>
                      </>
                    )}
                    {fullTranscript.length > 0 && (
                      <button
                        type="button"
                        onClick={() => exportToWord(newRecordingTitle || "Recording", fullTranscript)}
                        disabled={isProcessing}
                        className="flex cursor-pointer items-center gap-2 rounded-xl border border-primary/25 bg-primary/10 px-4 py-2.5 text-xs font-bold text-primary transition-all hover:bg-primary/15 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <FileText className="h-3.5 w-3.5" />
                        Xuất Word
                      </button>
                    )}
                  </div>
                </div>

                {recordingSource === 'upload' ? (
                  <SyncedTranscriptPlayer
                    audioSrc={lastAudioUrl}
                    transcript={fullTranscript}
                    modelIndicators={modelIndicators}
                  />
                ) : (
                  <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low p-4">
                    <audio src={lastAudioUrl} controls className="h-10 w-full cursor-pointer" />
                  </div>
                )}
              </div>

              {(isGeneratingSummary || sessionSummary.trim()) && fullTranscript.length > 0 && !transcriptError ? (
                <aside className="flex w-full flex-col overflow-hidden rounded-xl border-2 border-primary/25 bg-gradient-to-b from-primary-fixed/20 to-surface-container-lowest/90 shadow-[0_12px_40px_-16px_rgba(79,70,229,0.35)] ring-1 ring-primary/10 xl:max-h-[calc(100vh-8rem)] xl:min-h-0 xl:w-[min(100%,22rem)] xl:shrink-0 xl:sticky xl:top-28 xl:self-start">
                  <h4 className="shrink-0 border-b border-primary/25 bg-surface px-4 py-3 font-headline text-xs font-bold uppercase tracking-wider text-primary">
                    Tóm tắt AI (xem trước)
                  </h4>
                  <p className="shrink-0 border-b border-primary/10 px-4 py-2 text-[11px] leading-relaxed text-on-surface-variant">
                    Bạn có thể vào bản tóm tắt này trong Admin
                  </p>
                  <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
                    {isGeneratingSummary ? (
                      <div className="flex flex-col items-center justify-center gap-4 py-6 text-center">
                        <Loader2 className="h-12 w-12 shrink-0 animate-spin text-primary" aria-hidden />
                        <div className="space-y-1.5">
                          <p className="text-sm font-semibold leading-snug text-on-surface">
                            AI đang tóm tắt nội dung cuộc trò chuyện, chờ tí nhé
                          </p>
                          <p className="text-xs leading-relaxed text-on-surface-variant">
                            (Không bắt buộc — bạn vẫn có thể nghe audio và đọc transcript bên trái.)
                          </p>
                        </div>
                      </div>
                    ) : (
                      <AiSummaryBlock text={sessionSummary} />
                    )}
                  </div>
                </aside>
              ) : null}
            </div>
          )}
        </div>
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-black font-headline tracking-tighter text-on-surface">
            {isRecording ? "Đang ghi âm..." : "Sẵn sàng ghi âm?"}
          </h1>
          <p className="text-on-surface-variant font-medium">
            {isRecording ? "Đang lắng nghe và phân tích giọng nói của bạn." : "Nhấn vào microphone để bắt đầu chuyển đổi cuộc họp thành văn bản."}
          </p>
        </div>

        <div className="flex items-center gap-1.5 h-12">
          {[...Array(8)].map((_, i) => (
            <div
              key={i}
              className={cn(
                "w-1.5 rounded-full transition-all duration-300",
                (isRecording || isProcessing || isGeneratingSummary) ? "bg-primary waveform-bar" : "bg-surface-container-highest h-2"
              )}
              style={{ animationDelay: `${i * 0.1}s`, height: (isRecording || isProcessing || isGeneratingSummary) ? undefined : `${[2, 4, 3, 6, 4, 2, 5, 3][i] * 4}px` }}
            ></div>
          ))}
        </div>
      </section>

      <section ref={transcriptPanelRef} className="w-full max-w-6xl scroll-mt-28">
        <div className="min-h-[600px] rounded-2xl border border-outline-variant/10 bg-surface-container-lowest p-10 shadow-[0_20px_40px_-10px_rgba(19,27,46,0.04)]">
          <div className="mb-8 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className={cn("w-2 h-2 rounded-full", isRecording ? "bg-error animate-pulse" : "bg-tertiary")}></span>
              <span className="text-xs font-bold uppercase tracking-widest text-on-surface-variant font-headline">
                {isProcessing ? "AI Đang xử lý" : isRecording ? "Đang ghi âm trực tiếp" : "Bản ghi mới nhất"}
              </span>
            </div>
            <div className="flex gap-2">
              <span className="bg-secondary-fixed text-on-secondary-fixed text-[10px] px-2 py-0.5 rounded-md font-bold uppercase tracking-tighter">AI Analysis Active</span>
              {saveStatus !== 'idle' && (
                <span className={cn(
                  "text-[10px] px-2 py-0.5 rounded-md font-bold uppercase tracking-tighter",
                  saveStatus === 'saving' ? "bg-primary-fixed text-primary animate-pulse" :
                    saveStatus === 'success' ? "bg-green-100 text-green-700" : "bg-error text-white"
                )}>
                  {saveStatus === 'saving' ? "Đang lưu..." :
                    saveStatus === 'success' ? "Đã lưu Admin" : "Lỗi lưu file"}
                </span>
              )}
            </div>
          </div>

          <div className="space-y-6 leading-relaxed">
            {recordingSource === 'live' && fullTranscript.length > 0 && !transcriptError ? (
              <div className="relative">
                <div
                  ref={liveTranscriptScrollRef}
                  onScroll={() => {
                    const el = liveTranscriptScrollRef.current;
                    setShowLiveTranscriptGoTop(!!el && el.scrollTop > 100);
                  }}
                  className="max-h-[900px] space-y-6 overflow-y-auto pr-2"
                >
                  {fullTranscript.map((item, idx) => (
                    <React.Fragment key={idx}>
                      {/* Model indicator badge - UI only */}
                      {modelIndicators.has(idx) && (
                        <div className="flex items-center gap-2 py-2">
                          <div className="h-px flex-1 bg-outline-variant/15"></div>
                          <span className={cn(
                            "text-[9px] px-2.5 py-1 rounded-full font-bold uppercase tracking-wider flex items-center gap-1.5 border",
                            modelIndicators.get(idx) === 'gemini' ? "bg-primary/5 text-primary border-primary/20" :
                            modelIndicators.get(idx) === 'groq' ? "bg-[#f55036]/5 text-[#f55036] border-[#f55036]/20" :
                            modelIndicators.get(idx) === 'openai' ? "bg-[#10a37f]/5 text-[#10a37f] border-[#10a37f]/20" :
                            modelIndicators.get(idx) === 'claude' ? "bg-[#d97706]/5 text-[#d97706] border-[#d97706]/20" :
                            "bg-surface-container text-on-surface-variant border-outline-variant/20"
                          )}>
                            <span className="h-1.5 w-1.5 rounded-full bg-current"></span>
                            {modelIndicators.get(idx)}
                          </span>
                          <div className="h-px flex-1 bg-outline-variant/15"></div>
                        </div>
                      )}
                      <div className="group flex flex-col gap-1.5">
                        <div className="flex items-center gap-3">
                          <div className={cn(
                            "px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider",
                            item.gender === 'Nam' ? "bg-blue-100 text-blue-700" :
                              item.gender === 'Nữ' ? "bg-pink-100 text-pink-700" : "bg-surface-container-highest text-on-surface-variant"
                          )}>
                            {item.speaker} {item.gender ? `• ${item.gender}` : ""}
                          </div>
                          <span className="text-[10px] font-mono text-on-surface-variant opacity-40">{item.timestamp}</span>
                        </div>
                        <p className={cn(
                          "text-lg font-body transition-colors",
                          item.isUncertain ? "text-error font-medium italic opacity-80" : "text-on-surface text-on-surface-variant"
                        )}>
                          {item.text}
                          {item.isUncertain && (
                            <span className="ml-2 inline-flex items-center gap-1 text-[9px] bg-error/10 text-error px-1.5 py-0.5 rounded border border-error/20 not-italic font-bold uppercase tracking-tighter">
                              AI không chắc chắn
                            </span>
                          )}
                        </p>
                      </div>
                    </React.Fragment>
                  ))}
                </div>
                {showLiveTranscriptGoTop && (
                  <button
                    type="button"
                    aria-label="Len dau transcript"
                    onClick={() => liveTranscriptScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
                    className="absolute bottom-2 right-2 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-primary text-white shadow-md shadow-primary/30 ring-2 ring-white/40 transition hover:scale-105"
                  >
                    <ChevronUp className="h-5 w-5" strokeWidth={2.5} />
                  </button>
                )}
              </div>
            ) : transcriptError ? (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-error/5 border border-error/15 rounded-2xl p-6 space-y-4"
              >
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-full bg-error/10 flex items-center justify-center shrink-0">
                    <AlertCircle className="w-5 h-5 text-error" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-headline font-bold text-error text-sm">Loi xu ly</h4>
                    <p className="text-sm text-on-surface-variant mt-1 leading-relaxed">{transcriptError}</p>
                  </div>
                </div>
                <div className="flex gap-2 pl-14">
                  <button
                    type="button"
                    onClick={() => { setTranscriptError(null); setCurrentTranscript(''); }}
                    className="text-xs bg-surface-container-low hover:bg-surface-container-high border border-outline-variant/20 rounded-lg px-3 py-1.5 font-medium transition-colors cursor-pointer"
                  >
                    Bo qua
                  </button>
                  <button
                    type="button"
                    onClick={() => window.location.href = '/admin'}
                    className="text-xs bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 rounded-lg px-3 py-1.5 font-medium transition-colors cursor-pointer"
                  >
                    Kiem tra API Key
                  </button>
                </div>
              </motion.div>
            ) : currentTranscript ? (
              <div className="text-xl font-body text-on-surface whitespace-pre-wrap italic opacity-70">
                {currentTranscript}
              </div>
            ) : (isRecording || isProcessing) ? (
              <div className="flex flex-col gap-4 opacity-30">
                <div className="h-4 bg-surface-container rounded w-3/4"></div>
                <div className="h-4 bg-surface-container rounded w-1/2"></div>
                <div className="h-4 bg-surface-container rounded w-2/3"></div>
              </div>
            ) : (
              <div className="py-10 flex flex-col items-center text-center space-y-8">
                <div className="space-y-2">
                  <h3 className="text-2xl font-headline font-bold text-on-surface">Chào mừng bạn đến với Sonic Lens</h3>
                  <p className="text-on-surface-variant max-w-md mx-auto">Hệ thống ghi âm và chuyển đổi giọng nói thông minh sử dụng công nghệ AI tiên tiến.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-2xl text-left">
                  <div className="bg-surface-container-low p-5 rounded-xl border border-outline-variant/10 flex gap-4">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <Mic className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <h4 className="font-bold text-sm mb-1">Ghi âm trực tiếp</h4>
                      <p className="text-xs text-on-surface-variant leading-relaxed">Nhấn nút Microphone để bắt đầu ghi âm. AI sẽ tự động nhận diện người nói và chuyển đổi thành văn bản theo thời gian thực.</p>
                    </div>
                  </div>

                  <div className="bg-surface-container-low p-5 rounded-xl border border-outline-variant/10 flex gap-4">
                    <div className="w-10 h-10 rounded-full bg-secondary/10 flex items-center justify-center shrink-0">
                      <Upload className="w-5 h-5 text-secondary" />
                    </div>
                    <div>
                      <h4 className="font-bold text-sm mb-1">Tải lên file có sẵn</h4>
                      <p className="text-xs text-on-surface-variant leading-relaxed">Bạn có thể tải lên các file âm thanh hoặc video (.mp3, .mp4, .m4a) để AI phân tích và tạo transcript.</p>
                    </div>
                  </div>

                  <div className="bg-surface-container-low p-5 rounded-xl border border-outline-variant/10 flex gap-4">
                    <div className="w-10 h-10 rounded-full bg-tertiary/10 flex items-center justify-center shrink-0">
                      <FileText className="w-5 h-5 text-tertiary" />
                    </div>
                    <div>
                      <h4 className="font-bold text-sm mb-1">Xuất dữ liệu</h4>
                      <p className="text-xs text-on-surface-variant leading-relaxed">Sau khi ghi âm xong, bạn có thể tóm tắt nội dung bằng AI và xuất transcript ra file Word chuyên nghiệp.</p>
                    </div>
                  </div>

                  <div className="bg-surface-container-low p-5 rounded-xl border border-outline-variant/10 flex gap-4">
                    <div className="w-10 h-10 rounded-full bg-primary-fixed/20 flex items-center justify-center shrink-0">
                      <ShieldCheck className="text-primary w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="font-bold text-sm mb-1">Quản lý Admin</h4>
                      <p className="text-xs text-on-surface-variant leading-relaxed">Truy cập cổng Admin để quản lý toàn bộ các bản ghi đã lưu, đổi tên hoặc xóa dữ liệu vĩnh viễn.</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="w-full grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-surface-container-low p-6 rounded-2xl flex flex-col gap-4">
          <div className="bg-primary-fixed p-2 rounded-lg w-fit">
            <Mic className="text-primary w-6 h-6" />
          </div>
          <h3 className="font-headline font-bold text-lg">Trạng thái</h3>
          <p className="text-sm text-on-surface-variant">
            {isRecording ? "Microphone đang hoạt động." : "Sẵn sàng cho cuộc họp tiếp theo."}
          </p>
        </div>
        <div className="bg-surface-container-high p-6 rounded-2xl flex flex-col gap-4">
          <div className="bg-secondary-fixed p-2 rounded-lg w-fit">
            <Play className="text-secondary w-6 h-6" />
          </div>
          <h3 className="font-headline font-bold text-lg">Thời lượng</h3>
          <p className="text-3xl font-headline font-black text-on-surface">{formatDuration(duration)}</p>
          <div className="w-full bg-surface rounded-full h-1.5 overflow-hidden">
            <div className={cn("bg-secondary h-full transition-all duration-1000", isRecording ? "w-full" : "w-0")}></div>
          </div>
        </div>
        <div className="bg-surface-container-low p-6 rounded-2xl flex flex-col gap-4">
          <div className="bg-tertiary-fixed p-2 rounded-lg w-fit">
            <ShieldCheck className="text-tertiary w-6 h-6" />
          </div>
          <h3 className="font-headline font-bold text-lg">Bảo mật</h3>
          <p className="text-sm text-on-surface-variant">Dữ liệu của bạn được mã hóa và lưu trữ an toàn trên đám mây.</p>
        </div>
      </section>

      <GoTopButton />
    </main>
  );
};

const AdminLogin = ({ onLogin }: { onLogin: (remember: boolean) => void }) => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (username === "admin" && password === "admin@1703") {
      onLogin(rememberMe);
    } else {
      setError("Sai tài khoản hoặc mật khẩu.");
    }
  };

  return (
    <div className="flex-1 flex items-center justify-center p-6 relative overflow-hidden">
      <div className="absolute top-[-10%] left-[-5%] w-[40vw] h-[40vw] rounded-full bg-surface-container opacity-50 blur-3xl"></div>
      <div className="absolute bottom-[-10%] right-[-5%] w-[35vw] h-[35vw] rounded-full bg-primary-fixed opacity-30 blur-3xl"></div>
      <div className="w-full max-w-md z-10">
        <div className="flex flex-col items-center mb-10">
          <div className="w-16 h-16 sonic-gradient rounded-xl flex items-center justify-center shadow-lg mb-4 transform -rotate-3">
            <Mic className="text-white w-8 h-8" />
          </div>
          <h1 className="font-headline font-extrabold text-3xl tracking-tight text-on-surface">Admin Portal</h1>
          <p className="font-body text-on-surface-variant mt-1">Đăng nhập để quản lý các bản ghi âm</p>
        </div>
        <div className="bg-surface-container-lowest border border-outline-variant/10 rounded-xl p-8 shadow-[0_20px_40px_-10px_rgba(19,27,46,0.06)]">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <label className="block font-headline text-sm font-bold text-on-surface-variant ml-1">Tên đăng nhập</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="block w-full px-4 py-3 bg-surface-container-high border-none rounded-lg focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary/20 transition-all font-body"
                placeholder="admin"
                required
              />
            </div>
            <div className="space-y-2">
              <label className="block font-headline text-sm font-bold text-on-surface-variant ml-1">Mật khẩu</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="block w-full px-4 py-3 bg-surface-container-high border-none rounded-lg focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary/20 transition-all font-body"
                placeholder="••••••••"
                required
              />
            </div>
            {error && <p className="text-error text-sm font-medium">{error}</p>}
            <div className="flex items-center gap-2 ml-1">
              <input
                type="checkbox"
                id="rememberMe"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="w-4 h-4 rounded border-outline-variant text-primary focus:ring-primary"
              />
              <label htmlFor="rememberMe" className="text-sm font-medium text-on-surface-variant cursor-pointer">Ghi nhớ đăng nhập</label>
            </div>
            <button type="submit" className="w-full sonic-gradient text-white font-headline font-bold py-4 rounded-lg shadow-md hover:shadow-xl transition-all duration-200 flex items-center justify-center gap-2">
              Đăng nhập
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

const AdminDashboard = () => {
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [selectedRecording, setSelectedRecording] = useState<Recording | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'recordings' | 'api'>('recordings');
  const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState("");
  const [itemToEdit, setItemToEdit] = useState<string | null>(null);
  const [itemToDelete, setItemToDelete] = useState<Recording | null>(null);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [renameError, setRenameError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  /** Admin recording detail: AI summary panel hidden by default on small screens */
  const [showRecordingSummary, setShowRecordingSummary] = useState(false);
  /** Collapsible left nav (1366px and similar) */
  const [adminSidebarOpen, setAdminSidebarOpen] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.localStorage.getItem('sonic_lens_admin_nav_open') !== 'false';
  });

  // AI provider config state
  const [aiProvider, setAIProvider] = useState<AIProvider>(() => getAIConfig().provider);
  const [enableMultiModel, setEnableMultiModel] = useState<boolean>(() => getAIConfig().enableMultiModel);
  const [openaiKey, setOpenaiKey] = useState<string>(() => getAIConfig().openaiApiKey);
  const [showOpenaiKey, setShowOpenaiKey] = useState(false);
  const [groqKey, setGroqKey] = useState<string>(() => getAIConfig().groqApiKey);
  const [showGroqKey, setShowGroqKey] = useState(false);
  const [claudeKey, setClaudeKey] = useState<string>(() => getAIConfig().claudeApiKey);
  const [showClaudeKey, setShowClaudeKey] = useState(false);
  const [nvidiaKey, setNvidiaKey] = useState<string>(() => getAIConfig().nvidiaNimApiKey);
  const [nvidiaModel, setNvidiaModel] = useState<string>(() => getAIConfig().nvidiaNimModel);
  const [showNvidiaKey, setShowNvidiaKey] = useState(false);
  const [apiSaveStatus, setApiSaveStatus] = useState<'idle' | 'saved'>('idle');
  const [providerPriorityOrder, setProviderPriorityOrder] = useState<AIProvider[]>(() => getProviderPriority(getAIConfig()));
  const [disabledProviders, setDisabledProviders] = useState<AIProvider[]>(() => getAIConfig().disabledProviders ?? []);
  const dragPriorityFrom = useRef<number | null>(null);

  const toggleProviderDisabled = (p: AIProvider) => {
    setDisabledProviders((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  };

  const adminAiConfigPayload = {
    provider: aiProvider,
    enableMultiModel,
    openaiApiKey: openaiKey,
    groqApiKey: groqKey,
    claudeApiKey: claudeKey,
    nvidiaNimApiKey: nvidiaKey,
    nvidiaNimModel: nvidiaModel,
    providerPriorityOrder,
    disabledProviders,
  };

  const providerAdminStatus = (p: AIProvider) => {
    const en = isProviderEnabled(p, adminAiConfigPayload);
    const cred = providerHasCredentials(p, adminAiConfigPayload);
    if (!en) return { kind: 'paused' as const };
    if (!cred) return { kind: 'missing' as const };
    return { kind: 'ready' as const };
  };

  const AdminProviderEnableSwitch = ({ providerId }: { providerId: AIProvider }) => {
    const enabled = isProviderEnabled(providerId, adminAiConfigPayload);
    return (
      <div className="mb-3 flex flex-col gap-1 rounded-lg border border-outline-variant/15 bg-surface-container-low/60 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-on-surface">Bật dùng provider</p>
          <p className="text-[10px] text-on-surface-variant">Tắt để tạm không gọi API (giữ nguyên key).</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={`${PROVIDER_ORDER_LABELS[providerId]}: ${enabled ? 'đang bật' : 'đang tắt'}`}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => toggleProviderDisabled(providerId)}
          className={cn(
            'relative h-7 w-12 shrink-0 rounded-full transition-colors',
            enabled ? 'bg-primary' : 'bg-surface-container-highest',
          )}
        >
          <span
            className={cn(
              'absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform',
              enabled ? 'translate-x-5' : 'translate-x-0',
            )}
          />
        </button>
      </div>
    );
  };

  useEffect(() => {
    fetchRecordings();
  }, []);

  useEffect(() => {
    setShowRecordingSummary(false);
  }, [selectedRecording?.id]);

  useEffect(() => {
    try {
      window.localStorage.setItem('sonic_lens_admin_nav_open', String(adminSidebarOpen));
    } catch {
      /* ignore */
    }
  }, [adminSidebarOpen]);

  const fetchRecordings = async () => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    const { data, error } = await supabase
      .from('recordings')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) console.error("Error fetching recordings:", error);
    else setRecordings(data || []);
    setLoading(false);
  };

  const toggleImportant = async (id: string, current: boolean) => {
    const { error } = await supabase
      .from('recordings')
      .update({ is_important: !current })
      .eq('id', id);

    if (!error) {
      setRecordings(prev => prev.map(r => r.id === id ? { ...r, is_important: !current } : r));
      if (selectedRecording?.id === id) {
        setSelectedRecording(prev => prev ? { ...prev, is_important: !current } : null);
      }
    }
  };

  const deleteMultipleRecordings = async () => {
    if (selectedIds.length === 0 && !itemToDelete) return;

    const idsToDelete = itemToDelete ? [itemToDelete.id] : selectedIds;
    const itemsToDelete = recordings.filter(r => idsToDelete.includes(r.id));

    setIsActionLoading(true);
    try {
      // Extract filenames from URLs
      const fileNames = itemsToDelete.map(item => {
        const urlParts = item.audio_url.split('/');
        return urlParts[urlParts.length - 1];
      });

      // Delete from storage
      const { error: storageError } = await supabase.storage
        .from('recordings')
        .remove(fileNames);

      if (storageError) {
        console.warn("Lỗi khi xóa file từ Storage:", storageError.message);
      }

      // Delete from DB
      const { error: dbError } = await supabase
        .from('recordings')
        .delete()
        .in('id', idsToDelete);

      if (!dbError) {
        setRecordings(prev => prev.filter(r => !idsToDelete.includes(r.id)));
        if (selectedRecording && idsToDelete.includes(selectedRecording.id)) {
          setSelectedRecording(null);
        }
        setIsDeleteModalOpen(false);
        setItemToDelete(null);
        setSelectedIds([]);
      } else {
        alert("Lỗi khi xóa bản ghi từ Database: " + dbError.message);
      }
    } catch (err: any) {
      console.error("Lỗi xóa bản ghi:", err);
    } finally {
      setIsActionLoading(false);
    }
  };

  const deleteRecording = deleteMultipleRecordings;

  const renameRecording = async () => {
    if (!itemToEdit || !editTitleValue.trim()) return;

    setIsActionLoading(true);
    setRenameError("");
    try {
      // Kiểm tra trùng tên
      const { data: existing } = await supabase
        .from('recordings')
        .select('id')
        .eq('title', editTitleValue.trim())
        .neq('id', itemToEdit) // Don't check against itself
        .maybeSingle();

      if (existing) {
        setRenameError("Tên bản ghi đã tồn tại. Vui lòng chọn tên khác.");
        setIsActionLoading(false);
        return;
      }

      const { error } = await supabase
        .from('recordings')
        .update({ title: editTitleValue.trim() })
        .eq('id', itemToEdit);

      if (!error) {
        setRecordings(prev => prev.map(r => r.id === itemToEdit ? { ...r, title: editTitleValue.trim() } : r));
        if (selectedRecording?.id === itemToEdit) {
          setSelectedRecording(prev => prev ? { ...prev, title: editTitleValue.trim() } : null);
        }
        setIsRenameModalOpen(false);
        setItemToEdit(null);
        setRenameError("");
      } else {
        setRenameError("Lỗi khi đổi tên: " + error.message);
      }
    } catch (err: any) {
      console.error("Lỗi đổi tên:", err);
      setRenameError("Đã xảy ra lỗi không xác định.");
    } finally {
      setIsActionLoading(false);
    }
  };

  const exportToWord = (title: string, transcript: TranscriptItem[]) => {
    const doc = new Document({
      sections: [{
        properties: {},
        children: [
          new Paragraph({
            children: [
              new TextRun({
                text: `Transcript: ${title}`,
                bold: true,
                size: 32,
              }),
            ],
          }),
          new Paragraph({ text: "" }),
          ...transcript.map(item => new Paragraph({
            children: [
              new TextRun({
                text: `[${item.timestamp}] ${item.speaker} (${item.gender}): `,
                bold: true,
              }),
              new TextRun({
                text: item.text,
              }),
            ],
          })),
        ],
      }],
    });

    Packer.toBlob(doc).then(blob => {
      saveAs(blob, `${title}.docx`);
    });
  };

  return (
    <div className="flex min-w-0 flex-1 pt-16">
      <aside
        className={cn(
          'fixed left-0 top-0 z-40 flex h-screen w-[11.2rem] flex-col gap-1 border-r border-surface-container-low bg-surface-container-low p-3 pt-20 shadow-sm transition-transform duration-300 ease-out',
          adminSidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
        aria-hidden={!adminSidebarOpen}
      >
        <div className="mb-3 flex items-start justify-between gap-1 px-1">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary-fixed">
                <User className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0">
                <h3 className="font-headline text-xs font-bold leading-tight text-on-surface">Admin</h3>
                <p className="truncate text-[10px] text-on-surface-variant">Hệ thống</p>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setAdminSidebarOpen(false)}
            className="shrink-0 rounded-lg p-1.5 text-on-surface-variant transition-colors hover:bg-white/60 hover:text-on-surface"
            title="Thu gọn menu"
            aria-label="Thu gọn menu"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          <button
            onClick={() => setActiveTab('recordings')}
            className={cn(
              "flex items-center gap-2 rounded-lg px-2.5 py-2.5 text-left font-semibold shadow-sm transition-all duration-200",
              activeTab === 'recordings' ? "bg-white text-primary" : "text-on-surface-variant hover:bg-white/50"
            )}
          >
            <Mic className="h-4 w-4 shrink-0" />
            <span className="font-body text-xs font-medium leading-snug">Bản ghi âm</span>
          </button>
          <button
            onClick={() => setActiveTab('api')}
            className={cn(
              "flex items-center gap-2 rounded-lg px-2.5 py-2.5 text-left font-semibold shadow-sm transition-all duration-200",
              activeTab === 'api' ? "bg-white text-primary" : "text-on-surface-variant hover:bg-white/50"
            )}
          >
            <Settings className="h-4 w-4 shrink-0" />
            <span className="font-body text-xs font-medium leading-snug">Cài đặt API</span>
          </button>
        </nav>
        <div className="mt-auto border-t border-outline-variant/30 pt-3">
          <button
            onClick={() => {
              localStorage.removeItem("isAdminAuthenticated");
              window.location.reload();
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2.5 text-on-surface-variant transition-all duration-200 hover:bg-white/50"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            <span className="font-body text-xs font-medium">Đăng xuất</span>
          </button>
        </div>
      </aside>

      {!adminSidebarOpen && (
        <button
          type="button"
          onClick={() => setAdminSidebarOpen(true)}
          className="fixed left-0 top-24 z-40 flex h-11 w-9 items-center justify-center rounded-r-xl border border-l-0 border-outline-variant/20 bg-surface-container-low text-primary shadow-md transition hover:bg-white"
          title="Mở menu"
          aria-label="Mở menu Admin"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      )}

      <main
        className={cn(
          'min-w-0 flex-1 bg-surface px-3 py-6 transition-[margin,padding] duration-300 ease-out sm:px-[15px] sm:py-8',
          // Reserve horizontal space for the floating "open menu" control when nav is collapsed (fixed left-0 w-9).
          adminSidebarOpen ? 'ml-[11.2rem]' : 'ml-0 pl-11 sm:pl-12',
        )}
      >
        <div className="w-full">
          {activeTab === 'recordings' ? (
            <>
              <header className="mb-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
                <div>
                  <h1 className="text-4xl font-black font-headline tracking-tight text-on-surface mb-2">Quản lý bản ghi</h1>
                  <p className="text-on-surface-variant font-body">Xem lại và quản lý các cuộc hội thoại đã được AI chuyển đổi.</p>
                </div>
                <div className="relative w-full md:w-72">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-variant opacity-50" />
                  <input
                    type="text"
                    placeholder="Tìm kiếm bản ghi..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full bg-surface-container-low border border-surface-container-high rounded-xl pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary transition-all"
                  />
                </div>
              </header>

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:gap-6">
                <div className="flex flex-col gap-3 lg:col-span-3">
                  {(() => {
                    const filteredRecordings = recordings.filter(r => r.title.toLowerCase().includes(searchQuery.toLowerCase()));
                    const isAllFilteredSelected = filteredRecordings.length > 0 && filteredRecordings.every(r => selectedIds.includes(r.id));

                    return (
                      <>
                        <div className="flex items-center justify-between px-2">
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={isAllFilteredSelected}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  const newSelected = Array.from(new Set([...selectedIds, ...filteredRecordings.map(r => r.id)]));
                                  setSelectedIds(newSelected);
                                } else {
                                  const filteredIds = filteredRecordings.map(r => r.id);
                                  setSelectedIds(selectedIds.filter(id => !filteredIds.includes(id)));
                                }
                              }}
                              className="w-4 h-4 rounded border-surface-container-high text-primary focus:ring-primary"
                            />
                            <span className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">
                              {searchQuery ? "Chọn kết quả lọc" : "Chọn tất cả"}
                            </span>
                          </div>
                          {selectedIds.length > 0 && (
                            <button
                              onClick={() => {
                                setItemToDelete(null);
                                setIsDeleteModalOpen(true);
                              }}
                              className="text-xs font-bold text-error uppercase tracking-wider hover:underline flex items-center gap-1"
                            >
                              <Trash2 className="w-3 h-3" />
                              Xóa ({selectedIds.length})
                            </button>
                          )}
                        </div>
                        <div className="bg-surface-container-low rounded-xl p-2 space-y-2 max-h-[70vh] overflow-y-auto">
                          {loading ? (
                            <div className="p-4 text-center text-on-surface-variant">Đang tải...</div>
                          ) : filteredRecordings.length === 0 ? (
                            <div className="p-4 text-center text-on-surface-variant">Không tìm thấy bản ghi nào.</div>
                          ) : (
                            filteredRecordings.map(rec => (
                              <div
                                key={rec.id}
                                className={cn(
                                  "flex cursor-pointer items-start gap-2 rounded-lg p-3 shadow-sm transition-all sm:gap-3",
                                  selectedRecording?.id === rec.id ? "border-l-4 border-primary bg-white" : "hover:bg-surface-container-high"
                                )}
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedIds.includes(rec.id)}
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setSelectedIds(prev => [...prev, rec.id]);
                                    } else {
                                      setSelectedIds(prev => prev.filter(id => id !== rec.id));
                                    }
                                  }}
                                  className="mt-1 w-4 h-4 rounded border-surface-container-high text-primary focus:ring-primary"
                                />
                                  <div className="flex-1" onClick={() => setSelectedRecording(rec)}>
                                    <div className="flex justify-between items-start mb-1">
                                      <div className="flex items-center gap-2">
                                        <span className="text-xs font-bold text-primary uppercase tracking-wider">
                                          {rec.is_important && <Star className="w-3 h-3 fill-current inline mr-1" />}
                                          {format(new Date(rec.created_at), 'HH:mm')}
                                        </span>
                                        {rec.source === 'upload' ? (
                                          <span className="text-[8px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 font-black uppercase tracking-tighter border border-green-200">SYNC</span>
                                        ) : (
                                          <span className="text-[8px] px-1.5 py-0.5 rounded bg-surface-container-highest text-on-surface-variant font-bold uppercase tracking-tighter border border-outline-variant/10">LIVE</span>
                                        )}
                                      </div>
                                      <span className="text-xs text-on-surface-variant font-medium">{format(new Date(rec.created_at), 'dd/MM/yyyy')}</span>
                                    </div>
                                    <h4 className="font-headline font-bold text-on-surface truncate">{rec.title}</h4>
                                    <div className="flex items-center gap-3 mt-2">
                                      <span className="flex items-center gap-1 text-xs text-on-surface-variant">
                                        <Play className="w-3 h-3" /> {formatDuration(rec.duration)}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                            ))
                          )}
                        </div>
                      </>
                    );
                  })()}
                </div>

                <div className="min-w-0 lg:col-span-9">
                  {selectedRecording ? (
                    <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
                      <div className="min-w-0 flex-1 space-y-6 xl:min-w-0">
                        <div className="bg-surface-container-lowest rounded-xl p-6 shadow-sm border border-outline-variant/10">
                          <div className="flex items-center justify-between mb-8">
                            <div className="flex items-center gap-4">
                              <button type="button" className="bg-primary-fixed p-3 rounded-full text-primary">
                                <Play className="w-6 h-6 fill-current" />
                              </button>
                              <div>
                                <div className="flex items-center gap-2">
                                  <h2 className="text-xl font-headline font-extrabold text-on-surface">{selectedRecording.title}</h2>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setItemToEdit(selectedRecording.id);
                                      setEditTitleValue(selectedRecording.title);
                                      setIsRenameModalOpen(true);
                                    }}
                                    className="p-1.5 hover:bg-surface-container-high rounded-lg text-on-surface-variant transition-colors"
                                    title="Đổi tên"
                                  >
                                    <Edit3 className="w-4 h-4" />
                                  </button>
                                </div>
                                <p className="text-sm text-on-surface-variant">
                                  {format(new Date(selectedRecording.created_at), 'dd/MM/yyyy HH:mm')} • {formatDuration(selectedRecording.duration)}
                                </p>
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-1 sm:gap-2">
                              {selectedRecording.summary?.trim() && !showRecordingSummary && (
                                <button
                                  type="button"
                                  onClick={() => setShowRecordingSummary(true)}
                                  className="flex items-center gap-1.5 rounded-lg border border-primary/25 bg-primary/10 px-2 py-2 text-xs font-bold uppercase tracking-wide text-primary transition-colors hover:bg-primary/15 sm:px-3"
                                  title="Xem tóm tắt AI"
                                >
                                  <Sparkles className="h-4 w-4 shrink-0" />
                                  <span className="hidden sm:inline">Tóm tắt AI</span>
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => exportToWord(selectedRecording.title, selectedRecording.transcript)}
                                className="p-2 text-on-surface-variant transition-colors hover:text-primary"
                                title="Xuất Word"
                              >
                                <FileText className="w-5 h-5" />
                              </button>
                              <button type="button" onClick={() => toggleImportant(selectedRecording.id, selectedRecording.is_important)} className={cn("p-2 transition-colors", selectedRecording.is_important ? "text-yellow-500" : "text-on-surface-variant hover:text-yellow-500")}>
                                <Star className={cn("w-5 h-5", selectedRecording.is_important && "fill-current")} />
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setItemToDelete(selectedRecording);
                                  setIsDeleteModalOpen(true);
                                }}
                                className="p-2 text-on-surface-variant hover:text-error transition-colors"
                              >
                                <Trash2 className="w-5 h-5" />
                              </button>
                            </div>
                          </div>

                          {selectedRecording.source === 'upload' ? (
                            <SyncedTranscriptPlayer
                              audioSrc={selectedRecording.audio_url}
                              transcript={selectedRecording.transcript}
                            />
                          ) : (
                            <>
                              <audio controls src={selectedRecording.audio_url} className="w-full mb-6 cursor-pointer" />
                              <div className="space-y-6">
                                {selectedRecording.transcript.map((item, idx) => (
                                  <div key={idx} className="flex gap-2.5 sm:gap-3">
                                    <div className="w-10 shrink-0 pt-0.5">
                                      <span className="block rounded bg-surface-container-highest px-1 py-0.5 text-center font-mono text-[9px] leading-tight text-on-surface-variant opacity-80">
                                        {item.timestamp}
                                      </span>
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-2 mb-1">
                                        <span className={cn(
                                          "px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider",
                                          item.gender === 'Nam' ? "bg-blue-100 text-blue-700" :
                                            item.gender === 'Nữ' ? "bg-pink-100 text-pink-700" : "bg-surface-container-highest text-on-surface-variant"
                                        )}>
                                          {item.speaker} {item.gender ? `• ${item.gender}` : ""}
                                        </span>
                                      </div>
                                      <p className={cn(
                                        "text-base leading-relaxed font-body",
                                        item.isUncertain ? "text-error font-medium italic opacity-80" : "text-on-surface"
                                      )}>
                                        {item.text}
                                      </p>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </>
                          )}
                        </div>
                      </div>

                      {selectedRecording.summary?.trim() && showRecordingSummary ? (
                        <aside className="flex w-full shrink-0 flex-col overflow-hidden rounded-xl border-2 border-primary/25 bg-gradient-to-b from-primary-fixed/20 to-surface-container-lowest/90 shadow-[0_12px_40px_-16px_rgba(79,70,229,0.35)] ring-1 ring-primary/10 xl:max-h-[calc(100vh-7rem)] xl:min-h-0 xl:w-[min(100%,17.5rem)] xl:sticky xl:top-24 xl:self-start">
                          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-primary/25 bg-surface px-3 py-2.5 sm:px-4">
                            <h4 className="font-headline text-xs font-bold uppercase tracking-wider text-primary">
                              Tóm tắt AI
                            </h4>
                            <button
                              type="button"
                              onClick={() => setShowRecordingSummary(false)}
                              className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-bold text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
                              title="Ẩn tóm tắt"
                            >
                              <X className="h-3.5 w-3.5" />
                              Ẩn
                            </button>
                          </div>
                          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:px-4">
                            <AiSummaryBlock text={selectedRecording.summary} />
                          </div>
                        </aside>
                      ) : null}
                    </div>
                  ) : (
                    <div className="bg-surface-container-lowest rounded-xl p-20 shadow-sm border border-outline-variant/10 flex flex-col items-center justify-center text-center">
                      <Mic className="w-16 h-16 text-surface-container-highest mb-4" />
                      <h3 className="text-xl font-headline font-bold text-on-surface">Chọn một bản ghi</h3>
                      <p className="text-on-surface-variant max-w-xs">Chọn một cuộc hội thoại từ danh sách bên trái để xem chi tiết và transcript.</p>
                    </div>
                  )}
                </div>
              </div>
              <GoTopButton />
            </>
          ) : (
            <>
              <header className="mb-10">
                <h1 className="text-4xl font-black font-headline tracking-tight text-on-surface mb-2">Cài đặt API</h1>
                <p className="text-on-surface-variant font-body">Cấu hình AI provider và các dịch vụ lưu trữ.</p>
              </header>

              <div className="space-y-8">
                {/* AI Provider Card */}
                <div className="bg-surface-container-lowest p-8 rounded-xl shadow-sm border border-outline-variant/10">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="bg-primary-fixed p-2 rounded-lg">
                      <Key className="text-primary w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="font-headline font-bold text-xl">AI Provider</h3>
                      <p className="text-xs text-on-surface-variant mt-0.5">Chọn dịch vụ AI để chuyển đổi giọng nói thành văn bản</p>
                    </div>
                  </div>

                  {/* Multi-model toggle */}
                  <div className="mb-6 bg-surface-container-low rounded-xl p-5 border border-outline-variant/10">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-bold text-on-surface">Smart Multi-Model</h4>
                          <span className={cn("text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider", enableMultiModel ? "bg-green-100 text-green-700" : "bg-surface-container-highest text-on-surface-variant")}>                            {enableMultiModel ? 'ON' : 'OFF'}
                          </span>
                        </div>
                        <p className="text-xs text-on-surface-variant mt-1 leading-relaxed max-w-md">
                          {enableMultiModel
                            ? 'Tu dong thu cac provider theo thu tu uu tien. Neu model A loi se tu dong chuyen sang model B.'
                            : 'Chi su dung duy nhat 1 provider da chon ben duoi.'}
                        </p>
                        {enableMultiModel && (
                          <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                            {providerPriorityOrder.map((p, i) => {
                              const st = providerAdminStatus(p);
                              return (
                                <React.Fragment key={p}>
                                  <span
                                    className={cn(
                                      'text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider border',
                                      st.kind === 'ready' && 'border-green-200 bg-green-50 text-green-700',
                                      st.kind === 'paused' && 'border-amber-200 bg-amber-50 text-amber-900',
                                      st.kind === 'missing' && 'border-outline-variant/10 bg-surface-container text-on-surface-variant/50 line-through',
                                    )}
                                  >
                                    {PROVIDER_ORDER_LABELS[p]}
                                    {st.kind === 'paused' ? ' · tắt' : st.kind === 'missing' ? ' · thiếu key' : ''}
                                  </span>
                                  {i < providerPriorityOrder.length - 1 && (
                                    <ChevronRight className="w-3 h-3 text-on-surface-variant/30" />
                                  )}
                                </React.Fragment>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => setEnableMultiModel(!enableMultiModel)}
                        className={cn("relative w-12 h-7 rounded-full transition-colors duration-200 shrink-0 ml-4",
                          enableMultiModel ? "bg-primary" : "bg-surface-container-highest"
                        )}
                      >
                        <div className={cn("absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow-md transition-transform duration-200",
                          enableMultiModel ? "translate-x-5" : "translate-x-0"
                        )} />
                      </button>
                    </div>
                    {enableMultiModel && (
                      <div className="mt-4 border-t border-outline-variant/15 pt-4">
                        <p className="mb-2 text-xs font-bold text-on-surface">Thứ tự ưu tiên (kéo thả)</p>
                        <p className="mb-2 text-[11px] leading-relaxed text-on-surface-variant">
                          Kéo từng dòng để đổi thứ tự fallback. Nhấn &quot;Lưu cài đặt&quot; để áp dụng.
                        </p>
                        <ul className="space-y-1.5">
                          {providerPriorityOrder.map((p, i) => {
                            const st = providerAdminStatus(p);
                            const rowDimmed = st.kind !== 'ready';
                            return (
                              <li
                                key={p}
                                draggable
                                onDragStart={() => {
                                  dragPriorityFrom.current = i;
                                }}
                                onDragEnd={() => {
                                  dragPriorityFrom.current = null;
                                }}
                                onDragOver={(e) => e.preventDefault()}
                                onDrop={(e) => {
                                  e.preventDefault();
                                  const from = dragPriorityFrom.current;
                                  dragPriorityFrom.current = null;
                                  if (from === null || from === i) return;
                                  setProviderPriorityOrder((prev) => {
                                    const next = [...prev];
                                    const [item] = next.splice(from, 1);
                                    next.splice(i, 0, item);
                                    return next;
                                  });
                                }}
                                className={cn(
                                  'flex cursor-grab items-center gap-2 rounded-lg border px-3 py-2.5 text-xs font-bold transition-colors active:cursor-grabbing',
                                  rowDimmed
                                    ? 'border-outline-variant/20 bg-surface-container text-on-surface-variant/80'
                                    : 'border-primary/20 bg-surface-container-lowest text-on-surface',
                                )}
                              >
                                <GripVertical className="h-4 w-4 shrink-0 text-on-surface-variant" aria-hidden />
                                <span className="min-w-0 flex-1">{PROVIDER_ORDER_LABELS[p]}</span>
                                <button
                                  type="button"
                                  role="switch"
                                  aria-checked={isProviderEnabled(p, adminAiConfigPayload)}
                                  aria-label="Toggle provider on/off"
                                  onMouseDown={(e) => e.stopPropagation()}
                                  onClick={() => toggleProviderDisabled(p)}
                                  className={cn(
                                    'relative h-6 w-11 shrink-0 rounded-full transition-colors',
                                    isProviderEnabled(p, adminAiConfigPayload) ? 'bg-primary' : 'bg-surface-container-highest',
                                  )}
                                >
                                  <span
                                    className={cn(
                                      'absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
                                      isProviderEnabled(p, adminAiConfigPayload) ? 'translate-x-5' : 'translate-x-0',
                                    )}
                                  />
                                </button>
                                <span
                                  className={cn(
                                    'min-w-[4.5rem] shrink-0 rounded px-1.5 py-0.5 text-center text-[9px] font-bold uppercase',
                                    st.kind === 'ready' && 'bg-green-100 text-green-800',
                                    st.kind === 'paused' && 'bg-amber-100 text-amber-900',
                                    st.kind === 'missing' && 'bg-surface-container-highest text-on-surface-variant',
                                  )}
                                >
                                  {st.kind === 'ready' ? 'Sẵn sàng' : st.kind === 'paused' ? 'Tạm tắt' : 'Thiếu key'}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                  </div>

                  {/* Provider selector (only shown when multi-model is OFF) */}
                  {!enableMultiModel && (
                    <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {([
                        {
                          id: 'gemini' as AIProvider, label: 'Google Gemini', color: 'primary', desc: 'Multimodal (Free)', icon: (
                            <svg viewBox="0 0 24 24" className="w-5 h-5 shrink-0" fill="currentColor">
                              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z" />
                            </svg>
                          )
                        },
                        {
                          id: 'nvidiaNim' as AIProvider, label: 'NVIDIA NIM', color: '#76b900', desc: 'Gemma / chat API', icon: (
                            <svg viewBox="0 0 24 24" className="w-5 h-5 shrink-0" fill="currentColor">
                              <path d="M8.5 14.5L12 12l3.5 2.5L12 17l-3.5-2.5zM12 7l3.5 2.5L12 12 8.5 9.5 12 7z" />
                            </svg>
                          )
                        },
                        {
                          id: 'openai' as AIProvider, label: 'OpenAI / ChatGPT', color: '#10a37f', desc: 'Whisper + GPT-4o', icon: (
                            <svg viewBox="0 0 24 24" className="w-5 h-5 shrink-0" fill="currentColor">
                              <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.896zm16.597 3.855l-5.843-3.37 2.02-1.167a.076.076 0 0 1 .071 0l4.83 2.786a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.402-.676zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08-4.778 2.758a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
                            </svg>
                          )
                        },
                        {
                          id: 'groq' as AIProvider, label: 'Groq', color: '#f55036', desc: 'Whisper + Llama 3 (Free)', icon: (
                            <svg viewBox="0 0 24 24" className="w-5 h-5 shrink-0" fill="currentColor">
                              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )
                        },
                        {
                          id: 'claude' as AIProvider, label: 'Claude (Anthropic)', color: '#d97706', desc: 'Sonnet 4 (Paid)', icon: (
                            <svg viewBox="0 0 24 24" className="w-5 h-5 shrink-0" fill="currentColor">
                              <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z" />
                            </svg>
                          )
                        },
                      ]).map(({ id, label, color, desc, icon }) => {
                        const isActive = aiProvider === id;
                        const paused = !isProviderEnabled(id, adminAiConfigPayload);
                        const borderColor = isActive
                          ? id === 'gemini' ? 'border-primary bg-primary/5 text-primary'
                            : id === 'nvidiaNim' ? 'border-[#76b900] bg-[#76b900]/5 text-[#5a8f00]'
                              : id === 'openai' ? 'border-[#10a37f] bg-[#10a37f]/5 text-[#10a37f]'
                                : id === 'groq' ? 'border-[#f55036] bg-[#f55036]/5 text-[#f55036]'
                                  : 'border-[#d97706] bg-[#d97706]/5 text-[#d97706]'
                          : 'border-surface-container-high text-on-surface-variant hover:border-outline-variant';
                        return (
                          <button
                            key={id}
                            onClick={() => setAIProvider(id)}
                            className={cn(
                              "flex flex-col items-center justify-center gap-1.5 px-4 py-4 rounded-xl border-2 font-bold text-sm transition-all duration-200",
                              borderColor,
                              paused && "opacity-60",
                            )}
                          >
                            <div className="flex items-center gap-2">
                              {icon}
                              <span className="text-xs font-bold">{label}</span>
                              {isActive && <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />}
                            </div>
                            <span className={cn("text-[10px] font-medium", isActive ? "opacity-80" : "text-on-surface-variant")}>{desc}</span>
                            {paused && (
                              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-900">Tạm tắt</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Provider config panels (only when multi-model is OFF) */}
                  {!enableMultiModel && (
                    <>
                      {/* Gemini: show env status, no editable key */}
                      {aiProvider === 'gemini' && (
                        <>
                        <AdminProviderEnableSwitch providerId="gemini" />
                        <div className="bg-primary/5 border border-primary/15 rounded-xl p-5 flex items-start gap-4">
                          <div className={cn("w-10 h-10 rounded-full flex items-center justify-center shrink-0", process.env.GEMINI_API_KEY ? "bg-green-100" : "bg-error/10")}>
                            <ShieldCheck className={cn("w-5 h-5", process.env.GEMINI_API_KEY ? "text-green-600" : "text-error")} />
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <p className="text-sm font-bold text-on-surface">Gemini API Key</p>
                              <span className={cn("text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider", process.env.GEMINI_API_KEY ? "bg-green-100 text-green-700" : "bg-error/10 text-error")}>
                                {process.env.GEMINI_API_KEY ? 'Đã cấu hình' : 'Chưa có key'}
                              </span>
                            </div>
                            <p className="text-xs text-on-surface-variant">
                              Key: <code className="rounded bg-surface-container px-1">GEMINI_API_KEY</code>.
                              Model cho tóm tắt / cấu trúc text: <code className="rounded bg-surface-container px-1">GEMINI_TEXT_MODEL</code> (mặc định <code className="rounded bg-surface-container px-1">gemini-2.0-flash</code>; thử <code className="rounded bg-surface-container px-1">gemini-2.5-flash</code> hoặc <code className="rounded bg-surface-container px-1">gemini-1.5-pro</code> nếu cần). Ghi âm trực tiếp qua Gemini vẫn dùng model trong code (<code className="rounded bg-surface-container px-1">gemini-2.5-flash</code>).
                            </p>
                            <a
                              href={GEMINI_API_KEYS_URL}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 mt-3 text-xs font-bold text-primary hover:underline"
                            >
                              Lấy API Key tại Google AI Studio <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                        </div>
                        </>
                      )}

                      {aiProvider === 'nvidiaNim' && (
                        <div className="space-y-4">
                          <AdminProviderEnableSwitch providerId="nvidiaNim" />
                          <div className="flex items-start gap-4 rounded-xl border border-[#76b900]/25 bg-[#76b900]/5 p-5">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#76b900]/15">
                              <ExternalLink className="h-5 w-5 text-[#5a8f00]" />
                            </div>
                            <div className="flex-1">
                              <p className="text-sm font-bold text-on-surface">NVIDIA NIM</p>
                              <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">
                                NIM <strong>không</strong> gọi API Google Gemini; đây là endpoint NVIDIA (chat kiểu OpenAI). Muốn model cùng “họ Google” trên catalog thì dùng <strong>Gemma</strong> (ví dụ <code className="rounded bg-surface-container px-1">google/gemma-2-27b-it</code>), không dùng được chuỗi <code className="rounded bg-surface-container px-1">gemini-2.5-flash</code> như bên AI Studio. STT vẫn là Whisper (Groq/OpenAI). <strong>Deploy:</strong> app gọi <code className="rounded bg-surface-container px-1">/nvidia-nim-api</code> (cùng domain) — cần proxy tới NVIDIA như <code className="rounded bg-surface-container px-1">npm run dev</code>, hoặc <code className="rounded bg-surface-container px-1">npm run serve:prod</code>, hoặc cấu hình nginx / <code className="rounded bg-surface-container px-1">VITE_NVIDIA_NIM_CHAT_URL</code>.
                              </p>
                              <a
                                href={NVIDIA_NIM_EXPLORE_URL}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="mt-3 inline-flex items-center gap-2 rounded-lg bg-[#76b900] px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-[#5a8f00]"
                              >
                                NVIDIA Build (models) <ExternalLink className="h-3.5 w-3.5" />
                              </a>
                            </div>
                          </div>
                          <div>
                            <label htmlFor="nvidia-key-input" className="mb-2 block text-sm font-bold text-on-surface-variant">NVIDIA NIM API Key</label>
                            <div className="relative">
                              <input
                                id="nvidia-key-input"
                                type={showNvidiaKey ? 'text' : 'password'}
                                value={nvidiaKey}
                                onChange={(e) => setNvidiaKey(e.target.value)}
                                placeholder="nvapi-..."
                                className="w-full rounded-xl border border-surface-container-high bg-surface-container-low px-4 py-3 pr-12 font-mono text-sm transition-all focus:outline-none focus:ring-2 focus:ring-[#76b900]"
                              />
                              <button
                                type="button"
                                onClick={() => setShowNvidiaKey(!showNvidiaKey)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant transition-colors hover:text-on-surface"
                              >
                                {showNvidiaKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                              </button>
                            </div>
                          </div>
                          <div>
                            <label htmlFor="nvidia-model-input" className="mb-2 block text-sm font-bold text-on-surface-variant">Model ID</label>
                            <input
                              id="nvidia-model-input"
                              type="text"
                              value={nvidiaModel}
                              onChange={(e) => setNvidiaModel(e.target.value)}
                              placeholder="google/gemma-2-27b-it"
                              className="w-full rounded-xl border border-surface-container-high bg-surface-container-low px-4 py-3 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-[#76b900]"
                            />
                          </div>
                          {!groqKey && !openaiKey && (
                            <p className="text-xs font-bold text-error">Cần thêm Groq hoặc OpenAI API Key để Whisper (STT) khi chọn NIM đơn lẻ.</p>
                          )}
                        </div>
                      )}

                      {/* OpenAI: link + manual key input */}
                      {aiProvider === 'openai' && (
                        <div className="space-y-4">
                          <AdminProviderEnableSwitch providerId="openai" />
                          <div className="bg-[#10a37f]/5 border border-[#10a37f]/20 rounded-xl p-5 flex items-start gap-4">
                            <div className="w-10 h-10 rounded-full bg-[#10a37f]/10 flex items-center justify-center shrink-0">
                              <ExternalLink className="w-5 h-5 text-[#10a37f]" />
                            </div>
                            <div className="flex-1">
                              <p className="text-sm font-bold text-on-surface">Liên kết OpenAI Platform</p>
                              <p className="text-xs text-on-surface-variant mt-1 leading-relaxed">Tạo API Key từ trang quản lý OpenAI để kết nối Sonic Lens. Lưu ý: cần nạp credit riêng tại platform.openai.com (tối thiểu $5), không dùng chung với ChatGPT Plus/Business.</p>
                              <a
                                href={OPENAI_API_KEYS_URL}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-2 mt-3 px-4 py-2 bg-[#10a37f] text-white text-xs font-bold rounded-lg hover:bg-[#0d8a6a] transition-colors"
                              >
                                Mở trang OpenAI API Keys <ExternalLink className="w-3.5 h-3.5" />
                              </a>
                            </div>
                          </div>
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <label htmlFor="openai-key-input" className="text-sm font-bold text-on-surface-variant">OpenAI API Key</label>
                              <span className="text-[10px] bg-surface-container px-2 py-0.5 rounded font-bold text-on-surface-variant uppercase tracking-wider">Whisper + GPT-4o mini</span>
                            </div>
                            <div className="relative">
                              <input
                                id="openai-key-input"
                                type={showOpenaiKey ? 'text' : 'password'}
                                value={openaiKey}
                                onChange={(e) => setOpenaiKey(e.target.value)}
                                placeholder="sk-..."
                                className="w-full bg-surface-container-low border border-surface-container-high rounded-xl px-4 py-3 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-[#10a37f] transition-all font-mono"
                              />
                              <button
                                type="button"
                                onClick={() => setShowOpenaiKey(!showOpenaiKey)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface transition-colors"
                              >
                                {showOpenaiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                              </button>
                            </div>
                            <p className="mt-2 text-xs text-on-surface-variant">Sử dụng <strong>Whisper</strong> để nhận diện giọng nói và <strong>GPT-4o mini</strong> để phân tích transcript có speaker.</p>
                          </div>
                        </div>
                      )}

                      {/* Groq: link + manual key input */}
                      {aiProvider === 'groq' && (
                        <div className="space-y-4">
                          <AdminProviderEnableSwitch providerId="groq" />
                          <div className="bg-[#f55036]/5 border border-[#f55036]/20 rounded-xl p-5 flex items-start gap-4">
                            <div className="w-10 h-10 rounded-full bg-[#f55036]/10 flex items-center justify-center shrink-0">
                              <ExternalLink className="w-5 h-5 text-[#f55036]" />
                            </div>
                            <div className="flex-1">
                              <p className="text-sm font-bold text-on-surface">Groq Cloud Console</p>
                              <p className="text-xs text-on-surface-variant mt-1 leading-relaxed">Groq cung cap API <strong>mien phi</strong> voi toc do cuc nhanh. Bao gom Whisper Large v3 (speech-to-text) va Llama 3.3 70B (structuring). Khong can nap credit.</p>
                              <a
                                href={GROQ_API_KEYS_URL}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-2 mt-3 px-4 py-2 bg-[#f55036] text-white text-xs font-bold rounded-lg hover:bg-[#d44530] transition-colors"
                              >
                                Tao API Key tai Groq Console <ExternalLink className="w-3.5 h-3.5" />
                              </a>
                            </div>
                          </div>
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <label htmlFor="groq-key-input" className="text-sm font-bold text-on-surface-variant">Groq API Key</label>
                              <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded font-bold uppercase tracking-wider">Free Tier</span>
                            </div>
                            <div className="relative">
                              <input
                                id="groq-key-input"
                                type={showGroqKey ? 'text' : 'password'}
                                value={groqKey}
                                onChange={(e) => setGroqKey(e.target.value)}
                                placeholder="gsk_..."
                                className="w-full bg-surface-container-low border border-surface-container-high rounded-xl px-4 py-3 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-[#f55036] transition-all font-mono"
                              />
                              <button
                                type="button"
                                onClick={() => setShowGroqKey(!showGroqKey)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface transition-colors"
                              >
                                {showGroqKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                              </button>
                            </div>
                            <p className="mt-2 text-xs text-on-surface-variant">Su dung <strong>Whisper Large v3</strong> (speech-to-text) va <strong>Llama 3.3 70B</strong> (structuring). Hoan toan mien phi.</p>
                          </div>
                        </div>
                      )}

                      {/* Claude: link + manual key input */}
                      {aiProvider === 'claude' && (
                        <div className="space-y-4">
                          <AdminProviderEnableSwitch providerId="claude" />
                          <div className="bg-[#d97706]/5 border border-[#d97706]/20 rounded-xl p-5 flex items-start gap-4">
                            <div className="w-10 h-10 rounded-full bg-[#d97706]/10 flex items-center justify-center shrink-0">
                              <ExternalLink className="w-5 h-5 text-[#d97706]" />
                            </div>
                            <div className="flex-1">
                              <p className="text-sm font-bold text-on-surface">Anthropic Console</p>
                              <p className="text-xs text-on-surface-variant mt-1 leading-relaxed">Claude su dung API tra phi cua Anthropic. Can nap credit tai console.anthropic.com. <strong>Luu y:</strong> Claude khong ho tro doc audio truc tiep, can ket hop voi Groq (mien phi) hoac OpenAI de chuyen am thanh thanh van ban truoc.</p>
                              <a
                                href={CLAUDE_API_KEYS_URL}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-2 mt-3 px-4 py-2 bg-[#d97706] text-white text-xs font-bold rounded-lg hover:bg-[#b45309] transition-colors"
                              >
                                Tao API Key tai Anthropic <ExternalLink className="w-3.5 h-3.5" />
                              </a>
                            </div>
                          </div>
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <label htmlFor="claude-key-input" className="text-sm font-bold text-on-surface-variant">Claude API Key</label>
                              <span className="text-[10px] bg-[#d97706]/10 text-[#d97706] px-2 py-0.5 rounded font-bold uppercase tracking-wider">Paid</span>
                            </div>
                            <div className="relative">
                              <input
                                id="claude-key-input"
                                type={showClaudeKey ? 'text' : 'password'}
                                value={claudeKey}
                                onChange={(e) => setClaudeKey(e.target.value)}
                                placeholder="sk-ant-..."
                                className="w-full bg-surface-container-low border border-surface-container-high rounded-xl px-4 py-3 pr-12 text-sm focus:outline-none focus:ring-2 focus:ring-[#d97706] transition-all font-mono"
                              />
                              <button
                                type="button"
                                onClick={() => setShowClaudeKey(!showClaudeKey)}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface transition-colors"
                              >
                                {showClaudeKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                              </button>
                            </div>
                            <p className="mt-2 text-xs text-on-surface-variant">Su dung <strong>Claude Sonnet 4</strong> de phan tich transcript. Can co <strong>Groq API Key</strong> (mien phi) hoac <strong>OpenAI Key</strong> de chuyen am thanh thanh van ban.</p>
                            {!groqKey && !openaiKey && (
                              <p className="mt-2 text-xs text-error font-bold">Chua co Groq hoac OpenAI API Key cho buoc speech-to-text. Vui long them Groq key (mien phi) truoc.</p>
                            )}
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {/* Multi-model: show ALL key inputs at once */}
                  {enableMultiModel && (
                    <div className="space-y-4">
                      <p className="text-xs text-on-surface-variant font-bold uppercase tracking-wider">API Keys (them key de mo khoa cac provider)</p>

                      {/* Gemini */}
                      {(() => {
                        const geminiSt = providerAdminStatus('gemini');
                        return (
                      <div className="rounded-xl border border-primary/15 bg-primary/5 p-4">
                        <AdminProviderEnableSwitch providerId="gemini" />
                        <div className="flex items-center gap-3">
                          <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full", process.env.GEMINI_API_KEY ? "bg-green-100" : "bg-error/10")}>
                            <ShieldCheck className={cn("h-4 w-4", process.env.GEMINI_API_KEY ? "text-green-600" : "text-error")} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-bold text-on-surface">Gemini</p>
                            <p className="text-[10px] text-on-surface-variant">Key tu bien moi truong (env)</p>
                          </div>
                          <span
                            className={cn(
                              'shrink-0 rounded px-2 py-0.5 text-[10px] font-bold uppercase',
                              geminiSt.kind === 'ready' && 'bg-green-100 text-green-700',
                              geminiSt.kind === 'paused' && 'bg-amber-100 text-amber-900',
                              geminiSt.kind === 'missing' && 'bg-error/10 text-error',
                            )}
                          >
                            {geminiSt.kind === 'ready' ? 'Sẵn sàng' : geminiSt.kind === 'paused' ? 'Tạm tắt' : 'Thiếu key'}
                          </span>
                        </div>
                      </div>
                        );
                      })()}

                      {/* NVIDIA NIM */}
                      <div className="rounded-xl border border-[#76b900]/20 bg-[#76b900]/5 p-4">
                        <AdminProviderEnableSwitch providerId="nvidiaNim" />
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-sm font-bold text-on-surface">NVIDIA NIM</span>
                          <a href={NVIDIA_NIM_EXPLORE_URL} target="_blank" rel="noopener noreferrer" className="text-[10px] font-bold text-[#5a8f00] hover:underline">Build</a>
                        </div>
                        <div className="relative mb-2">
                          <input
                            type={showNvidiaKey ? 'text' : 'password'}
                            value={nvidiaKey}
                            onChange={(e) => setNvidiaKey(e.target.value)}
                            placeholder="nvapi-..."
                            className="w-full rounded-lg border border-surface-container-high bg-surface-container-low px-3 py-2 pr-10 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-[#76b900]"
                          />
                          <button type="button" onClick={() => setShowNvidiaKey(!showNvidiaKey)} className="absolute right-2 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface">
                            {showNvidiaKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                        <input
                          type="text"
                          value={nvidiaModel}
                          onChange={(e) => setNvidiaModel(e.target.value)}
                          placeholder="google/gemma-2-27b-it"
                          className="w-full rounded-lg border border-surface-container-high bg-surface-container-low px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-[#76b900]"
                        />
                      </div>

                      {/* Groq */}
                      <div className="bg-[#f55036]/5 border border-[#f55036]/15 rounded-xl p-4">
                        <AdminProviderEnableSwitch providerId="groq" />
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-bold text-on-surface">Groq</span>
                          <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded font-bold uppercase">Free</span>
                        </div>
                        <div className="relative">
                          <input
                            type={showGroqKey ? 'text' : 'password'}
                            value={groqKey}
                            onChange={(e) => setGroqKey(e.target.value)}
                            placeholder="gsk_..."
                            className="w-full bg-surface-container-low border border-surface-container-high rounded-lg px-3 py-2 pr-10 text-xs focus:outline-none focus:ring-2 focus:ring-[#f55036] transition-all font-mono"
                          />
                          <button type="button" onClick={() => setShowGroqKey(!showGroqKey)} className="absolute right-2 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface">
                            {showGroqKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </div>

                      {/* OpenAI */}
                      <div className="bg-[#10a37f]/5 border border-[#10a37f]/15 rounded-xl p-4">
                        <AdminProviderEnableSwitch providerId="openai" />
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-bold text-on-surface">OpenAI</span>
                          <span className="text-[10px] bg-[#10a37f]/10 text-[#10a37f] px-2 py-0.5 rounded font-bold uppercase">Paid</span>
                        </div>
                        <div className="relative">
                          <input
                            type={showOpenaiKey ? 'text' : 'password'}
                            value={openaiKey}
                            onChange={(e) => setOpenaiKey(e.target.value)}
                            placeholder="sk-..."
                            className="w-full bg-surface-container-low border border-surface-container-high rounded-lg px-3 py-2 pr-10 text-xs focus:outline-none focus:ring-2 focus:ring-[#10a37f] transition-all font-mono"
                          />
                          <button type="button" onClick={() => setShowOpenaiKey(!showOpenaiKey)} className="absolute right-2 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface">
                            {showOpenaiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </div>

                      {/* Claude */}
                      <div className="bg-[#d97706]/5 border border-[#d97706]/15 rounded-xl p-4">
                        <AdminProviderEnableSwitch providerId="claude" />
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-bold text-on-surface">Claude</span>
                          <span className="text-[10px] bg-[#d97706]/10 text-[#d97706] px-2 py-0.5 rounded font-bold uppercase">Paid</span>
                        </div>
                        <div className="relative">
                          <input
                            type={showClaudeKey ? 'text' : 'password'}
                            value={claudeKey}
                            onChange={(e) => setClaudeKey(e.target.value)}
                            placeholder="sk-ant-..."
                            className="w-full bg-surface-container-low border border-surface-container-high rounded-lg px-3 py-2 pr-10 text-xs focus:outline-none focus:ring-2 focus:ring-[#d97706] transition-all font-mono"
                          />
                          <button type="button" onClick={() => setShowClaudeKey(!showClaudeKey)} className="absolute right-2 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface">
                            {showClaudeKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Save */}
                  <div className="flex items-center gap-4 mt-6 pt-6 border-t border-outline-variant/10">
                    <button
                      onClick={() => {
                        saveAIConfig(adminAiConfigPayload);
                        setApiSaveStatus('saved');
                        setTimeout(() => setApiSaveStatus('idle'), 3000);
                      }}
                      className="flex items-center gap-2 px-6 py-3 bg-primary text-white rounded-xl font-bold text-sm shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all active:scale-95"
                    >
                      <Save className="w-4 h-4" />
                      Lưu cài đặt
                    </button>
                    <AnimatePresence>
                      {apiSaveStatus === 'saved' && (
                        <motion.div
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0 }}
                          className="flex items-center gap-2 text-sm font-bold text-green-600"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          Đã lưu!
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                {/* Supabase status - unchanged */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="bg-surface-container-lowest p-8 rounded-xl shadow-sm border border-outline-variant/10">
                    <div className="flex items-center gap-3 mb-6">
                      <div className="bg-secondary-fixed p-2 rounded-lg">
                        <LayoutDashboard className="text-secondary w-6 h-6" />
                      </div>
                      <h3 className="font-headline font-bold text-xl">Supabase Cloud</h3>
                    </div>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-bold text-on-surface-variant mb-1">Connection Status</label>
                        <div className="flex items-center gap-2">
                          <div className={cn("w-3 h-3 rounded-full", isSupabaseConfigured ? "bg-green-500" : "bg-error")}></div>
                          <span className="text-sm font-medium">
                            {isSupabaseConfigured ? "Đã kết nối" : "Chưa cấu hình"}
                          </span>
                        </div>
                      </div>
                      <p className="text-xs text-on-surface-variant">
                        Yêu cầu <strong>VITE_SUPABASE_URL</strong> và <strong>VITE_SUPABASE_ANON_KEY</strong> để lưu trữ file âm thanh và transcript.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </main>

      {/* Custom Modals for Admin */}
      <AnimatePresence>
        {isRenameModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-surface p-8 rounded-2xl shadow-2xl w-full max-w-md border border-surface-container-low"
            >
              <h3 className="text-2xl font-black mb-6 font-headline tracking-tighter text-on-surface">Rename Recording</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-bold text-on-surface-variant mb-2 uppercase tracking-widest">New Title</label>
                  <input
                    type="text"
                    value={editTitleValue}
                    onChange={(e) => {
                      setEditTitleValue(e.target.value);
                      if (renameError) setRenameError("");
                    }}
                    className={cn(
                      "w-full bg-surface-container-low border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 transition-all text-on-surface",
                      renameError ? "border-error focus:ring-error" : "border-surface-container-high focus:ring-primary"
                    )}
                    placeholder="Enter new title..."
                  />
                  {renameError && (
                    <p className="mt-2 text-xs font-bold text-error uppercase tracking-wider animate-shake">
                      {renameError}
                    </p>
                  )}
                </div>
                <div className="flex gap-3 pt-4">
                  <button
                    onClick={() => setIsRenameModalOpen(false)}
                    className="flex-1 px-6 py-3 rounded-xl font-bold text-on-surface-variant hover:bg-surface-container-high transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={renameRecording}
                    disabled={isActionLoading}
                    className="flex-1 bg-primary text-white px-6 py-3 rounded-xl font-bold shadow-lg hover:shadow-primary/20 transition-all disabled:opacity-50"
                  >
                    {isActionLoading ? 'Renaming...' : 'Rename'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {isDeleteModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-surface p-8 rounded-2xl shadow-2xl w-full max-w-md border border-surface-container-low"
            >
              <div className="bg-error/10 w-16 h-16 rounded-full flex items-center justify-center mb-6 mx-auto">
                <Trash2 className="text-error w-8 h-8" />
              </div>
              <h3 className="text-2xl font-black mb-2 font-headline tracking-tighter text-on-surface text-center">
                {itemToDelete ? "Xóa bản ghi?" : `Xóa ${selectedIds.length} bản ghi?`}
              </h3>
              <p className="text-on-surface-variant text-center mb-8 leading-relaxed">
                {itemToDelete
                  ? `Bạn có chắc chắn muốn xóa "${itemToDelete.title}"? Hành động này không thể hoàn tác.`
                  : `Bạn có chắc chắn muốn xóa ${selectedIds.length} bản ghi đã chọn? Hành động này không thể hoàn tác.`
                }
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setIsDeleteModalOpen(false);
                    setItemToDelete(null);
                  }}
                  className="flex-1 px-6 py-3 rounded-xl font-bold text-on-surface-variant hover:bg-surface-container-high transition-colors"
                >
                  Hủy
                </button>
                <button
                  onClick={deleteMultipleRecordings}
                  disabled={isActionLoading}
                  className="flex-1 bg-error text-white px-6 py-3 rounded-xl font-bold shadow-lg shadow-error/20 hover:shadow-error/30 transition-all disabled:opacity-50"
                >
                  {isActionLoading ? 'Đang xóa...' : 'Xóa ngay'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

// ──────────────────────────────────────────────
// APP LOGIN GATE
// Hardcoded credentials - wraps entire app
// ──────────────────────────────────────────────
const APP_CREDENTIALS = { username: 'nganttb', password: 'Nganxinhdep' };
const APP_AUTH_KEY = 'sonic_lens_authenticated';

const AppLoginPage = ({ onLogin }: { onLogin: (remember: boolean) => void }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState('');
  const [isShaking, setIsShaking] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (username === APP_CREDENTIALS.username && password === APP_CREDENTIALS.password) {
      onLogin(remember);
    } else {
      setError('Sai tai khoan hoac mat khau!');
      setIsShaking(true);
      setTimeout(() => setIsShaking(false), 500);
    }
  };

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center px-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/5 rounded-full blur-3xl"></div>
        <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-secondary/5 rounded-full blur-3xl"></div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className={cn(
          "relative w-full max-w-md bg-surface-container-lowest rounded-2xl shadow-2xl border border-outline-variant/10 p-8",
          isShaking && "animate-shake"
        )}
      >
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-secondary mb-4">
            <Mic className="w-8 h-8 text-white" />
          </div>
          <h1 className="font-headline font-extrabold text-3xl tracking-tight text-on-surface">Sonic Lens</h1>
          <p className="text-sm text-on-surface-variant mt-1">Dang nhap de tiep tuc</p>
        </div>

        {/* Error */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-4 bg-error/10 border border-error/20 rounded-xl px-4 py-3 flex items-center gap-2"
            >
              <AlertCircle className="w-4 h-4 text-error shrink-0" />
              <span className="text-sm text-error font-medium">{error}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="login-username" className="block text-sm font-bold text-on-surface-variant mb-2">
              Tai khoan
            </label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-variant" />
              <input
                id="login-username"
                type="text"
                value={username}
                onChange={(e) => { setUsername(e.target.value); setError(''); }}
                placeholder="Nhap tai khoan"
                autoComplete="username"
                className="w-full bg-surface-container-low border border-surface-container-high rounded-xl pl-10 pr-4 py-3 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary transition-all"
              />
            </div>
          </div>

          <div>
            <label htmlFor="login-password" className="block text-sm font-bold text-on-surface-variant mb-2">
              Mat khau
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-variant" />
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(''); }}
                placeholder="Nhap mat khau"
                autoComplete="current-password"
                className="w-full bg-surface-container-low border border-surface-container-high rounded-xl pl-10 pr-12 py-3 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface transition-colors"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setRemember(!remember)}
              className={cn(
                "w-5 h-5 rounded border-2 flex items-center justify-center transition-all",
                remember ? "bg-primary border-primary" : "border-surface-container-highest"
              )}
            >
              {remember && <CheckCircle2 className="w-3 h-3 text-white" />}
            </button>
            <span className="text-sm text-on-surface-variant select-none cursor-pointer" onClick={() => setRemember(!remember)}>
              Ghi nho dang nhap
            </span>
          </div>

          <button
            type="submit"
            className="w-full bg-gradient-to-r from-primary to-secondary text-white font-bold py-3 rounded-xl hover:opacity-90 active:scale-[0.98] transition-all shadow-lg"
          >
            Dang nhap
          </button>
        </form>

        <p className="text-center text-xs text-on-surface-variant/50 mt-6">
          Sonic Lens &bull; Private Access Only
        </p>
      </motion.div>
    </div>
  );
};

export default function App() {
  const [isAppAuthenticated, setIsAppAuthenticated] = useState(() => {
    return localStorage.getItem(APP_AUTH_KEY) === 'true';
  });

  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(() => {
    return localStorage.getItem("isAdminAuthenticated") === "true";
  });

  const handleAppLogin = (remember: boolean) => {
    setIsAppAuthenticated(true);
    if (remember) {
      localStorage.setItem(APP_AUTH_KEY, 'true');
    }
  };

  const handleAdminLogin = (remember: boolean) => {
    setIsAdminAuthenticated(true);
    if (remember) {
      localStorage.setItem("isAdminAuthenticated", "true");
    }
  };

  // Show login gate if not authenticated
  if (!isAppAuthenticated) {
    return <AppLoginPage onLogin={handleAppLogin} />;
  }

  return (
    <Router>
      <div className="min-h-screen flex flex-col bg-surface">
        <Navbar />
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route
            path="/admin"
            element={
              isAdminAuthenticated ? (
                <AdminDashboard />
              ) : (
                <AdminLogin onLogin={handleAdminLogin} />
              )
            }
          />
        </Routes>

        <footer className="bg-surface w-full py-12 mt-auto border-t border-surface-container-low">
          <div className="flex flex-col items-center justify-center gap-4 w-full">
            <p className="font-body text-xs text-on-surface-variant">
              © 2026 Sonic Lens. Developement for <a href="https://nhduy1703.vercel.app/" target="_blank" rel="noopener noreferrer" className="font-bold text-primary hover:opacity-80 transition-opacity">Nguyễn Hoàng Duy</a>
            </p>
          </div>
        </footer>
      </div>
    </Router>
  );
}
