import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { SoftDocument } from '../types';
import { saveDocument, StorageConflictError } from './storage';

type Save = (document: SoftDocument) => Promise<SoftDocument>;
type Change = SoftDocument | ((document: SoftDocument) => SoftDocument);
export const AUTOSAVE_INTERVAL_MS = 5 * 60 * 1000;
interface SessionSnapshot { doc: SoftDocument; status: string; error: string; canUndo: boolean; canRedo: boolean; }

/** A single writer owns revision metadata; history only owns immutable content. */
export class DocumentSession {
  readonly current: { current: SoftDocument };
  private generation = 0;
  private savedGeneration = 0;
  private inFlight: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private autosaveDue = false;
  private active = false;
  private failure: Error | null = null;
  private history: SoftDocument[] = [];
  private future: SoftDocument[] = [];
  private listeners = new Set<() => void>();
  private frozen = new WeakSet<object>();
  private snapshot: SessionSnapshot;

  constructor(initial: SoftDocument, private readonly save: Save = saveDocument, private readonly autosaveMs = AUTOSAVE_INTERVAL_MS) {
    this.current = { current: this.freeze(structuredClone(initial)) };
    this.snapshot = { doc: this.current.current, status: 'Saved on this device', error: '', canUndo: false, canRedo: false };
  }

  // Completed strokes are shared between history snapshots. Walk only new nodes,
  // so adding a stroke never deep-copies or re-freezes all previous ink samples.
  private freeze<T>(value: T): T {
    if (value !== null && typeof value === 'object' && !this.frozen.has(value)) {
      for (const child of Object.values(value)) this.freeze(child);
      Object.freeze(value); this.frozen.add(value);
    }
    return value;
  }

  readonly subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  readonly getSnapshot = (): SessionSnapshot => this.snapshot;
  get needsSave(): boolean { return this.generation !== this.savedGeneration; }
  get needsLeaveWarning(): boolean { return this.needsSave || this.active; }

  private publish(status?: string): void {
    this.snapshot = {
      doc: this.current.current,
      status: status ?? (this.failure ? 'Save needs attention' : this.active ? 'Drawing…' : this.needsSave ? 'Unsaved changes' : 'Saved on this device'),
      error: this.failure?.message ?? '',
      canUndo: !this.active && this.history.length > 0,
      canRedo: !this.active && this.future.length > 0,
    };
    for (const listener of this.listeners) listener();
  }
  private clearTimer(): void { if (this.timer !== null) clearTimeout(this.timer); this.timer = null; }
  private schedule(): void {
    if (this.failure || !this.needsSave) return;
    // Further edits do not push back the five-minute deadline. If it falls
    // during a gesture, save its completed content as soon as the gesture ends.
    if (this.autosaveDue) { if (!this.active) void this.flush().catch(() => {}); return; }
    if (this.timer === null) this.timer = setTimeout(() => {
      this.timer = null; this.autosaveDue = true;
      if (!this.active) void this.flush().catch(() => {});
    }, this.autosaveMs);
  }

  readonly change = (next: Change, record = true): void => {
    const previous = this.current.current;
    const value = typeof next === 'function' ? next(previous) : next;
    if (value.id !== previous.id) throw new Error('An edit cannot switch document identity. Open the other project from the library.');
    if (value === previous) return;
    // Preserve persistence metadata even when applying a historical snapshot.
    const updated = this.freeze({ ...value, id: previous.id, revision: previous.revision, createdAt: previous.createdAt, updatedAt: previous.updatedAt });
    if (record) {
      this.history.push(previous); if (this.history.length > 60) this.history.shift();
      this.future = [];
    }
    this.current.current = updated; this.generation++;
    this.publish(); this.schedule();
  };
  readonly undo = (): void => {
    if (this.active) return;
    const previous = this.history.pop();
    if (previous) { this.future.push(this.current.current); this.change(previous, false); }
  };
  readonly redo = (): void => {
    if (this.active) return;
    const next = this.future.pop();
    if (next) { this.history.push(this.current.current); this.change(next, false); }
  };
  readonly gesture = (active: boolean): void => {
    if (this.active === active) return;
    this.active = active; this.publish();
    if (!active) this.schedule();
  };

  private async drain(): Promise<void> {
    while (this.needsSave) {
      if (this.active) throw new Error('Finish the current pen stroke or gesture before saving or leaving this project.');
      const content = this.current.current; const generation = this.generation;
      this.publish('Saving…');
      try {
        const saved = await this.save(content);
        // A user may have drawn, typed, undone, or redone while this save awaited
        // IndexedDB. Merge only the new revision, never the old saved content.
        this.savedGeneration = generation;
        this.current.current = this.freeze({ ...this.current.current, revision: saved.revision, updatedAt: saved.updatedAt });
        this.failure = null; this.publish();
      } catch (error) {
        this.failure = error instanceof Error ? error : new Error('Could not save this project. Download an editable backup to keep your work.');
        this.publish(); throw this.failure;
      }
    }
    // Do not let a library-navigation caller leave with a newly started stroke
    // merely because an older completed snapshot finished saving.
    if (this.active) throw new Error('Finish the current pen stroke or gesture before saving or leaving this project.');
  }

  readonly flush = async (): Promise<void> => {
    if (this.active) throw new Error('Finish the current pen stroke or gesture before saving or leaving this project.');
    this.clearTimer(); this.autosaveDue = false;
    if (this.inFlight) return this.inFlight;
    if (!this.needsSave) return;
    // A conflict requires recovery from the other tab; never retry by replacing
    // its revision. Transient quota/device errors may be retried with Save now.
    if (this.failure instanceof StorageConflictError) throw this.failure;
    this.failure = null;
    const task = this.drain(); this.inFlight = task;
    try { await task; } finally { if (this.inFlight === task) this.inFlight = null; }
  };

  readonly flushInBackground = (): void => {
    if (!this.failure && !this.active && this.needsSave) void this.flush().catch(() => {});
  };
  readonly stopTimers = (): void => { this.clearTimer(); };
}

export function useDocumentSession(initial: SoftDocument) {
  const ref = useRef<DocumentSession | null>(null);
  if (!ref.current) ref.current = new DocumentSession(initial);
  const session = ref.current;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  useEffect(() => {
    const prevent = (event: BeforeUnloadEvent) => {
      if (session.needsLeaveWarning) { event.preventDefault(); event.returnValue = ''; }
    };
    const hidden = () => {
      // Let the drawing surface synchronously commit any captured pen samples
      // in its own visibility handler before choosing the save snapshot.
      if (document.visibilityState === 'hidden') queueMicrotask(session.flushInBackground);
    };
    const pagehide = () => queueMicrotask(session.flushInBackground);
    window.addEventListener('beforeunload', prevent);
    window.addEventListener('pagehide', pagehide);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      session.stopTimers(); session.flushInBackground();
      window.removeEventListener('beforeunload', prevent);
      window.removeEventListener('pagehide', pagehide);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [session]);
  return { ...snapshot, change: session.change, flush: session.flush, undo: session.undo, redo: session.redo, gesture: session.gesture, current: session.current };
}
