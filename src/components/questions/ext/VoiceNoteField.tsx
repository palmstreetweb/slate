/**
 * Voice note (ADR-065), loaded on demand. "Tap to record" with the
 * MediaRecorder API: a live level meter and timer while recording, an owner
 * cap on length (default 60 s, it stops itself), play it back, re-record,
 * then it uploads through the host's `onFileUpload` like any file (Slate: the
 * public storage path, rate-limited and size-capped per question, ADR-058).
 *
 * The microphone is asked for only when the respondent taps record — never on
 * load — and released the moment recording stops or the question leaves.
 * Formats: Safari / iOS record AAC in MP4 (audio/mp4); Chrome, Edge and
 * Firefox record Opus in WebM (audio/webm). AAC is preferred wherever the
 * browser offers it, because it plays everywhere. When the mic is blocked or
 * missing, "Type instead" (if the owner allows it) or a clear message.
 */

'use client';

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import type { VoiceNoteQuestion } from '@/types/Question.js';
import { validate } from '@/logic/validation.js';
import {
  VOICE_TYPED_MAX,
  formatClock,
  voiceAudioOf,
  voiceMaxBytes,
  voiceMaxSeconds,
  voiceSecondsOf,
  voiceTypedOf,
} from '@/logic/media.js';
import { useRegisterFormConfirm } from '@/hooks/useRegisterFormConfirm.js';
import { focusAfter } from '@/utils/focus.js';
import { motionReduced, shakeInvalid } from '@/utils/motion.js';
import { isTypewriterKey } from '@/utils/typewriterKey.js';
import type { ExtFieldProps } from '../lazyFields.js';
import { failedMimes, pickVoiceMime } from './voiceFormat.js';
import { resolveTitle } from '../_resolveTitle.js';
import '@/styles/extensions.css';
import '@/styles/extensions-c.css';

type Phase = 'idle' | 'asking' | 'recording' | 'review' | 'typed' | 'blocked';
type Save = 'idle' | 'saving' | 'saved' | 'error';
type Clip = { url: string; blob: Blob; seconds: number; peaks: number[] };

/** A file name ending for a recorded type. */
function extensionFor(type: string): string {
  if (type.includes('mp4') || type.includes('aac')) return 'm4a';
  if (type.includes('webm')) return 'webm';
  if (type.includes('ogg')) return 'ogg';
  return 'audio';
}

/**
 * The host's own sentence (a plain Error), or plain words — never a browser's
 * or a server's technical text (MEDIA-06). Inline, not the core's helper: a
 * field importing a core util splits a core chunk and costs engine bytes.
 */
const plainError = (err: unknown) =>
  err instanceof Error && err.name === 'Error' && err.message && err.message.length < 180
    ? err.message
    : 'Your recording didn’t save. Try again.';

const BARS_LIVE = 28;
const BARS_CLIP = 48;
const MIB = 1024 * 1024;

/** Recordings made this session, by ref — so Back and forward can still play them. */
const clips = new Map<string, Clip>();

function downsample(levels: number[], n: number): number[] {
  if (levels.length === 0) return Array.from({ length: n }, () => 0.04);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = Math.floor((i * levels.length) / n);
    const b = Math.max(a + 1, Math.floor(((i + 1) * levels.length) / n));
    let peak = 0;
    for (let j = a; j < b && j < levels.length; j++) peak = Math.max(peak, levels[j]!);
    out.push(Math.max(0.04, peak));
  }
  return out;
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" />
    </svg>
  );
}

export default function VoiceNoteField({
  question,
  answers,
  value,
  onAnswer,
  onAdvance,
  onType,
  ping,
  onFileUpload,
}: ExtFieldProps<VoiceNoteQuestion>) {
  const titleId = useId();
  const maxSec = voiceMaxSeconds(question);
  const allowTyped = question.allowTyped !== false;
  const seededRef = voiceAudioOf(value);
  const seededTyped = voiceTypedOf(value);
  const cached = seededRef ? (clips.get(seededRef) ?? null) : null;

  // Typed text is shown again even with typing off: it was typed because the
  // microphone was blocked or missing (MEDIA-17).
  const [phase, setPhase] = useState<Phase>(
    seededTyped !== null ? 'typed' : seededRef ? 'review' : 'idle',
  );
  const [blocked, setBlocked] = useState<'denied' | 'unsupported' | 'nomic' | 'failed'>('denied');
  const [clip, setClip] = useState<Clip | null>(cached);
  const [savedRef, setSavedRef] = useState<string | null>(seededRef);
  const [savedSec, setSavedSec] = useState<number | null>(voiceSecondsOf(value));
  const [save, setSave] = useState<Save>(seededRef ? 'saved' : 'idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [typed, setTyped] = useState(seededTyped ?? '');
  const [elapsed, setElapsed] = useState(0);
  const [live, setLive] = useState<number[]>([]);
  const [playing, setPlaying] = useState(false);
  const [played, setPlayed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [said, setSaid] = useState('');

  const rootRef = useRef<HTMLDivElement>(null);
  const recordRef = useRef<HTMLButtonElement>(null);
  const typedRef = useRef<HTMLTextAreaElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const rec = useRef<{
    recorder: MediaRecorder;
    stream: MediaStream;
    ctx: AudioContext | null;
    raf: number;
    timer: number;
    started: number;
    levels: number[];
    chunks: Blob[];
    stopped: boolean;
  } | null>(null);
  const alive = useRef(true);

  useEffect(
    () => focusAfter(phase === 'typed' ? typedRef.current : recordRef.current),
    // Once per question, and when switching between recording and typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [question.id, phase === 'typed'],
  );

  /** Release the microphone and every timer. Safe to call twice. */
  const release = useCallback(() => {
    const r = rec.current;
    if (!r) return;
    window.cancelAnimationFrame(r.raf);
    window.clearInterval(r.timer);
    r.stream.getTracks().forEach((t) => t.stop());
    void r.ctx?.close().catch(() => {});
    r.ctx = null;
  }, []);

  // Set on every mount: StrictMode (and a remount) runs the cleanup in between.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      const r = rec.current;
      if (r && !r.stopped) {
        r.stopped = true;
        try {
          r.recorder.stop();
        } catch {
          /* already stopped */
        }
      }
      release();
    };
  }, [release]);

  // Object URLs belong to this page; free the ones nothing will play again.
  useEffect(
    () => () => {
      if (clip && ![...clips.values()].includes(clip)) URL.revokeObjectURL(clip.url);
    },
    [clip],
  );

  const upload = useCallback(
    async (c: Clip) => {
      if (!onFileUpload) {
        setSave('error');
        setSaveError('Recordings can’t be saved on this form.');
        return;
      }
      const type = (c.blob.type || 'audio/webm').split(';')[0]!.trim();
      const file = new File([c.blob], `voice-note.${extensionFor(type)}`, { type });
      const cap = voiceMaxBytes(maxSec);
      if (file.size > cap) {
        setSave('error');
        setSaveError('That recording is too large. Try a shorter one.');
        return;
      }
      setSave('saving');
      setSaveError(null);
      try {
        const ref = await onFileUpload(file, question.id, { maxSizeMb: cap / MIB });
        if (!alive.current) return;
        clips.set(ref, c);
        setSavedRef(ref);
        setSavedSec(c.seconds);
        setSave('saved');
        setError(null);
        setSaid('Recording saved.');
        onAnswer({ audio: ref, sec: String(c.seconds) });
      } catch (err) {
        if (!alive.current) return;
        setSave('error');
        // The host's own sentence, or plain words — never a browser's or a server's text (MEDIA-06).
        setSaveError(plainError(err));
      }
    },
    [onFileUpload, maxSec, question.id, onAnswer],
  );

  const stop = useCallback(() => {
    const r = rec.current;
    if (!r || r.stopped) return;
    r.stopped = true;
    // "Stop the recording first" no longer applies (MEDIA-12).
    setError(null);
    setElapsed(Math.min(maxSec * 1000, performance.now() - r.started));
    try {
      r.recorder.stop();
    } catch {
      /* the stop handler still runs from the error path below */
    }
    release();
  }, [maxSec, release]);

  const start = useCallback(async () => {
    setError(null);
    const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
    if (
      !md?.getUserMedia ||
      typeof MediaRecorder === 'undefined' ||
      (typeof window !== 'undefined' && window.isSecureContext === false)
    ) {
      setBlocked('unsupported');
      setPhase('blocked');
      return;
    }
    setPhase('asking');
    let stream: MediaStream;
    try {
      stream = await md.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (err) {
      if (!alive.current) return;
      const name = (err as { name?: string } | null)?.name ?? '';
      setBlocked(
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'denied'
          : name === 'NotFoundError' || name === 'OverconstrainedError'
            ? 'nomic'
            : 'failed',
      );
      setPhase('blocked');
      return;
    }
    if (!alive.current) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    const mime = pickVoiceMime();
    let recorder: MediaRecorder;
    try {
      recorder = mime
        ? new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 64_000 })
        : new MediaRecorder(stream);
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      setBlocked('unsupported');
      setPhase('blocked');
      return;
    }

    // A level meter from the live stream (Web Audio), created inside the tap.
    let ctx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    try {
      const AC =
        window.AudioContext ??
        (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AC) {
        ctx = new AC();
        // iOS starts a context created after the permission prompt suspended.
        void ctx.resume?.().catch(() => {});
        analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(analyser);
      }
    } catch {
      ctx = null;
      analyser = null;
    }

    const r = {
      recorder,
      stream,
      ctx,
      raf: 0,
      timer: 0,
      started: performance.now(),
      levels: [] as number[],
      chunks: [] as Blob[],
      stopped: false,
    };
    rec.current = r;

    recorder.onerror = () => {
      if (mime) failedMimes.add(mime);
    };
    recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) r.chunks.push(e.data);
    };
    recorder.onstop = () => {
      release();
      if (!alive.current) return;
      const seconds = Math.max(
        1,
        Math.round(Math.min(maxSec * 1000, performance.now() - r.started) / 1000),
      );
      const blob = new Blob(r.chunks, { type: recorder.mimeType || mime || 'audio/webm' });
      if (blob.size === 0) {
        // This format didn't encode here; "Try again" uses the next one.
        if (mime) failedMimes.add(mime);
        setBlocked('failed');
        setPhase('blocked');
        return;
      }
      const c: Clip = {
        url: URL.createObjectURL(blob),
        blob,
        seconds,
        peaks: downsample(r.levels, BARS_CLIP),
      };
      setClip(c);
      setPlayed(0);
      setPhase('review');
      setSaid(`Recorded ${formatClock(seconds)}. Saving…`);
      void upload(c);
    };

    const buf = analyser ? new Uint8Array(analyser.fftSize) : null;
    let lastSample = 0;
    const tick = (now: number) => {
      if (analyser && buf) {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i]! - 128) / 128;
          sum += v * v;
        }
        const level = Math.min(1, Math.sqrt(Math.sqrt(sum / buf.length)) * 1.4);
        if (now - lastSample >= 80) {
          lastSample = now;
          r.levels.push(level);
          setLive((cur) => [...cur, level].slice(-BARS_LIVE));
        }
      }
      r.raf = window.requestAnimationFrame(tick);
    };
    r.raf = window.requestAnimationFrame(tick);
    r.timer = window.setInterval(() => {
      const ms = performance.now() - r.started;
      setElapsed(ms);
      if (ms >= maxSec * 1000) stop();
    }, 100);

    recorder.start(250);
    setLive([]);
    setElapsed(0);
    setPhase('recording');
    setSaid('Recording. Tap stop when you’re done.');
    ping?.();
  }, [maxSec, release, stop, upload, ping]);

  const reRecord = () => {
    audioRef.current?.pause();
    setPlaying(false);
    setClip(null);
    setSavedRef(null);
    setSavedSec(null);
    setSave('idle');
    setSaveError(null);
    onAnswer(undefined);
    void start();
  };

  const togglePlay = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      void a.play().then(
        () => setPlaying(true),
        () => setPlaying(false),
      );
    } else {
      a.pause();
      setPlaying(false);
    }
  };

  const toTyped = () => {
    if (phase === 'recording') stop();
    setPhase('typed');
    setError(null);
    onAnswer(typed.trim() ? { typed: typed.trim() } : undefined);
  };

  const toRecord = () => {
    setPhase(savedRef ? 'review' : 'idle');
    setError(null);
    onAnswer(savedRef ? { audio: savedRef, sec: String(savedSec ?? 0) } : undefined);
  };

  const submit = useCallback(() => {
    if (phase === 'recording') {
      setError('Stop the recording first');
      shakeInvalid(recordRef.current);
      return;
    }
    if (save === 'saving') {
      setError('Still saving your recording…');
      return;
    }
    // They did record — it just didn't save. Say that, not "please record" (MEDIA-12).
    if (phase === 'review' && save === 'error' && clip) {
      setError(
        allowTyped
          ? 'Your recording didn’t save. Tap Retry, or type your answer instead.'
          : 'Your recording didn’t save. Tap Retry.',
      );
      shakeInvalid(rootRef.current);
      return;
    }
    const answer: Record<string, string> | undefined =
      phase === 'typed'
        ? typed.trim()
          ? { typed: typed.trim().slice(0, VOICE_TYPED_MAX) }
          : undefined
        : savedRef
          ? { audio: savedRef, sec: String(savedSec ?? 0) }
          : undefined;
    // Typing is always allowed once offered: with the owner's typing off, only
    // a blocked or missing microphone leads here (MEDIA-17).
    const err = validate(phase === 'typed' ? { ...question, allowTyped: true } : question, answer);
    if (err) {
      setError(err.message);
      shakeInvalid(phase === 'typed' ? typedRef.current : rootRef.current);
      return;
    }
    setError(null);
    onAnswer(answer);
    onAdvance();
  }, [phase, save, clip, allowTyped, typed, savedRef, savedSec, question, onAnswer, onAdvance]);

  useRegisterFormConfirm(submit);

  const recording = phase === 'recording';
  const progress = Math.min(1, elapsed / (maxSec * 1000));
  const level = live.length ? live[live.length - 1]! : 0;
  const calm = motionReduced(rootRef.current);
  const seconds = clip?.seconds ?? savedSec ?? 0;
  const peaks = clip?.peaks ?? downsample([], BARS_CLIP);
  const playedPct = clip && seconds ? Math.min(1, played / seconds) : 0;

  return (
    <div ref={rootRef}>
      <h1 id={titleId} className="slate-title">
        {resolveTitle(question.title, answers)}
      </h1>
      {question.body ? <p className="slate-subtitle">{question.body}</p> : null}

      {phase === 'typed' ? (
        <div className="slate-voice slate-voice--typed">
          <textarea
            ref={typedRef}
            className="slate-textarea slate-voice-typed"
            value={typed}
            rows={4}
            maxLength={VOICE_TYPED_MAX}
            placeholder="Type your answer…"
            aria-labelledby={titleId}
            onChange={(e) => {
              setTyped(e.target.value);
              setError(null);
              const t = e.target.value.trim();
              onAnswer(t ? { typed: t } : undefined);
            }}
            onKeyDown={(e) => {
              if (isTypewriterKey(e)) onType?.();
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <button type="button" className="slate-voice-link" onClick={toRecord}>
            Record instead
          </button>
        </div>
      ) : phase === 'blocked' ? (
        <div className="slate-voice slate-voice--blocked" role="status">
          <p className="slate-voice-note">
            {blocked === 'denied'
              ? 'Your microphone is blocked for this page. To record, allow it in your browser’s settings and try again.'
              : blocked === 'nomic'
                ? 'We couldn’t find a microphone on this device.'
                : blocked === 'unsupported'
                  ? 'This browser can’t record audio here.'
                  : 'The recording didn’t work. Please try again.'}
            {/* Always a way through, even with typing off (MEDIA-17): nobody is stuck. */}
            {' You can type your answer instead.'}
          </p>
          <div className="slate-voice-row">
            <button type="button" className="slate-voice-btn" onClick={toTyped}>
              Type instead
            </button>
            {blocked !== 'unsupported' ? (
              <button type="button" className="slate-voice-link" onClick={() => void start()}>
                Try again
              </button>
            ) : null}
          </div>
        </div>
      ) : phase === 'review' ? (
        <div className="slate-voice slate-voice--review">
          <div className="slate-voice-player">
            {clip ? (
              <>
                <button
                  type="button"
                  className="slate-voice-play"
                  aria-label={playing ? 'Pause' : 'Play your recording'}
                  onClick={togglePlay}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    {playing ? (
                      <path d="M8 5.5v13M16 5.5v13" />
                    ) : (
                      <path d="M8 5.5 18.5 12 8 18.5z" />
                    )}
                  </svg>
                </button>
                <audio
                  ref={audioRef}
                  src={clip.url}
                  preload="metadata"
                  onTimeUpdate={(e) => setPlayed(e.currentTarget.currentTime)}
                  onEnded={() => {
                    setPlaying(false);
                    setPlayed(0);
                  }}
                />
              </>
            ) : (
              <span className="slate-voice-play slate-voice-play--done" aria-hidden="true">
                <svg viewBox="0 0 24 24" focusable="false">
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              </span>
            )}
            <span
              className="slate-voice-wave"
              style={{ '--slate-played': playedPct } as CSSProperties}
              aria-hidden="true"
            >
              {peaks.map((p, i) => (
                <span
                  key={i}
                  className={`slate-voice-bar${i / peaks.length < playedPct ? ' is-played' : ''}`}
                  style={{ '--slate-level': p } as CSSProperties}
                />
              ))}
            </span>
            <span className="slate-voice-time">{formatClock(seconds)}</span>
          </div>
          <div className="slate-voice-row">
            <span className={`slate-voice-save slate-voice-save--${save}`} role="status">
              {save === 'saving'
                ? 'Saving…'
                : save === 'saved'
                  ? 'Saved'
                  : save === 'error'
                    ? (saveError ?? 'Couldn’t save the recording.')
                    : ''}
              {save === 'saved' ? (
                <svg
                  className="slate-voice-check"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              ) : null}
            </span>
            {save === 'error' && clip ? (
              <button type="button" className="slate-voice-link" onClick={() => void upload(clip)}>
                Retry
              </button>
            ) : null}
            <button type="button" className="slate-voice-btn" onClick={reRecord}>
              Re-record
            </button>
          </div>
          {allowTyped ? (
            <button type="button" className="slate-voice-link" onClick={toTyped}>
              Type instead
            </button>
          ) : null}
        </div>
      ) : (
        <div className={`slate-voice${recording ? ' slate-voice--recording' : ''}`}>
          <div className="slate-voice-stage">
            <button
              ref={recordRef}
              type="button"
              className="slate-voice-record"
              style={
                {
                  '--slate-level': calm ? 0 : level,
                  '--slate-progress': progress,
                } as CSSProperties
              }
              aria-label={recording ? 'Stop recording' : 'Start recording'}
              aria-pressed={recording}
              disabled={phase === 'asking'}
              onClick={() => (recording ? stop() : void start())}
            >
              <svg
                className="slate-voice-ring"
                viewBox="0 0 100 100"
                aria-hidden="true"
                focusable="false"
              >
                <circle cx="50" cy="50" r="46" pathLength={100} />
              </svg>
              {recording ? <span className="slate-voice-stop" aria-hidden="true" /> : <MicIcon />}
            </button>
            <div className="slate-voice-status" aria-hidden={!recording}>
              {recording ? (
                <>
                  <span className="slate-voice-rec">REC</span>
                  <span className="slate-voice-time">
                    {formatClock(elapsed / 1000)} / {formatClock(maxSec)}
                  </span>
                </>
              ) : (
                <span className="slate-voice-cta">
                  {phase === 'asking' ? 'Allow the microphone…' : 'Tap to record'}
                  <span className="slate-voice-sub">Up to {formatClock(maxSec)}</span>
                </span>
              )}
            </div>
          </div>
          {recording ? (
            <span className="slate-voice-meter" aria-hidden="true">
              {Array.from({ length: BARS_LIVE }, (_, i) => {
                const v = live[live.length - BARS_LIVE + i] ?? 0;
                return (
                  <span
                    key={i}
                    className="slate-voice-bar"
                    style={{ '--slate-level': Math.max(0.05, v) } as CSSProperties}
                  />
                );
              })}
            </span>
          ) : null}
          {allowTyped && !recording ? (
            <button type="button" className="slate-voice-link" onClick={toTyped}>
              Type instead
            </button>
          ) : null}
        </div>
      )}

      <p className="slate-sr" aria-live="polite">
        {said}
      </p>
      {error ? (
        <p className="slate-err" aria-live="polite">
          ! {error}
        </p>
      ) : null}
      <div className="slate-actions">
        <button type="button" className="slate-ok-btn" onClick={submit}>
          OK <span aria-hidden>✓</span>
        </button>
        <span className="slate-hint">press Enter ↵</span>
      </div>
    </div>
  );
}
