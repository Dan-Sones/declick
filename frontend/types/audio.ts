export type View = "home" | "quick" | "detail";
export type Confidence = "all" | "high" | "medium" | "low";
export interface Candidate {
  id: number;
  sample_index: number;
  timestamp: string;
  channels: number[];
  confidence: number;
  level: Exclude<Confidence, "all">;
  duration_samples: number;
  duration_ms: number;
  kind: string;
  evidence: Record<string, number>;
  spans?: [number, number, number][];
  repair_error?: string | null;
}
export interface WaveformOverview {
  frames: number;
  buckets: [number, number][];
}
export interface Recording {
  overview?: WaveformOverview;
  id: string;
  name: string;
  path: string;
  events: Candidate[];
  repair_error?: string | null;
  stats: {
    sample_rate: number;
    channels: number;
    bit_depth: number | null;
    subtype: string;
    duration_seconds: number;
    peak_dbfs: number;
  };
}
export interface Snapshot {
  status: "idle" | "scanning" | "done" | "error";
  revision: number;
  files?: Recording[];
  path: string;
  sensitivity: string;
  completed: number;
  total: number;
  current: string;
  errors: string[];
}
export interface Waveform {
  start_sample: number;
  center_sample: number;
  sample_rate: number;
  channels: number[][];
  repaired_channels?: number[][];
  repair_error?: string;
}
export interface RepairReport {
  repaired_candidates: number;
  format: string;
  output: string;
  download_url: string;
  report_url: string;
}
