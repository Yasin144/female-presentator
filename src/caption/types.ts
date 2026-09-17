// Caption Burner — Types (v3 — auto-detect language)
export interface WordItem { text: string; start: number; end: number; }
export interface CaptionItem { start: number; end: number; text: string; words?: WordItem[]; }
export type ItemStatus = 'idle'|'transcribing'|'transcribed'|'exporting'|'completed'|'failed'|'cancelled';
export interface VideoMeta {
  name: string; mimeType: string; file?: File; base64?: string; duration?: number; width?: number; height?: number;
}
export interface QueueItem {
  id: string; video: VideoMeta; status: ItemStatus;
  progress: number; message: string; retryCount: number;
  language?: Language;
  captions?: CaptionItem[]; outputUrl?: string;
  outputPath?: string; outputFileName?: string;
  detectedLang?: string;   // e.g. "Telugu", "Hindi"
}
export type FontColor  = 'White'|'Yellow'|'Cyan'|'Black';
export type BgColor    = 'Black (70%)'|'White (20%)'|'Black'|'Transparent';
export type CaptionStyle = 'pill'|'outline'|'minimal'|'white-yellow';
export type Position   = 'top'|'bottom'|'custom';
export const CAPTION_LANGUAGES = [
  'Auto-Detect',
  'Telugu',
  'English',
  'Hindi',
  'Tamil',
  'Kannada',
  'Malayalam',
  'Urdu',
  'Arabic',
] as const;

export type Language = typeof CAPTION_LANGUAGES[number];

export type TranscriptionEngine = 'auto' | 'local' | 'groq';

export interface CaptionSettings {
  contentMode?: 'speech' | 'song';
  fontSize: number;
  fontFamily?: string;
  textWidth?: number;
  fontColor: FontColor;
  bgColor: BgColor;
  style: CaptionStyle;
  position: Position;
  xPos: number;
  yPos: number;
  highlightColor: string;
  language: Language;
  offset: number;
  maxWordsPerCaption: number;
  engine: TranscriptionEngine;
}

// BCP-47 codes for manual selection
export const LANG_CODE: Record<string, string> = {
  Telugu: 'te',
  English: 'en',
  Hindi: 'hi',
  Tamil: 'ta',
  Kannada: 'kn',
  Malayalam: 'ml',
  Urdu: 'ur',
  Arabic: 'ar',
};

// Human-readable name from BCP-47 code
export const CODE_TO_NAME: Record<string, string> = {
  te:'Telugu', en:'English', hi:'Hindi', ta:'Tamil', kn:'Kannada', ml:'Malayalam', ur:'Urdu', ar:'Arabic',
  fr:'French', de:'German', es:'Spanish', zh:'Chinese', ja:'Japanese',
  ko:'Korean', ru:'Russian', pt:'Portuguese', it:'Italian', nl:'Dutch',
  tr:'Turkish', pl:'Polish', sv:'Swedish', da:'Danish', fi:'Finnish',
  no:'Norwegian', id:'Indonesian', ms:'Malay', th:'Thai', vi:'Vietnamese',
};
