// ============ DNA Roadmap FOCUS_AREAs ============
// The 15 work units carried by the mcc-roadmap-specialist-dna skill.
// Explorer findings are tagged with one of these so the Explorer UI can
// group + filter findings against DNA roadmap structure directly,
// instead of relying on the generic 7-value `category` enum.

export type DnaFocusArea = {
  id: string;
  label: string;
  description: string;
};

export const DNA_FOCUS_AREAS: readonly DnaFocusArea[] = [
  { id: "kalodata-gemini-extraction", label: "Kalodata + Gemini Vision", description: "Kalodata UGC + Gemini Vision frame extraction pipeline" },
  { id: "dna-knob-config", label: "DNA-knob config", description: "Tunable knob registry + per-theme knob overrides" },
  { id: "video-engines", label: "Video engines", description: "Vertex / Pollo / Seedance video generation engines" },
  { id: "tts-voice-lock", label: "TTS + voice-lock", description: "TTS synthesis, voice-lock embedding, post-processing" },
  { id: "thompson-8-attrs", label: "Thompson 8-attrs", description: "Thompson sampling bandit across the 8 creative attributes" },
  { id: "dr-ips-router", label: "DR/IPS lints router", description: "Doubly-robust + IPS lint router for off-policy correction" },
  { id: "compliance-gate", label: "Compliance gate", description: "Pre-publish compliance gate (claims, music, brand-safety)" },
  { id: "gmv-max", label: "GMV Max", description: "TikTok Shop GMV Max integration + spend optimization" },
  { id: "ids-bandit-ingest", label: "IDS bandit ingest", description: "Indistinguishability-score bandit ingest + reward shaping" },
  { id: "lora-drift-distill", label: "LoRA drift/distill", description: "LoRA drift detection + distillation back into champion" },
  { id: "control-panel", label: "Control panel", description: "Operator control panel surfaces (themes, A/B, scoring)" },
  { id: "api-v1-dna-tests", label: "api/v1/dna tests", description: "Test coverage for the api/v1/dna public surface" },
  { id: "observability", label: "Observability", description: "Logs, traces, metrics, dashboards, SLO alerts" },
  { id: "promotion-gates", label: "Promotion gates", description: "A/B promotion gates (IDS≥0.85 + Δ≥0.10, shadow window)" },
  { id: "data-corpus", label: "Data corpus", description: "UGC corpus hygiene, dedupe, labeling, and provenance" },
] as const;

export const FOCUS_AREA_IDS = DNA_FOCUS_AREAS.map((a) => a.id) as readonly string[];

export const UNCATEGORIZED_FOCUS_AREA = "(uncategorized)";

export function getFocusAreaLabel(id: string | null | undefined): string {
  if (!id) return UNCATEGORIZED_FOCUS_AREA;
  const match = DNA_FOCUS_AREAS.find((a) => a.id === id);
  return match?.label ?? id;
}
