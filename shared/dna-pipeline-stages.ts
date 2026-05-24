// Canonical 7 stages of the DNA content pipeline, surfaced on /pipeline.
// action_patterns are SQL ILIKE strings matched against cos_runs.action_name;
// logs_query feeds the per-stage "jump to logs" link.

export type DnaPipelineStage = {
  id: string;
  label: string;
  description: string;
  focus_area: string | null;
  action_patterns: string[];
  logs_query: string;
};

export const DNA_PIPELINE_STAGES: readonly DnaPipelineStage[] = [
  {
    id: "kalodata-extract",
    label: "Kalodata extraction",
    description: "TikTok Shop top-seller + UGC harvest",
    focus_area: "kalodata-gemini-extraction",
    action_patterns: ["kalodata%", "%top_seller%", "%harvest%"],
    logs_query: "kalodata",
  },
  {
    id: "gemini-vision",
    label: "Gemini Vision analysis",
    description: "Frame extraction + Thompson 8-attr labeling",
    focus_area: "thompson-8-attrs",
    action_patterns: ["gemini%", "%vision%", "%attr_extract%", "%frame_extract%"],
    logs_query: "gemini",
  },
  {
    id: "dna-knob-assemble",
    label: "DNA-knob configuration",
    description: "Per-theme knob registry assembly",
    focus_area: "dna-knob-config",
    action_patterns: ["%knob%", "dna_config%", "dna_assemble%"],
    logs_query: "knob",
  },
  {
    id: "engine-dispatch",
    label: "Engine dispatch",
    description: "Veo 3.1 Fast · Vertex · Pollo · Seedance",
    focus_area: "video-engines",
    action_patterns: ["veo%", "vertex%", "pollo%", "seedance%", "%engine_dispatch%"],
    logs_query: "engine_dispatch",
  },
  {
    id: "tts-post-proc",
    label: "TTS + voice-lock + post-proc",
    description: "TTS synth, voice-lock embed, M11–M28 post-processing",
    focus_area: "tts-voice-lock",
    action_patterns: ["tts%", "%voice_lock%", "%post_proc%", "m1_%", "m2_%"],
    logs_query: "post_proc",
  },
  {
    id: "ids-bandit-ingest",
    label: "IDS scoring + bandit ingest",
    description: "Indistinguishability scoring + Thompson posterior update",
    focus_area: "ids-bandit-ingest",
    action_patterns: ["%ids_score%", "%scoring%", "bandit_ingest%", "%bandit_update%"],
    logs_query: "ids_score",
  },
  {
    id: "lora-drift-distill",
    label: "LoRA drift / distill",
    description: "Drift detection + champion distillation",
    focus_area: "lora-drift-distill",
    action_patterns: ["lora%", "%drift%", "distill%"],
    logs_query: "lora",
  },
] as const;
