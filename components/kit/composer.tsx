"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { Plus, Mic, ArrowUp, Square, Folder } from "lucide-react";
import { cn } from "@/lib/utils";
import { ModelSelector } from "./model-selector";
import { ConnectorPicker } from "./connector-picker";
import { useDictation } from "./use-dictation";
import { useAttachments } from "./use-attachments";
import { AttachmentChips } from "./attachment-chips";
import { type ComposerPrefill } from "./composer-prefill";
import { usePrefillSeed } from "./use-prefill-seed";
import type { EffortLevel, ModelOption } from "@/lib/agent/model-options";

/**
 * The chat input card (spec 18/24): field, `+` attach, mode chip, model
 * selector, mic, send. Reused on Home and in-thread. The value is submitted via
 * `onSubmit` and the field clears; Enter sends, Shift+Enter inserts a newline.
 *
 * Spec 24 makes the secondary controls functional. When `busy` is set the send
 * button becomes a Stop button wired to `onStop` (interrupt the in-flight turn),
 * and `submit` refuses, so a second turn cannot be fired into a running one by
 * pressing Enter either. `threadId` scopes per-thread controls (model override,
 * attachments); it is optional so Home (no thread yet) still renders.
 *
 * `prefill` is the quick-action path, and it is additive by contract: a starter
 * chip may never discard text the user typed. Sixty typed characters used to
 * vanish the moment "Write a doc" was clicked, because Home remounted this
 * component with a fresh `initialValue`.
 */
export function Composer({
  onSubmit,
  placeholder = "How can I help you today?",
  autoFocus = false,
  initialValue = "",
  prefill,
  model = "Opus 4.8",
  level = "High",
  showMic = true,
  busy = false,
  onStop,
  threadId,
  attachmentsEnabled = false,
  onThreadMinted,
  dictationEnabled = false,
  models = [],
  modelSwitchingEnabled = false,
  onModelChange,
  projectId,
  projectName,
  projectsEnabled = false,
  connectorsEnabled = false,
  className,
}: {
  onSubmit: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  /** Seed text applied once at mount. */
  initialValue?: string;
  /**
   * A quick-action seed, applied whenever `nonce` changes. The seeds are
   * sentence openers ("Help me write a doc about "), so they land in FRONT of
   * whatever is already in the field: the user's own words are the subject of
   * the sentence and must survive intact.
   */
  prefill?: ComposerPrefill;
  model?: string;
  level?: string;
  showMic?: boolean;
  /** A turn is streaming: the send button becomes Stop. */
  busy?: boolean;
  /** Interrupt the in-flight turn (rendered as the Stop action when `busy`). */
  onStop?: () => void;
  /** The thread this composer sends into, scoping per-thread controls. */
  threadId?: string;
  onThreadMinted?: (id: string) => void;
  /** Whether file attachments are configured (ATTACHMENTS_ENABLED). Off disables the `+`. */
  attachmentsEnabled?: boolean;
  /** Whether voice dictation is configured (isDictationEnabled). Off disables the mic. */
  dictationEnabled?: boolean;
  /** Server-resolved model allowlist for the selector (empty when switching is off). */
  models?: ModelOption[];
  /** Whether per-chat model switching is enabled server-side (AGENT_CHAT_MODELS). */
  modelSwitchingEnabled?: boolean;
  onModelChange?: (choice: { model?: string; effort?: EffortLevel }) => void;
  /** The project this new chat will be filed into (spec 26), if any. */
  projectId?: string;
  /** Display name of that project, shown as an "In {name}" affordance. */
  projectName?: string;
  /** Whether the Projects subsystem is enabled server-side (PROJECTS_ENABLED). */
  projectsEnabled?: boolean;
  /** Whether external MCP connectors are enabled server-side (CONNECTORS_ENABLED). Off renders no picker. */
  connectorsEnabled?: boolean;
  className?: string;
}) {
  // The project affordance is dormant unless projects are enabled: flag-off, the
  // composer renders neither the "In {project}" chip nor the data-project-id
  // attribute, so it is byte-identical to a composer with no project.
  const inProject = projectsEnabled && Boolean(projectId);
  const [value, setValue] = useState(initialValue);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  // Destructured rather than held as one object: the file input's ref must stay
  // a distinct binding, so reading `attachments` during render is not mistaken
  // for reading a ref during render.
  const {
    attachments,
    error: attachError,
    pending: attachPending,
    inputRef: fileRef,
    upload,
    remove: removeAttachment,
    clear: clearAttachments,
    pick: pickFiles,
  } = useAttachments(threadId, onThreadMinted, attachmentsEnabled);

  // Seeds the field from a starter chip and hands the caret over; see the hook.
  usePrefillSeed(prefill, setValue, fieldRef);

  // Dictation fills the field, it never sends: append the transcript to
  // whatever the contributor has already typed (spec 24).
  const dictation = useDictation((text) =>
    setValue((v) => (v.trim() ? `${v.trimEnd()} ${text}` : text)),
  );

  const attachTitle = attachmentsEnabled ? "Attach a file" : "Attachments are not enabled";

  const sendBlocked = attachPending;

  function submit() {
    if (busy || sendBlocked) return;
    const trimmed = value.trim();
    if (trimmed.length === 0) return;
    onSubmit(value);
    setValue("");
    clearAttachments();
    // Reset the autosize height after clearing.
    if (fieldRef.current) fieldRef.current.style.height = "auto";
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div
      data-thread-id={threadId}
      data-project-id={inProject ? projectId : undefined}
      className={cn(
        "w-full rounded-composer border border-line bg-surface p-4 pb-3 shadow-elevated focus-within:border-accent",
        className,
      )}
    >
      <AttachmentChips attachments={attachments} onRemove={(id) => void removeAttachment(id)} />
      {attachError && <p className="mb-2 text-xs text-warn">{attachError}</p>}
      {/* useDictation captured a failure (mic denied, unsupported, or the
          transcription backend down) but the composer never showed it, so the
          mic read as doing nothing. Surface it like the attachment error. */}
      {dictation.error && (
        <p role="alert" className="mb-2 text-xs text-warn">
          {dictation.error}
        </p>
      )}
      <textarea
        ref={fieldRef}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        rows={1}
        placeholder={placeholder}
        aria-label="Message"
        className="min-h-[46px] w-full resize-none bg-transparent px-1 py-0.5 text-[15px] text-ink placeholder:text-ink-faint focus:outline-none"
      />
      <input
        ref={fileRef}
        type="file"
        multiple
        hidden
        aria-hidden
        onChange={(e) => void upload(e.target.files)}
      />
      <div className="mt-1.5 flex items-center gap-2">
        <span title={attachTitle} className="inline-flex">
          <button
            type="button"
            aria-label="Attach"
            disabled={!attachmentsEnabled}
            title={attachTitle}
            onClick={() => pickFiles()}
            className="grid size-[30px] place-items-center rounded-control border border-line bg-surface text-ink-muted hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="size-4" />
          </button>
        </span>
        {/* Dormant unless CONNECTORS_ENABLED: flag-off renders no picker at
            all, keeping the button row byte-identical (spec 33). */}
        {connectorsEnabled && <ConnectorPicker threadId={threadId ?? null} />}
        {inProject && projectName ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-3 py-1 text-xs font-medium text-ink">
            <Folder className="size-3.5" />
            In {projectName}
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-2.5">
          <ModelSelector
            threadId={threadId}
            model={model}
            level={level}
            options={models}
            enabled={modelSwitchingEnabled}
            onChange={onModelChange}
          />
          {showMic && (
            <button
              type="button"
              aria-label={dictation.recording ? "Stop dictation" : "Dictate"}
              aria-pressed={dictation.recording}
              disabled={!dictationEnabled || dictation.busy}
              title={dictationEnabled ? "Dictate a message" : "Dictation is not enabled"}
              onClick={dictation.toggle}
              className={cn(
                "grid size-[30px] place-items-center rounded-control hover:bg-surface-2 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50",
                dictation.recording ? "bg-accent-soft text-accent-ink" : "text-ink-muted",
              )}
            >
              <Mic className="size-4" />
            </button>
          )}
          {busy ? (
            <button
              type="button"
              aria-label="Stop"
              onClick={onStop}
              className="grid size-8 place-items-center rounded-send bg-accent text-white hover:bg-accent-ink"
            >
              <Square className="size-3.5" fill="currentColor" />
            </button>
          ) : (
            <button
              type="button"
              aria-label="Send"
              onClick={submit}
              disabled={sendBlocked}
              title={attachPending ? "Still attaching your file." : undefined}
              className={cn(
                "grid size-8 place-items-center rounded-send bg-accent text-white hover:bg-accent-ink",
                sendBlocked && "disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              <ArrowUp className="size-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
