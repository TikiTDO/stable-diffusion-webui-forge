import { useEffect, useRef, useState } from "react";

import type { Lora, LoraDefaults, LoraKeywordDefault, ModelFamily } from "../api/forge/types";

export interface LoraDetailModalProps {
  lora: Lora | null;
  onClose: () => void;
  onSaveDefaults: (lora: Lora, defaults: LoraDefaults) => Promise<void>;
  onUploadPreview?: (lora: Lora, file: File) => Promise<void>;
}

export function LoraDetailModal({
  lora,
  onClose,
  onSaveDefaults,
  onUploadPreview,
}: LoraDetailModalProps) {
  if (!lora) return null;

  return (
    <LoraDetailModalContent
      key={lora.id}
      lora={lora}
      onClose={onClose}
      onSaveDefaults={onSaveDefaults}
      onUploadPreview={onUploadPreview}
    />
  );
}

function LoraDetailModalContent({
  lora,
  onClose,
  onSaveDefaults,
  onUploadPreview,
}: {
  lora: Lora;
  onClose: () => void;
  onSaveDefaults: (lora: Lora, defaults: LoraDefaults) => Promise<void>;
  onUploadPreview?: (lora: Lora, file: File) => Promise<void>;
}) {
  const [preferredStrength, setPreferredStrength] = useState(
    lora.defaults.preferred_strength ?? 1.0,
  );
  const [description, setDescription] = useState(
    lora.defaults.description || lora.description || "",
  );
  const [notes, setNotes] = useState(lora.defaults.notes || "");
  const [modelFamily, setModelFamily] = useState<ModelFamily>(
    (lora.defaults.model_family as ModelFamily) || lora.model_family || "unknown",
  );
  const [keywords, setKeywords] = useState<LoraKeywordDefault[]>(
    () => lora.defaults.keywords.map((k) => ({ ...k })),
  );
  const [newKeywordText, setNewKeywordText] = useState("");
  const [newKeywordWeight, setNewKeywordWeight] = useState(1.0);
  const [saving, setSaving] = useState(false);
  const [uploadingPreview, setUploadingPreview] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(lora.preview_url);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLElement>(null);
  const triggerElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    triggerElementRef.current = document.activeElement as HTMLElement | null;

    // Shift initial focus to the first focusable element inside the modal
    const firstFocusable = modalRef.current?.querySelector<HTMLElement>(
      'button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    firstFocusable?.focus();

    return () => {
      triggerElementRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key === "Tab") {
        if (!modalRef.current) return;
        const focusableElements = Array.from(
          modalRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        ).filter(
          (el) =>
            el.offsetParent !== null ||
            (el.offsetWidth > 0 && el.offsetHeight > 0) ||
            getComputedStyle(el).display !== "none",
        );

        if (focusableElements.length === 0) {
          event.preventDefault();
          return;
        }

        const first = focusableElements[0];
        const last = focusableElements[focusableElements.length - 1];

        if (event.shiftKey) {
          if (
            document.activeElement === first ||
            !modalRef.current.contains(document.activeElement)
          ) {
            event.preventDefault();
            last.focus();
          }
        } else {
          if (
            document.activeElement === last ||
            !modalRef.current.contains(document.activeElement)
          ) {
            event.preventDefault();
            first.focus();
          }
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const addKeyword = (text: string, weight = 1.0) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (keywords.some((k) => k.text.toLocaleLowerCase() === trimmed.toLocaleLowerCase())) {
      return;
    }
    setKeywords((current) => [...current, { text: trimmed, weight, enabled: true }]);
  };

  const handleAddKeywordSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!newKeywordText.trim()) return;
    addKeyword(newKeywordText, newKeywordWeight);
    setNewKeywordText("");
    setNewKeywordWeight(1.0);
  };

  const removeKeyword = (index: number) => {
    setKeywords((current) => current.filter((_, i) => i !== index));
  };

  const toggleKeyword = (index: number) => {
    setKeywords((current) =>
      current.map((k, i) => (i === index ? { ...k, enabled: !k.enabled } : k)),
    );
  };

  const updateKeywordWeight = (index: number, weight: number) => {
    setKeywords((current) =>
      current.map((k, i) => (i === index ? { ...k, weight } : k)),
    );
  };

  const handlePreviewUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !onUploadPreview) return;
    setUploadingPreview(true);
    setStatusMessage(null);
    try {
      await onUploadPreview(lora, file);
      setPreviewUrl(URL.createObjectURL(file));
      setStatusMessage("Preview image updated.");
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : "Failed to upload preview.");
    } finally {
      setUploadingPreview(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setStatusMessage(null);
    const updatedDefaults: LoraDefaults = {
      description: description.trim(),
      model_family: modelFamily,
      preferred_strength: Number.isFinite(preferredStrength) ? preferredStrength : 1.0,
      keywords: keywords
        .map((k) => ({
          text: k.text.trim(),
          weight: Number.isFinite(k.weight) ? k.weight : 1.0,
          enabled: k.enabled,
        }))
        .filter((k) => Boolean(k.text)),
      notes: notes.trim(),
    };

    try {
      await onSaveDefaults(lora, updatedDefaults);
      setStatusMessage("Defaults saved successfully.");
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : "Failed to save defaults.");
    } finally {
      setSaving(false);
    }
  };

  const existingKeywordTexts = new Set(
    keywords.map((k) => k.text.toLocaleLowerCase()),
  );
  const unaddedRecommendations = (lora.recommended_keywords || []).filter(
    (term) => !existingKeywordTexts.has(term.toLocaleLowerCase()),
  );

  return (
    <div
      className="lora-detail-modal-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Edit LoRA: ${lora.name}`}
        className="lora-detail-modal"
      >
        <header className="lora-detail-modal__header">
          <div>
            <div className="lora-detail-modal__badges">
              <span className="lora-detail-modal__family-badge">
                {modelFamily.toUpperCase()}
              </span>
              {lora.base_model && (
                <span className="lora-detail-modal__base-badge">
                  {lora.base_model}
                </span>
              )}
            </div>
            <h2>{lora.name}</h2>
            <small className="lora-detail-modal__path">{lora.relative_path}</small>
          </div>
          <button
            type="button"
            className="lora-detail-modal__close"
            onClick={onClose}
            aria-label="Close dialog"
          >
            ×
          </button>
        </header>

        <div className="lora-detail-modal__body">
          <div className="lora-detail-modal__sidebar">
            <div className="lora-detail-modal__preview-box">
              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt={lora.name}
                  className="lora-detail-modal__preview-img"
                />
              ) : (
                <div className="lora-detail-modal__preview-placeholder">
                  No preview available
                </div>
              )}
            </div>
            {onUploadPreview && (
              <div className="lora-detail-modal__upload">
                <input
                  ref={fileInputRef}
                  type="file"
                  id="lora-preview-upload"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={handlePreviewUpload}
                  style={{ display: "none" }}
                />
                <button
                  type="button"
                  disabled={uploadingPreview}
                  onClick={() => fileInputRef.current?.click()}
                  className="lora-detail-modal__upload-btn"
                >
                  {uploadingPreview ? "Uploading…" : "Replace preview image"}
                </button>
              </div>
            )}
            <div className="lora-detail-modal__meta">
              <p>
                <strong>Size:</strong> {(lora.size_bytes / (1024 * 1024)).toFixed(1)} MB
              </p>
              {lora.alias && lora.alias !== lora.name && (
                <p>
                  <strong>Alias:</strong> {lora.alias}
                </p>
              )}
            </div>
          </div>

          <div className="lora-detail-modal__form">
            <div className="lora-detail-modal__row">
              <label>
                <span>Preferred strength</span>
                <input
                  type="number"
                  min="-10"
                  max="10"
                  step="0.05"
                  value={preferredStrength}
                  onChange={(e) => setPreferredStrength(e.target.valueAsNumber)}
                />
              </label>

              <label>
                <span>Model family</span>
                <select
                  value={modelFamily}
                  onChange={(e) => setModelFamily(e.target.value as ModelFamily)}
                >
                  <option value="sdxl">SDXL</option>
                  <option value="flux">Flux</option>
                  <option value="unknown">Unknown</option>
                </select>
              </label>
            </div>

            <label className="lora-detail-modal__field">
              <span>Description</span>
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief summary of adapter effect or style…"
              />
            </label>

            <label className="lora-detail-modal__field">
              <span>Notes</span>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Personal notes or usage guidance…"
              />
            </label>

            <div className="lora-detail-modal__keywords-section">
              <span className="lora-detail-modal__section-title">
                Default activation terms
              </span>
              <div className="lora-detail-modal__keywords-list">
                {keywords.map((keyword, index) => (
                  <div className="lora-detail-modal__keyword-item" key={index}>
                    <button
                      type="button"
                      className={`lora-detail-modal__keyword-toggle ${keyword.enabled ? "is-enabled" : ""}`}
                      onClick={() => toggleKeyword(index)}
                      title={keyword.enabled ? "Enabled by default" : "Disabled by default"}
                    >
                      {keyword.text}
                    </button>
                    <input
                      type="number"
                      min="-10"
                      max="10"
                      step="0.05"
                      value={keyword.weight}
                      aria-label={`${keyword.text} weight`}
                      onChange={(e) =>
                        updateKeywordWeight(
                          index,
                          Number.isFinite(e.target.valueAsNumber)
                            ? e.target.valueAsNumber
                            : keyword.weight,
                        )
                      }
                    />
                    <button
                      type="button"
                      className="lora-detail-modal__keyword-remove"
                      onClick={() => removeKeyword(index)}
                      aria-label={`Remove ${keyword.text}`}
                      title="Remove keyword"
                    >
                      ×
                    </button>
                  </div>
                ))}
                {keywords.length === 0 && (
                  <p className="lora-detail-modal__empty-text">No activation terms saved.</p>
                )}
              </div>

              <form onSubmit={handleAddKeywordSubmit} className="lora-detail-modal__add-keyword">
                <input
                  type="text"
                  placeholder="Add new trigger term…"
                  value={newKeywordText}
                  onChange={(e) => setNewKeywordText(e.target.value)}
                />
                <input
                  type="number"
                  min="-10"
                  max="10"
                  step="0.05"
                  value={newKeywordWeight}
                  aria-label="New keyword weight"
                  onChange={(e) =>
                    setNewKeywordWeight(
                      Number.isFinite(e.target.valueAsNumber)
                        ? e.target.valueAsNumber
                        : 1.0,
                    )
                  }
                />
                <button type="submit" disabled={!newKeywordText.trim()}>
                  Add term
                </button>
              </form>

              {unaddedRecommendations.length > 0 && (
                <div className="lora-detail-modal__recommendations">
                  <small>Suggested vocabulary from model metadata:</small>
                  <div className="lora-detail-modal__rec-chips">
                    {unaddedRecommendations.map((term, index) => (
                      <button
                        type="button"
                        key={index}
                        className="lora-detail-modal__rec-chip"
                        onClick={() => addKeyword(term)}
                        title={`Add ${term}`}
                      >
                        + {term}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <footer className="lora-detail-modal__footer">
          {statusMessage && (
            <span className="lora-detail-modal__status" role="status">
              {statusMessage}
            </span>
          )}
          <div className="lora-detail-modal__footer-actions">
            <button type="button" onClick={onClose}>
              Close
            </button>
            <button
              type="button"
              className="lora-detail-modal__save-btn"
              disabled={saving}
              onClick={handleSave}
            >
              {saving ? "Saving…" : "Save defaults"}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
