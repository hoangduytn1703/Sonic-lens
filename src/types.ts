export interface TranscriptItem {
  speaker: string;
  text: string;
  timestamp: string;
  gender?: 'Nam' | 'Nữ' | 'Không rõ';
  isUncertain?: boolean;
}

export interface Recording {
  id: string;
  created_at: string;
  title: string;
  audio_url: string;
  transcript: TranscriptItem[];
  summary: string;
  /** True if user saved while AI summary was still in progress (Admin can re-run analysis). */
  summary_incomplete_at_save?: boolean;
  duration: number;
  is_important: boolean;
  source: 'live' | 'upload';
}
