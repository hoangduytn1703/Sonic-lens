import React, { useState, useEffect, useRef } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useNavigate, useLocation } from 'react-router-dom';
import { Mic, Settings, User, Play, Square, Pause, Trash2, Star, ChevronRight, LogOut, LayoutDashboard, ShieldCheck, Download, Share2, Search, MoreVertical, Upload, Edit2, FileText, X, CheckCircle2, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';
import { saveAs } from 'file-saver';
import { Document, Packer, Paragraph, TextRun, AlignmentType, HeadingLevel } from 'docx';
import { cn, formatDuration } from './lib/utils';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import { transcribeAudio } from './services/gemini';
import { Recording, TranscriptItem } from './types';

// --- Utils ---

const exportToWord = async (data: { title: string, transcript: TranscriptItem[], summary?: string, created_at: string }) => {
  if (!data.transcript || data.transcript.length === 0) {
    alert("Không có transcript để export.");
    return;
  }

  const doc = new Document({
    sections: [{
      properties: {},
      children: [
        new Paragraph({
          text: data.title,
          heading: HeadingLevel.HEADING_1,
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 }
        }),
        new Paragraph({
          children: [
            new TextRun({ text: `Ngày tạo: ${format(new Date(data.created_at), 'dd/MM/yyyy HH:mm')}`, bold: true }),
          ],
          spacing: { after: 400 }
        }),
        ...(data.summary ? [
          new Paragraph({
            text: "TÓM TẮT NỘI DUNG",
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 200, after: 100 }
          }),
          new Paragraph({
            text: data.summary,
            spacing: { after: 400 }
          })
        ] : []),
        new Paragraph({
          text: "TRANSCRIPT CHI TIẾT",
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 200, after: 100 }
        }),
        ...data.transcript.map(item => new Paragraph({
          children: [
            new TextRun({ text: `[${item.timestamp}] ${item.speaker} (${item.gender || 'Không rõ'}): `, bold: true }),
            new TextRun({ text: item.text, italics: item.isUncertain })
          ],
          spacing: { after: 100 }
        }))
      ]
    }]
  });

  const blob = await Packer.toBlob(doc);
  saveAs(blob, `${data.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_transcript.docx`);
};

// --- Components ---

const Navbar = () => {
  const location = useLocation();
  const isAdmin = location.pathname.startsWith('/admin');

  return (
    <header className="bg-surface fixed top-0 left-0 right-0 z-50 border-b border-surface-container-low">
      <div className="flex justify-between items-center px-8 py-4 w-full max-w-full mx-auto">
        <div className="flex items-center gap-8">
          <Link to="/" className="text-2xl font-black tracking-tighter text-primary font-headline">Sonic Lens</Link>
          <nav className="hidden md:flex gap-6 items-center">
            <Link 
              to="/" 
              className={cn(
                "font-headline tracking-tight transition-colors duration-200",
                !isAdmin ? "text-primary font-bold border-b-2 border-primary" : "text-on-surface-variant font-medium hover:text-primary"
              )}
            >
              Dashboard
            </Link>
            <Link 
              to="/admin" 
              className={cn(
                "font-headline tracking-tight transition-colors duration-200",
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

const Dashboard = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [duration, setDuration] = useState(0);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingCount, setProcessingCount] = useState(0);
  const [currentTranscript, setCurrentTranscript] = useState<string>("");
  const [fullTranscript, setFullTranscript] = useState<TranscriptItem[]>([]);
  const [lastAudioUrl, setLastAudioUrl] = useState<string | null>(null);
  const [finalAudioBlob, setFinalAudioBlob] = useState<Blob | null>(null);
  const [shouldSave, setShouldSave] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [pendingTitle, setPendingTitle] = useState("");
  const [isTitleDuplicate, setIsTitleDuplicate] = useState(false);
  const [savedRecordingId, setSavedRecordingId] = useState<string | null>(null);
  const allBlobsRef = useRef<Blob[]>([]);
  const isWaitingForFinalBlobRef = useRef(false);
  const fullSummaryRef = useRef<string>("");
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Effect to handle final save when recording is stopped and processing is done
  useEffect(() => {
    if (shouldSave && !isRecording && processingCount === 0 && (finalAudioBlob || allBlobsRef.current.length > 0)) {
      // Show modal instead of saving directly
      const defaultTitle = `Meeting ${format(new Date(), 'dd/MM/yyyy HH:mm')}`;
      setPendingTitle(defaultTitle);
      setShowSaveModal(true);
      setShouldSave(false);
    }
  }, [shouldSave, isRecording, processingCount, finalAudioBlob, fullTranscript, duration]);

  const checkDuplicateTitle = async (title: string) => {
    if (!isSupabaseConfigured) return false;
    const { data, error } = await supabase
      .from('recordings')
      .select('id')
      .eq('title', title)
      .limit(1);
    
    return data && data.length > 0;
  };

  const saveToSupabase = async (title: string) => {
    if (!isSupabaseConfigured) {
      console.warn("Supabase chưa được cấu hình. Vui lòng kiểm tra API Key.");
      return;
    }

    const blobToSave = finalAudioBlob || (allBlobsRef.current.length > 0 ? allBlobsRef.current[0] : null);
    if (!blobToSave) {
      console.error("Không có dữ liệu âm thanh để lưu.");
      return;
    }

    setSaveStatus('saving');
    try {
      // Check duplicate again just in case
      const isDuplicate = await checkDuplicateTitle(title);
      if (isDuplicate) {
        setIsTitleDuplicate(true);
        setSaveStatus('idle');
        return;
      }

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

      const { data: insertData, error: dbError } = await supabase.from('recordings').insert({
        title: title,
        audio_url: publicUrl,
        transcript: fullTranscript,
        summary: fullSummaryRef.current,
        duration: duration,
        is_important: false
      }).select();

      if (dbError) {
        console.error("Chi tiết lỗi Database:", dbError);
        throw new Error(`Lỗi lưu Database: ${dbError.message}`);
      }
      
      console.log("Đã lưu vào Supabase thành công!");
      if (insertData && insertData.length > 0) {
        setSavedRecordingId(insertData[0].id);
      }
      setSaveStatus('success');
      setShowSaveModal(false);
      // Reset status after a while
      setTimeout(() => setSaveStatus('idle'), 5000);
    } catch (storageErr: any) {
      console.error("Lỗi Supabase khi lưu bản ghi:", storageErr);
      setSaveStatus('error');
    }
  };

  const handleExport = () => {
    exportToWord({
      title: pendingTitle,
      transcript: fullTranscript,
      summary: fullSummaryRef.current,
      created_at: new Date().toISOString()
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
      fullSummaryRef.current = "";
      setFullTranscript([]);
      setProcessingCount(0);
      setSaveStatus('idle');

      setupRecorder(recorder);

      recorder.start();
      setMediaRecorder(recorder);
      setIsRecording(true);
      setIsPaused(false);
      setDuration(0);
      setCurrentTranscript("");
      setLastAudioUrl(null);
    } catch (err) {
      console.error("Error accessing microphone:", err);
      alert("Không thể truy cập microphone. Vui lòng kiểm tra quyền truy cập.");
    }
  };

  const finalizeRecording = async () => {
    if (allBlobsRef.current.length > 0) {
      setIsProcessing(true);
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
          setShouldSave(true);
          console.log(`Ghi âm hoàn tất. Đã hợp nhất ${audioBuffers.length} đoạn thành file WAV.`);
        }
      } catch (err) {
        console.error("Error finalizing recording:", err);
      } finally {
        setIsProcessing(false);
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
      console.log(`Đã thu thập đoạn âm thanh thứ ${allBlobsRef.current.length}`);
      
      handleSegmentTranscription(audioBlob);

      // Nếu đây là đoạn cuối cùng (được kích hoạt từ stopRecording)
      if (isWaitingForFinalBlobRef.current) {
        await finalizeRecording();
      }
    };
  };

  const handleSegmentTranscription = async (blob: Blob) => {
    setProcessingCount(prev => prev + 1);
    setIsProcessing(true);
    try {
      const reader = new FileReader();
      reader.readAsDataURL(blob);
      reader.onloadend = async () => {
        const base64Audio = (reader.result as string).split(',')[1];
        try {
          const result = await transcribeAudio(base64Audio, blob.type);
          
          setFullTranscript(prev => [...prev, ...result.transcript]);
          if (result.summary) {
            fullSummaryRef.current = fullSummaryRef.current ? fullSummaryRef.current + " " + result.summary : result.summary;
          }
        } catch (err: any) {
          console.error("Transcription error:", err);
          setCurrentTranscript(prev => prev + `\n\n[Lỗi AI: ${err.message}]`);
        } finally {
          setProcessingCount(prev => Math.max(0, prev - 1));
        }
      };
    } catch (err) {
      console.error("Error processing segment:", err);
      setProcessingCount(prev => Math.max(0, prev - 1));
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Hỗ trợ .mp4, .m4a, .mp3, .wav, .mpeg
    const isAudio = file.type.startsWith('audio/');
    const isVideo = file.type.startsWith('video/') || file.name.endsWith('.mp4') || file.name.endsWith('.m4a');
    
    if (!isAudio && !isVideo) {
      alert("Vui lòng chọn file âm thanh hoặc video (.mp3, .wav, .m4a, .mp4, ...)");
      return;
    }

    setIsProcessing(true);
    setSaveStatus('idle');
    allBlobsRef.current = [file];
    setFinalAudioBlob(file);
    fullSummaryRef.current = "";
    setFullTranscript([]);
    setCurrentTranscript("Đang tải file và phân tích nội dung...");
    setDuration(0);

    try {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onloadend = async () => {
        const base64Audio = (reader.result as string).split(',')[1];
        try {
          const result = await transcribeAudio(base64Audio, file.type || 'audio/mp4');
          
          setFullTranscript(result.transcript);
          fullSummaryRef.current = result.summary;
          setShouldSave(true); 
          setIsProcessing(false);
          setCurrentTranscript("");
          console.log("Import file thành công và đã gửi lưu Admin.");
        } catch (err: any) {
          console.error("Transcription error:", err);
          setCurrentTranscript(`[Lỗi AI: ${err.message}]`);
          setIsProcessing(false);
        }
      };
    } catch (err) {
      console.error("Error processing file:", err);
      setIsProcessing(false);
    }
  };

  // Sync isProcessing with processingCount
  useEffect(() => {
    setIsProcessing(processingCount > 0);
  }, [processingCount]);

  const pauseRecording = () => {
    if (mediaRecorder && isRecording && !isPaused) {
      setIsPaused(true);
      mediaRecorder.stop(); 
    }
  };

  const resumeRecording = () => {
    if (isRecording && isPaused) {
      setIsPaused(false);
      startNewSegment();
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
        // Nếu recorder đã dừng (đang ở trạng thái pause), ta có thể finalize luôn
        finalizeRecording();
      }
    }
  };

  return (
    <main className="flex-1 w-full max-w-5xl mx-auto px-6 pt-32 pb-12 flex flex-col items-center justify-center gap-16">
      <section className="w-full flex flex-col items-center gap-8">
        <div className="relative group flex flex-col items-center gap-6">
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className={cn(
                "absolute inset-0 bg-primary opacity-20 blur-3xl rounded-full transition-opacity",
                isRecording && !isPaused ? "opacity-40 animate-pulse" : "group-hover:opacity-30"
              )}></div>
              <button 
                onClick={isRecording ? stopRecording : startRecording}
                disabled={isProcessing && !isRecording}
                className={cn(
                  "relative w-24 h-24 rounded-full flex items-center justify-center text-white shadow-2xl transition-all active:scale-90 hover:scale-105 group disabled:opacity-50",
                  isRecording ? "bg-error" : "bg-gradient-to-br from-primary to-secondary"
                )}
              >
                {isRecording ? <Square className="w-8 h-8 fill-current" /> : <Mic className="w-10 h-10 fill-current" />}
              </button>
            </div>

            {isRecording && (
              <button 
                onClick={isPaused ? resumeRecording : pauseRecording}
                disabled={isPaused && isProcessing}
                className={cn(
                  "w-16 h-16 rounded-full flex items-center justify-center shadow-xl transition-all active:scale-90 disabled:opacity-50 disabled:cursor-not-allowed",
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
                  className="w-16 h-16 rounded-full bg-surface-container-high text-on-surface flex items-center justify-center shadow-xl transition-all active:scale-90 hover:bg-surface-container-highest disabled:opacity-50"
                  title="Import file âm thanh"
                >
                  <Upload className="w-6 h-6" />
                </button>
              </>
            )}
          </div>

          {lastAudioUrl && !isRecording && (
            <div className="w-full max-w-md bg-surface-container-low p-4 rounded-xl border border-outline-variant/20 flex flex-col gap-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">Nghe lại bản vừa ghi</p>
              <audio controls src={lastAudioUrl} className="w-full h-8" />
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
                isRecording ? "bg-primary waveform-bar" : "bg-surface-container-highest h-2"
              )}
              style={{ animationDelay: `${i * 0.1}s`, height: isRecording ? undefined : `${[2,4,3,6,4,2,5,3][i] * 4}px` }}
            ></div>
          ))}
        </div>
      </section>

      <section className="w-full max-w-4xl">
        <div className="bg-surface-container-lowest rounded-2xl p-10 shadow-[0_20px_40px_-10px_rgba(19,27,46,0.04)] border border-outline-variant/10 min-h-[400px]">
          <div className="flex items-center justify-between mb-8">
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
            {fullTranscript.length > 0 ? (
              <div className="space-y-6">
                {fullTranscript.map((item, idx) => (
                  <div key={idx} className="flex flex-col gap-1.5 group">
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
                      item.isUncertain ? "text-error font-medium italic" : "text-on-surface"
                    )}>
                      {item.text}
                      {item.isUncertain && (
                        <span className="ml-2 inline-flex items-center gap-1 text-[9px] bg-error/10 text-error px-1.5 py-0.5 rounded border border-error/20 not-italic font-bold uppercase tracking-tighter">
                          AI không chắc chắn
                        </span>
                      )}
                    </p>
                  </div>
                ))}
              </div>
            ) : currentTranscript ? (
              <div className="text-xl font-body text-on-surface whitespace-pre-wrap italic opacity-70">
                {currentTranscript}
              </div>
            ) : (
              <div className="flex flex-col gap-4 opacity-30">
                <div className="h-4 bg-surface-container rounded w-3/4"></div>
                <div className="h-4 bg-surface-container rounded w-1/2"></div>
                <div className="h-4 bg-surface-container rounded w-2/3"></div>
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

      {/* Save Modal */}
      <AnimatePresence>
        {showSaveModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"
            >
              <div className="p-6">
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-xl font-headline font-black text-on-surface">Lưu bản ghi</h3>
                  <button onClick={() => setShowSaveModal(false)} className="text-on-surface-variant hover:text-on-surface">
                    <X className="w-6 h-6" />
                  </button>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-bold text-on-surface-variant mb-2 uppercase tracking-wider">Tên bản ghi</label>
                    <input 
                      type="text" 
                      value={pendingTitle}
                      onChange={(e) => {
                        setPendingTitle(e.target.value);
                        setIsTitleDuplicate(false);
                      }}
                      className={cn(
                        "w-full px-4 py-3 rounded-xl border font-body text-on-surface focus:outline-none focus:ring-2 transition-all",
                        isTitleDuplicate ? "border-error focus:ring-error/20" : "border-outline-variant focus:ring-primary/20"
                      )}
                      placeholder="Nhập tên cho cuộc hội thoại..."
                      autoFocus
                    />
                    {isTitleDuplicate && (
                      <p className="mt-2 text-xs text-error font-bold flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" /> Tên này đã tồn tại. Vui lòng chọn tên khác.
                      </p>
                    )}
                  </div>

                  <div className="bg-surface-container-low p-4 rounded-xl border border-outline-variant/30">
                    <div className="flex justify-between text-xs text-on-surface-variant mb-1">
                      <span>Thời lượng</span>
                      <span>{formatDuration(duration)}</span>
                    </div>
                    <div className="flex justify-between text-xs text-on-surface-variant">
                      <span>Ngày tạo</span>
                      <span>{format(new Date(), 'dd/MM/yyyy HH:mm')}</span>
                    </div>
                  </div>
                </div>

                <div className="mt-8 flex gap-3">
                  <button 
                    onClick={() => setShowSaveModal(false)}
                    className="flex-1 py-3 rounded-xl font-bold text-on-surface-variant hover:bg-surface-container-high transition-colors"
                  >
                    Hủy
                  </button>
                  <button 
                    onClick={() => saveToSupabase(pendingTitle)}
                    disabled={!pendingTitle.trim() || saveStatus === 'saving'}
                    className="flex-1 py-3 bg-primary text-white rounded-xl font-bold shadow-lg shadow-primary/20 hover:bg-primary/90 transition-all disabled:opacity-50 disabled:shadow-none flex items-center justify-center gap-2"
                  >
                    {saveStatus === 'saving' ? (
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <>Lưu ngay</>
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Success State Overlay */}
      <AnimatePresence>
        {saveStatus === 'success' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-white/90 backdrop-blur-md"
          >
            <div className="text-center max-w-sm">
              <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <CheckCircle2 className="w-10 h-10 text-green-600" />
              </div>
              <h2 className="text-3xl font-headline font-black text-on-surface mb-2">Đã lưu thành công!</h2>
              <p className="text-on-surface-variant mb-8">Bản ghi của bạn đã được lưu trữ an toàn trong Admin Panel.</p>
              <div className="flex flex-col gap-3">
                <button 
                  onClick={handleExport}
                  className="w-full py-4 bg-primary text-white rounded-2xl font-bold shadow-xl shadow-primary/20 hover:bg-primary/90 transition-all flex items-center justify-center gap-2"
                >
                  <FileText className="w-5 h-5" /> Export Script (Word)
                </button>
                <button 
                  onClick={() => setSaveStatus('idle')}
                  className="w-full py-4 text-on-surface-variant font-bold hover:bg-surface-container-high rounded-2xl transition-all"
                >
                  Quay lại Dashboard
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
};

const AdminLogin = ({ onLogin }: { onLogin: () => void }) => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (username === "admin" && password === "admin@1703") {
      onLogin();
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

  useEffect(() => {
    fetchRecordings();
  }, []);

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

  const deleteRecording = async (id: string) => {
    if (!confirm("Bạn có chắc chắn muốn xóa bản ghi này?")) return;
    
    const { error } = await supabase
      .from('recordings')
      .delete()
      .eq('id', id);
    
    if (!error) {
      setRecordings(prev => prev.filter(r => r.id !== id));
      if (selectedRecording?.id === id) setSelectedRecording(null);
    }
  };

  const renameRecording = async (id: string, currentTitle: string) => {
    const newTitle = prompt("Nhập tên mới cho bản ghi:", currentTitle);
    if (!newTitle || newTitle === currentTitle) return;

    const { error } = await supabase
      .from('recordings')
      .update({ title: newTitle })
      .eq('id', id);
    
    if (!error) {
      setRecordings(prev => prev.map(r => r.id === id ? { ...r, title: newTitle } : r));
      if (selectedRecording?.id === id) {
        setSelectedRecording(prev => prev ? { ...prev, title: newTitle } : null);
      }
    }
  };

  return (
    <div className="flex flex-1 pt-16">
      <aside className="h-screen w-64 fixed left-0 top-0 pt-20 bg-surface-container-low flex flex-col gap-2 p-4 border-r border-surface-container-low z-40">
        <div className="mb-6 px-2">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-full bg-primary-fixed flex items-center justify-center overflow-hidden">
              <User className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h3 className="font-headline font-bold text-sm text-on-surface">Admin Panel</h3>
              <p className="text-xs text-on-surface-variant">Quản lý hệ thống</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 flex flex-col gap-1">
          <button 
            onClick={() => setActiveTab('recordings')}
            className={cn(
              "rounded-lg shadow-sm font-semibold flex items-center gap-3 px-4 py-3 transition-all duration-200",
              activeTab === 'recordings' ? "bg-white text-primary" : "text-on-surface-variant hover:bg-white/50"
            )}
          >
            <Mic className="w-5 h-5" />
            <span className="font-body text-sm font-medium">Bản ghi âm</span>
          </button>
          <button 
            onClick={() => setActiveTab('api')}
            className={cn(
              "rounded-lg shadow-sm font-semibold flex items-center gap-3 px-4 py-3 transition-all duration-200",
              activeTab === 'api' ? "bg-white text-primary" : "text-on-surface-variant hover:bg-white/50"
            )}
          >
            <Settings className="w-5 h-5" />
            <span className="font-body text-sm font-medium">Cài đặt API</span>
          </button>
        </nav>
        <div className="mt-auto border-t border-outline-variant/30 pt-4">
          <button onClick={() => window.location.reload()} className="text-on-surface-variant hover:bg-white/50 w-full rounded-lg flex items-center gap-3 px-4 py-3 transition-all duration-200">
            <LogOut className="w-5 h-5" />
            <span className="font-body text-sm font-medium">Đăng xuất</span>
          </button>
        </div>
      </aside>

      <main className="flex-1 ml-64 p-8 bg-surface">
        <div className="max-w-6xl mx-auto">
          {activeTab === 'recordings' ? (
            <>
              <header className="mb-10">
                <h1 className="text-4xl font-black font-headline tracking-tight text-on-surface mb-2">Quản lý bản ghi</h1>
                <p className="text-on-surface-variant font-body">Xem lại và quản lý các cuộc hội thoại đã được AI chuyển đổi.</p>
              </header>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                <div className="lg:col-span-4 flex flex-col gap-4">
                  <div className="bg-surface-container-low rounded-xl p-2 space-y-2 max-h-[70vh] overflow-y-auto">
                    {loading ? (
                      <div className="p-4 text-center text-on-surface-variant">Đang tải...</div>
                    ) : recordings.length === 0 ? (
                      <div className="p-4 text-center text-on-surface-variant">Chưa có bản ghi nào.</div>
                    ) : (
                      recordings.map(rec => (
                        <div 
                          key={rec.id}
                          onClick={() => setSelectedRecording(rec)}
                          className={cn(
                            "p-4 rounded-lg shadow-sm cursor-pointer transition-all",
                            selectedRecording?.id === rec.id ? "bg-white border-l-4 border-primary" : "hover:bg-surface-container-high"
                          )}
                        >
                          <div className="flex justify-between items-start mb-1">
                            <span className="text-xs font-bold text-primary uppercase tracking-wider">
                              {rec.is_important && <Star className="w-3 h-3 fill-current inline mr-1" />}
                              {format(new Date(rec.created_at), 'HH:mm')}
                            </span>
                            <span className="text-xs text-on-surface-variant">{format(new Date(rec.created_at), 'dd/MM/yyyy HH:mm')}</span>
                          </div>
                          <h4 className="font-headline font-bold text-on-surface truncate">{rec.title}</h4>
                          <div className="flex items-center gap-3 mt-2">
                            <span className="flex items-center gap-1 text-xs text-on-surface-variant">
                              <Play className="w-3 h-3" /> {formatDuration(rec.duration)}
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="lg:col-span-8 space-y-6">
                  {selectedRecording ? (
                    <>
                      <div className="bg-surface-container-lowest rounded-xl p-6 shadow-sm border border-outline-variant/10">
                        <div className="flex items-center justify-between mb-8">
                          <div className="flex items-center gap-4">
                            <button className="bg-primary-fixed p-3 rounded-full text-primary">
                              <Play className="w-6 h-6 fill-current" />
                            </button>
                            <div>
                              <h2 className="text-xl font-headline font-extrabold text-on-surface">{selectedRecording.title}</h2>
                              <p className="text-sm text-on-surface-variant">
                                {format(new Date(selectedRecording.created_at), 'dd/MM/yyyy HH:mm')} • {formatDuration(selectedRecording.duration)}
                              </p>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button onClick={() => toggleImportant(selectedRecording.id, selectedRecording.is_important)} className={cn("p-2 transition-colors", selectedRecording.is_important ? "text-yellow-500" : "text-on-surface-variant hover:text-yellow-500")}>
                              <Star className={cn("w-5 h-5", selectedRecording.is_important && "fill-current")} />
                            </button>
                            <button onClick={() => renameRecording(selectedRecording.id, selectedRecording.title)} className="p-2 text-on-surface-variant hover:text-primary transition-colors">
                              <Edit2 className="w-5 h-5" />
                            </button>
                            <button onClick={() => exportToWord(selectedRecording)} className="p-2 text-on-surface-variant hover:text-primary transition-colors" title="Export to Word">
                              <FileText className="w-5 h-5" />
                            </button>
                            <button onClick={() => deleteRecording(selectedRecording.id)} className="p-2 text-on-surface-variant hover:text-error transition-colors">
                              <Trash2 className="w-5 h-5" />
                            </button>
                          </div>
                        </div>
                        
                        <audio controls src={selectedRecording.audio_url} className="w-full mb-4" />
                        
                        {selectedRecording.summary && (
                          <div className="bg-primary-fixed/20 p-4 rounded-lg border border-primary-fixed">
                            <h4 className="font-headline font-bold text-sm text-primary mb-1 uppercase tracking-wider">Tóm tắt AI</h4>
                            <p className="text-on-surface text-sm leading-relaxed">{selectedRecording.summary}</p>
                          </div>
                        )}
                      </div>

                      <div className="bg-surface-container-lowest rounded-xl p-8 shadow-sm border border-outline-variant/10 min-h-[400px]">
                        <div className="flex items-center gap-6 mb-8 border-b border-outline-variant/10 pb-4">
                          <span className="px-3 py-1 bg-secondary-fixed text-on-secondary-fixed text-xs font-bold rounded-md uppercase">Transcript</span>
                          <div className="flex items-center gap-4 text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                            <div className="flex items-center gap-1.5">
                              <div className="w-2 h-2 rounded-full bg-blue-400"></div> Nam
                            </div>
                            <div className="flex items-center gap-1.5">
                              <div className="w-2 h-2 rounded-full bg-pink-400"></div> Nữ
                            </div>
                            <div className="flex items-center gap-1.5 text-error">
                              <div className="w-2 h-2 rounded-full bg-error"></div> Không rõ
                            </div>
                          </div>
                        </div>
                        <div className="space-y-8">
                          {selectedRecording.transcript.map((item, idx) => (
                            <div key={idx} className="flex gap-6 group">
                              <div className="w-24 shrink-0 text-xs font-mono text-on-surface-variant uppercase tracking-tighter pt-1 opacity-50">{item.timestamp}</div>
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-1.5">
                                  <span className={cn(
                                    "px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider",
                                    item.gender === 'Nam' ? "bg-blue-100 text-blue-700" : 
                                    item.gender === 'Nữ' ? "bg-pink-100 text-pink-700" : "bg-surface-container-highest text-on-surface-variant"
                                  )}>
                                    {item.speaker} {item.gender ? `• ${item.gender}` : ""}
                                  </span>
                                </div>
                                <p className={cn(
                                  "text-lg leading-relaxed font-body transition-colors",
                                  item.isUncertain ? "text-error font-medium italic" : "text-on-surface"
                                )}>
                                  {item.text}
                                  {item.isUncertain && (
                                    <span className="ml-2 inline-flex items-center gap-1 text-[9px] bg-error/10 text-error px-1.5 py-0.5 rounded border border-error/20 not-italic font-bold uppercase tracking-tighter">
                                      AI không chắc chắn
                                    </span>
                                  )}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="bg-surface-container-lowest rounded-xl p-20 shadow-sm border border-outline-variant/10 flex flex-col items-center justify-center text-center">
                      <Mic className="w-16 h-16 text-surface-container-highest mb-4" />
                      <h3 className="text-xl font-headline font-bold text-on-surface">Chọn một bản ghi</h3>
                      <p className="text-on-surface-variant max-w-xs">Chọn một cuộc hội thoại từ danh sách bên trái để xem chi tiết và transcript.</p>
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <>
              <header className="mb-10">
                <h1 className="text-4xl font-black font-headline tracking-tight text-on-surface mb-2">Cài đặt API</h1>
                <p className="text-on-surface-variant font-body">Cấu hình các dịch vụ AI và Cơ sở dữ liệu.</p>
              </header>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="bg-surface-container-lowest p-8 rounded-xl shadow-sm border border-outline-variant/10">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="bg-primary-fixed p-2 rounded-lg">
                      <ShieldCheck className="text-primary w-6 h-6" />
                    </div>
                    <h3 className="font-headline font-bold text-xl">Google Gemini AI</h3>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-bold text-on-surface-variant mb-1">API Key Status</label>
                      <div className="flex items-center gap-2">
                        <div className={cn("w-3 h-3 rounded-full", process.env.GEMINI_API_KEY ? "bg-green-500" : "bg-error")}></div>
                        <span className="text-sm font-medium">
                          {process.env.GEMINI_API_KEY ? "Đã cấu hình" : "Chưa có API Key"}
                        </span>
                      </div>
                    </div>
                    <p className="text-xs text-on-surface-variant">
                      Bạn cần thêm <strong>GEMINI_API_KEY</strong> vào mục <strong>Secrets</strong> của AI Studio để kích hoạt tính năng chuyển đổi giọng nói.
                    </p>
                  </div>
                </div>

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
            </>
          )}
        </div>
      </main>
    </div>
  );
};

export default function App() {
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);

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
                <AdminLogin onLogin={() => setIsAdminAuthenticated(true)} />
              )
            } 
          />
        </Routes>
        
        <footer className="bg-surface w-full py-12 mt-auto border-t border-surface-container-low">
          <div className="flex flex-col items-center justify-center gap-4 w-full">
            <p className="font-body text-xs text-on-surface-variant">© 2026 Sonic Lens. Built for focused thought.</p>
            <div className="flex gap-6">
              <span className="text-on-surface-variant hover:text-primary transition-colors text-xs font-medium cursor-pointer">Privacy Policy</span>
              <span className="text-on-surface-variant hover:text-primary transition-colors text-xs font-medium cursor-pointer">Terms of Service</span>
              <span className="text-on-surface-variant hover:text-primary transition-colors text-xs font-medium cursor-pointer">Documentation</span>
            </div>
          </div>
        </footer>
      </div>
    </Router>
  );
}
