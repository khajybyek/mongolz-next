/**
 * Live HLS playback for one <video> element, framework-free so the ticket
 * renewal and failure handling can be tested without a DOM
 * (components/hls-player.tsx is the React wrapper).
 *
 * Two engines. hls.js whenever it is supported — MediaSource, or
 * ManagedMediaSource on macOS Safari and iPadOS / iOS 17.1+ (hls.js sets the
 * `disableRemotePlayback` that ManagedMediaSource needs). Native HLS only as
 * the fallback: a browser that plays `application/vnd.apple.mpegurl` but has
 * neither (older iOS), or an hls.js chunk that failed to load.
 *
 * Stream tickets (lib/stream-ticket-renewal.ts) reach the gateway differently
 * in each:
 *   • hls.js — `xhrSetup` sets `?ticket=` on every playlist reload and every
 *     segment, reading the renewer's newest ticket at request time, so a
 *     renewal takes effect with the next request and nothing restarts.
 *   • native — only the playlist URL carries the ticket. The gateway streams
 *     the ML playlist unchanged and its segment URIs are relative, so segment
 *     requests carry no ticket at all (the gateway checks the session, the
 *     camera and the grant on every request; the ticket is an extra layer).
 *     The element keeps re-requesting the URL it was given, and there is no
 *     way to hand it a new one without setting `src` again, which reloads the
 *     live edge — a brief stall once per ~195 s on this fallback only. A
 *     viewer who paused keeps the paused frame: the swap waits for `play`.
 *
 * A 403 without a refusal code gets one immediate renewal and one retry; a
 * refusal code (camera_disabled | camera_not_authorized |
 * permission_check_failed) stops the renewer and is reported as before.
 */

import type Hls from "hls.js";
import { probeStreamFailure, readStreamDenyCode, type StreamDenyCode } from "@/lib/live-access";
import {
  createTicketRenewer,
  ticketFromUrl,
  withTicket,
  type TicketRenewer,
} from "@/lib/stream-ticket-renewal";

type VisibilitySource = Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState">;

export interface HlsPlaybackOptions {
  video: HTMLVideoElement;
  /** Playlist URL, usually `/api/ml/stream/<id>/index.m3u8?ticket=…`. */
  src: string;
  /** Loads hls.js (a dynamic import in the browser, a fake in tests). */
  loadHls: () => Promise<typeof Hls>;
  /**
   * Issues a fresh ticket for this camera. Without it (or without `?ticket=`
   * in `src`) the player keeps the ticket it was given, as it used to.
   */
  renewTicket?: () => Promise<string>;
  onPlaying?: () => void;
  /** See HlsPlayerProps.onError. */
  onError?: (status?: number, code?: StreamDenyCode | null) => void;
  fetchImpl?: typeof fetch;
  /** Origin that relative URLs resolve against (window.location.origin). */
  baseUrl?: string;
  /** Where visibility changes come from (document). */
  doc?: VisibilitySource;
}

/** Starts playback; the returned function stops it and every timer it owns. */
export function startHlsPlayback(opts: HlsPlaybackOptions): () => void {
  const { video, src } = opts;
  const base = opts.baseUrl ?? (typeof window !== "undefined" ? window.location.origin : "http://localhost");
  const doc = opts.doc ?? (typeof document !== "undefined" ? document : undefined);

  let hls: Hls | undefined;
  // The hls.js import and the renewals are async; anything that resolves
  // after dispose must not touch the element or call back into the page.
  let cancelled = false;
  // One recovery at a time; stays set once a failure has been reported.
  let recovering = false;
  // Where a renewed ticket goes besides the renewer (native: the element).
  let onTicket: ((ticket: string) => void) | null = null;
  // Native only: the viewer paused (a `pause` event with no `play` since),
  // and the renewed ticket waiting for them to resume.
  let heldPaused = false;
  let pendingSwap: string | null = null;

  const initialTicket = ticketFromUrl(src, base);
  const renewTicket = opts.renewTicket;
  const renewer: TicketRenewer | null =
    initialTicket && renewTicket
      ? createTicketRenewer({
          ticket: initialTicket,
          renew: () => renewTicket(),
          onRenewed: (ticket) => onTicket?.(ticket),
        })
      : null;

  const currentSrc = () => (renewer ? withTicket(src, renewer.current(), base) : src);

  // The player gives up here: nothing renews any more, the page decides.
  const report = (status?: number, code?: StreamDenyCode | null) => {
    recovering = true;
    renewer?.stop();
    if (!cancelled) opts.onError?.(status, code);
  };

  const handlePlaying = () => {
    renewer?.healthy();
    opts.onPlaying?.();
  };
  const handleVisibility = () => {
    if (doc?.visibilityState === "visible") renewer?.resume();
  };
  video.addEventListener("playing", handlePlaying);
  doc?.addEventListener("visibilitychange", handleVisibility);

  // Native: point the element at `ticket`. Our own load algorithm pauses the
  // element without a `pause` event, so heldPaused only ever reflects the
  // viewer.
  const swapNative = (ticket: string) => {
    pendingSwap = null;
    const resume = !video.paused;
    video.src = withTicket(src, ticket, base);
    if (resume) void video.play()?.catch(() => {});
  };
  const handlePause = () => {
    heldPaused = true;
  };
  const handlePlay = () => {
    heldPaused = false;
    if (!cancelled && pendingSwap !== null) swapNative(pendingSwap);
  };

  // Native HLS reports no HTTP status, so ask the gateway once why the
  // playlist failed — that is what turns a refusal into a readable reason and
  // an expired ticket into a renewal instead of a generic error.
  const handleNativeError = () => {
    if (cancelled || recovering) return;
    // Paused past a renewal: the element still asks with the ticket it had,
    // so this is that ticket running out. The fresh one is applied when the
    // viewer resumes (and a refusal, if that is what it was, surfaces then).
    if (pendingSwap !== null) return;
    recovering = true;
    void (async () => {
      const failure = await probeStreamFailure(currentSrc(), opts.fetchImpl);
      if (cancelled) return;
      if (failure.status === 403 && !failure.code && renewer && (await renewer.expired())) {
        // onRenewed already pointed the element at the fresh ticket (or, for
        // a viewer who paused, queued it for their next play).
        if (!cancelled) recovering = false;
        return;
      }
      report(failure.status, failure.code);
    })();
  };

  const playNative = () => {
    onTicket = (ticket) => {
      if (cancelled) return;
      // Setting `src` runs the media load algorithm: the element is emptied
      // and, with the autoplay attribute every page renders, starts playing
      // again on its own. A viewer who paused keeps the paused frame; the
      // swap waits for their next `play`.
      if (heldPaused) pendingSwap = ticket;
      else swapNative(ticket);
    };
    video.addEventListener("pause", handlePause);
    video.addEventListener("play", handlePlay);
    video.addEventListener("error", handleNativeError);
    video.src = currentSrc();
  };

  const playHls = (HlsClass: typeof Hls) => {
    const instance = new HlsClass({
      lowLatencyMode: true,
      liveSyncDuration: 2,
      xhrSetup: initialTicket
        ? (xhr, url) => {
            const u = new URL(url, base);
            u.searchParams.set("ticket", renewer ? renewer.current() : initialTicket);
            xhr.open("GET", u.toString(), true);
          }
        : undefined,
    });
    hls = instance;
    const healthy = () => renewer?.healthy();
    instance.on(HlsClass.Events.LEVEL_LOADED, healthy);
    instance.on(HlsClass.Events.FRAG_LOADED, healthy);
    instance.on(HlsClass.Events.ERROR, (_event, data) => {
      if (!data.fatal || cancelled) return;
      // hls.js attaches the failing response on load errors.
      const status =
        typeof data.response === "object" && data.response
          ? (data.response as { code?: number }).code
          : undefined;
      // A 403 is never fixed by reloading with the same ticket: a grant
      // revoked mid-stream or a camera disabled meanwhile used to leave the
      // player re-requesting forever behind a frozen frame. Stop loading, then
      // tell a refusal (terminal, reported with its code) from an expired
      // ticket (renew once, retry once).
      if (data.type === HlsClass.ErrorTypes.NETWORK_ERROR && status === 403) {
        instance.stopLoad();
        if (recovering) return;
        recovering = true;
        const manifest = data.details === HlsClass.ErrorDetails.MANIFEST_LOAD_ERROR;
        void (async () => {
          let code = readStreamDenyCode(data.networkDetails);
          if (!code) {
            const probe = await probeStreamFailure(currentSrc(), opts.fetchImpl);
            code = probe.status === 403 ? probe.code : null;
          }
          if (cancelled) return;
          if (!code && renewer && (await renewer.expired())) {
            if (cancelled || hls !== instance) return;
            recovering = false;
            // xhrSetup puts the fresh ticket on every request from here on.
            if (manifest) instance.loadSource(currentSrc());
            else instance.startLoad();
            return;
          }
          report(403, code);
        })();
        return;
      }
      // One recovery attempt for transient network / media glitches, then
      // surface the failure so the tile can show a retry control.
      if (data.type === HlsClass.ErrorTypes.NETWORK_ERROR && data.details !== HlsClass.ErrorDetails.MANIFEST_LOAD_ERROR) {
        instance.startLoad();
        return;
      }
      if (data.type === HlsClass.ErrorTypes.MEDIA_ERROR) {
        instance.recoverMediaError();
        return;
      }
      report(status);
    });
    instance.loadSource(currentSrc());
    instance.attachMedia(video);
  };

  void (async () => {
    // A remounted tile can bring a ticket that already ran out: wait (briefly)
    // for the renewal that started with the renewer instead of opening with a
    // request that is bound to be refused.
    if (renewer?.startsExpired) await renewer.settle();
    if (cancelled) return;
    let HlsClass: typeof Hls;
    try {
      HlsClass = await opts.loadHls();
    } catch {
      // The hls.js chunk did not load (offline, a deploy replaced it).
      if (cancelled) return;
      if (video.canPlayType("application/vnd.apple.mpegurl")) playNative();
      else report();
      return;
    }
    if (cancelled) return;
    // hls.js first, even where the element plays HLS natively: only hls.js
    // can carry a renewed ticket without reloading the stream.
    if (HlsClass.isSupported()) playHls(HlsClass);
    else playNative();
  })();

  return () => {
    cancelled = true;
    renewer?.stop();
    onTicket = null;
    pendingSwap = null;
    video.removeEventListener("playing", handlePlaying);
    video.removeEventListener("pause", handlePause);
    video.removeEventListener("play", handlePlay);
    video.removeEventListener("error", handleNativeError);
    doc?.removeEventListener("visibilitychange", handleVisibility);
    hls?.destroy();
    hls = undefined;
  };
}
