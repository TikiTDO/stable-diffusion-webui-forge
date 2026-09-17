import { useState } from "react";
import type { EditorSession, EditorVariation } from "../domain/editorVariations";
import {
  DEFAULT_PRIMARY_SESSION,
  PRIMARY_SESSION_ID,
  REMOVED_SESSION_ID,
} from "../domain/editorVariations";

interface EditorVariationTrayProps {
  variations: EditorVariation[];
  activeId: string | null;
  sessions?: EditorSession[];
  onSelect: (variation: EditorVariation) => void;
  onRemove: (variation: EditorVariation) => void;
  onSelectCandidate?: (variation: EditorVariation, candidateIndex: number) => void;
  onAddSession?: (label: string) => void;
  onToggleSessionCollapse?: (sessionId: string) => void;
  onMoveToSession?: (variationId: string, targetSessionId: string) => void;
  onRestore?: (variation: EditorVariation) => void;
}

export function EditorVariationTray({
  variations,
  activeId,
  sessions = [DEFAULT_PRIMARY_SESSION],
  onSelect,
  onRemove,
  onSelectCandidate,
  onAddSession,
  onToggleSessionCollapse,
  onMoveToSession,
  onRestore,
}: EditorVariationTrayProps) {
  const [showTrash, setShowTrash] = useState(false);
  const [isAddingSession, setIsAddingSession] = useState(false);
  const [newSessionLabel, setNewSessionLabel] = useState("");

  const activeSessions = sessions.filter((s) => s.id !== REMOVED_SESSION_ID);
  const trashItems = variations.filter((v) => v.sessionId === REMOVED_SESSION_ID);

  const handleCreateSession = (e: React.FormEvent) => {
    e.preventDefault();
    if (newSessionLabel.trim() && onAddSession) {
      onAddSession(newSessionLabel.trim());
      setNewSessionLabel("");
      setIsAddingSession(false);
    }
  };

  return (
    <section className="editor-variations" aria-label="Edit session variations">
      <div className="editor-variations__top-bar">
        <strong>Session variations</strong>
        <div className="editor-variations__top-actions">
          {onAddSession && (
            <button
              type="button"
              className="editor-variations__add-session-btn"
              onClick={() => setIsAddingSession((prev) => !prev)}
              title="Add a new variation group or sub-session"
            >
              + New sub-session
            </button>
          )}
          {trashItems.length > 0 && (
            <button
              type="button"
              className={`editor-variations__trash-toggle ${showTrash ? "is-active" : ""}`}
              onClick={() => setShowTrash((prev) => !prev)}
              title="View or restore removed variations"
            >
              Trash ({trashItems.length})
            </button>
          )}
        </div>
      </div>

      {isAddingSession && (
        <form onSubmit={handleCreateSession} className="editor-variations__new-session-form">
          <input
            type="text"
            placeholder="Sub-session label (e.g. Character angle A)"
            value={newSessionLabel}
            onChange={(e) => setNewSessionLabel(e.target.value)}
            autoFocus
          />
          <button type="submit">Create</button>
          <button type="button" onClick={() => setIsAddingSession(false)}>Cancel</button>
        </form>
      )}

      <div className="editor-variations__sessions-list">
        {activeSessions.map((session) => {
          const sessionVariations = variations.filter(
            (v) => (v.sessionId ?? PRIMARY_SESSION_ID) === session.id,
          );

          return (
            <div key={session.id} className="editor-variations__session-block">
              <header className="editor-variations__session-header">
                <button
                  type="button"
                  className="editor-variations__collapse-btn"
                  onClick={() => onToggleSessionCollapse?.(session.id)}
                  title={session.collapsed ? "Expand session" : "Collapse session"}
                >
                  <span className="collapse-arrow">{session.collapsed ? "▶" : "▼"}</span>
                  <span className="session-title">{session.label}</span>
                </button>
                <span className="session-count">{sessionVariations.length} available</span>
              </header>

              {!session.collapsed && (
                <div className="editor-variations__tray">
                  {sessionVariations.length === 0 ? (
                    <div className="editor-variations__empty-note">
                      No variations in this session yet.
                    </div>
                  ) : (
                    sessionVariations.map((variation) => {
                      const candidates = variation.candidates?.length
                        ? variation.candidates
                        : variation.image
                          ? [variation.image]
                          : [];
                      const activeCandidateIdx = variation.selectedCandidateIndex ?? 0;

                      return (
                        <div
                          key={variation.id}
                          className={`editor-variations__item ${
                            variation.id === activeId ? "is-selected" : ""
                          }`}
                        >
                          <button
                            type="button"
                            className="editor-variations__select"
                            onClick={() => onSelect(variation)}
                            aria-pressed={variation.id === activeId}
                            title={`Use ${variation.label.toLowerCase()} as current edit source`}
                          >
                            {variation.image ? (
                              <img src={variation.image} alt="" />
                            ) : (
                              <span
                                className="editor-variations__blank"
                                aria-hidden="true"
                              />
                            )}
                            <span className="item-label">{variation.label}</span>
                          </button>

                          {candidates.length > 1 && (
                            <div
                              className="editor-variations__candidate-strip"
                              aria-label="Variation outputs"
                            >
                              {candidates.map((_, idx) => (
                                <button
                                  key={idx}
                                  type="button"
                                  className={`candidate-pill ${
                                    idx === activeCandidateIdx ? "is-active" : ""
                                  }`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onSelectCandidate?.(variation, idx);
                                  }}
                                  title={`Select candidate output ${idx + 1}`}
                                >
                                  {idx + 1}
                                </button>
                              ))}
                            </div>
                          )}

                          {activeSessions.length > 1 && onMoveToSession && (
                            <select
                              className="editor-variations__move-select"
                              value={session.id}
                              onChange={(e) => {
                                onMoveToSession(variation.id, e.target.value);
                              }}
                              title="Move to another sub-session"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {activeSessions.map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.label}
                                </option>
                              ))}
                            </select>
                          )}

                          <button
                            type="button"
                            className="editor-variations__remove"
                            onClick={(e) => {
                              e.stopPropagation();
                              onRemove(variation);
                            }}
                            aria-label={`Remove ${variation.label.toLowerCase()} to trash`}
                            title="Move to trash session; output remains recoverable"
                          >
                            ×
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showTrash && trashItems.length > 0 && (
        <div className="editor-variations__trash-section">
          <header className="editor-variations__session-header">
            <strong>Removed variations ({trashItems.length})</strong>
            <span className="session-count">Click Restore to recover</span>
          </header>
          <div className="editor-variations__tray">
            {trashItems.map((variation) => (
              <div key={variation.id} className="editor-variations__item is-removed">
                {variation.image ? (
                  <img src={variation.image} alt="" />
                ) : (
                  <span className="editor-variations__blank" aria-hidden="true" />
                )}
                <span className="item-label">{variation.label}</span>
                {onRestore && (
                  <button
                    type="button"
                    className="editor-variations__restore-btn"
                    onClick={() => onRestore(variation)}
                    title="Restore to primary session"
                  >
                    Restore
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
