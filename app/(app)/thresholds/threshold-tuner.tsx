"use client";

import { useState, useEffect } from "react";
import { Loader2, Save } from "lucide-react";
import { useT } from "@/lib/i18n/client";
import type { TranslationKey } from "@/lib/i18n/translations";

interface Thresholds {
  insightface_min_confidence: number;
  haar_min_neighbors: number;
  blur_persist_frames: number;
  alert_threshold: number;
  dedup_threshold: number;
}

const DEFAULTS: Thresholds = {
  insightface_min_confidence: 0.55,
  haar_min_neighbors: 8,
  blur_persist_frames: 15,
  alert_threshold: 0.45,
  dedup_threshold: 0.35,
};

const LABELS: Record<
  string,
  { labelKey: TranslationKey; descKey: TranslationKey; min: number; max: number; step: number }
> = {
  insightface_min_confidence: {
    labelKey: "thr_detect_label",
    descKey: "thr_detect_desc",
    min: 0.1, max: 0.95, step: 0.05,
  },
  haar_min_neighbors: {
    labelKey: "thr_haar_label",
    descKey: "thr_haar_desc",
    min: 3, max: 15, step: 1,
  },
  blur_persist_frames: {
    labelKey: "thr_persist_label",
    descKey: "thr_persist_desc",
    min: 5, max: 60, step: 5,
  },
  alert_threshold: {
    labelKey: "thr_alert_label",
    descKey: "thr_alert_desc",
    min: 0.2, max: 0.8, step: 0.05,
  },
  dedup_threshold: {
    labelKey: "thr_dedup_label",
    descKey: "thr_dedup_desc",
    min: 0.2, max: 0.7, step: 0.05,
  },
};

export function ThresholdTuner() {
  const { t } = useT();
  const [values, setValues] = useState<Thresholds>(DEFAULTS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/eval/system")
      .then((r) => r.json())
      .then((data) => {
        if (data.thresholds) setValues(data.thresholds);
      })
      .finally(() => setLoading(false));
  }, []);

  function update(key: keyof Thresholds, val: number) {
    setValues((prev) => ({ ...prev, [key]: val }));
  }

  if (loading) {
    return (
      <div className="card flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-text-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {(Object.keys(LABELS) as (keyof Thresholds)[]).map((key) => {
          const cfg = LABELS[key];
          const val = values[key];
          return (
            <div key={key} className="card space-y-2">
              <div className="flex justify-between items-baseline">
                <label className="text-sm font-medium text-text">{t(cfg.labelKey)}</label>
                <span className="text-lg font-bold text-accent font-mono">{val}</span>
              </div>
              <p className="text-xs text-text-muted">{t(cfg.descKey)}</p>
              <input
                type="range"
                min={cfg.min}
                max={cfg.max}
                step={cfg.step}
                value={val}
                onChange={(e) => update(key, Number(e.target.value))}
                className="w-full accent-accent"
              />
              <div className="flex justify-between text-[10px] text-text-faint">
                <span>{cfg.min}</span>
                <span className="text-text-muted">{t("thr_default")}: {DEFAULTS[key]}</span>
                <span>{cfg.max}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="card bg-warning/5 border border-warning/20 text-xs text-text-soft leading-relaxed">
        <Save className="w-4 h-4 text-warning inline mr-1" />
        {t("thr_restart_note")}
      </div>
    </div>
  );
}
