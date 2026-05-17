"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Activity, AlertTriangle } from "lucide-react";

interface Labels {
  start: string;
  stop: string;
  status: string;
  latency: string;
  jitter: string;
  fps: string;
  bitrate: string;
  packetsLost: string;
}

interface Stats {
  rtt_ms: number | null;
  jitter_ms: number | null;
  fps: number | null;
  bitrate_kbps: number | null;
  packetsLost: number | null;
  iceState: string;
  signalingState: string;
}

const ZERO: Stats = {
  rtt_ms: null,
  jitter_ms: null,
  fps: null,
  bitrate_kbps: null,
  packetsLost: null,
  iceState: "new",
  signalingState: "new",
};

export function LiveRtcView({ labels }: { labels: Labels }) {
  const publisherRef = useRef<HTMLVideoElement | null>(null);
  const subscriberRef = useRef<HTMLVideoElement | null>(null);
  const pcsRef = useRef<{ pub: RTCPeerConnection; sub: RTCPeerConnection } | null>(null);
  const statsLoopRef = useRef<number | null>(null);
  const lastBytesRef = useRef<{ bytes: number; t: number } | null>(null);

  const [running, setRunning] = useState(false);
  const [stats, setStats] = useState<Stats>(ZERO);
  const [err, setErr] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  async function start() {
    setErr(null);
    setStarting(true);
    try {
      // 1. Capture
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720 },
        audio: false,
      });
      if (publisherRef.current) publisherRef.current.srcObject = stream;

      // 2. Two peer connections (publisher → subscriber loopback)
      const pub = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
      const sub = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
      pcsRef.current = { pub, sub };

      // ICE candidate exchange (loopback in-process)
      pub.onicecandidate = (e) => e.candidate && sub.addIceCandidate(e.candidate);
      sub.onicecandidate = (e) => e.candidate && pub.addIceCandidate(e.candidate);

      // 3. Add tracks to publisher
      stream.getTracks().forEach((t) => pub.addTrack(t, stream));

      // 4. Subscriber gets stream
      sub.ontrack = (e) => {
        if (subscriberRef.current && e.streams[0]) {
          subscriberRef.current.srcObject = e.streams[0];
        }
      };

      // 5. SDP offer/answer handshake (self-loop)
      const offer = await pub.createOffer();
      await pub.setLocalDescription(offer);
      await sub.setRemoteDescription(offer);
      const answer = await sub.createAnswer();
      await sub.setLocalDescription(answer);
      await pub.setRemoteDescription(answer);

      setRunning(true);

      // 6. Stats loop
      const tick = async () => {
        try {
          const report = await sub.getStats();
          let rtt: number | null = null;
          let jitter: number | null = null;
          let fps: number | null = null;
          let packetsLost: number | null = null;
          let bytesReceived = 0;

          report.forEach((stat) => {
            const s = stat as RTCStats & Record<string, unknown>;
            if (s.type === "candidate-pair" && s["state"] === "succeeded") {
              const ct = s["currentRoundTripTime"];
              if (typeof ct === "number") rtt = ct * 1000;
            }
            if (s.type === "inbound-rtp" && s["kind"] === "video") {
              if (typeof s["jitter"] === "number") jitter = (s["jitter"] as number) * 1000;
              if (typeof s["framesPerSecond"] === "number") fps = s["framesPerSecond"] as number;
              if (typeof s["packetsLost"] === "number") packetsLost = s["packetsLost"] as number;
              if (typeof s["bytesReceived"] === "number") bytesReceived = s["bytesReceived"] as number;
            }
          });

          // Bitrate via delta
          let bitrate_kbps: number | null = null;
          const now = performance.now();
          if (lastBytesRef.current) {
            const dt = (now - lastBytesRef.current.t) / 1000;
            const db = bytesReceived - lastBytesRef.current.bytes;
            if (dt > 0) bitrate_kbps = Math.round((db * 8) / 1000 / dt);
          }
          lastBytesRef.current = { bytes: bytesReceived, t: now };

          setStats({
            rtt_ms: rtt,
            jitter_ms: jitter,
            fps: fps ? Math.round(fps) : null,
            bitrate_kbps,
            packetsLost,
            iceState: pub.iceConnectionState,
            signalingState: pub.signalingState,
          });
        } catch {
          // ignore
        }
        statsLoopRef.current = window.setTimeout(tick, 1000);
      };
      tick();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "WebRTC failed");
    } finally {
      setStarting(false);
    }
  }

  function stop() {
    if (statsLoopRef.current !== null) {
      clearTimeout(statsLoopRef.current);
      statsLoopRef.current = null;
    }
    pcsRef.current?.pub.close();
    pcsRef.current?.sub.close();
    pcsRef.current = null;
    [publisherRef, subscriberRef].forEach((ref) => {
      const v = ref.current;
      if (v?.srcObject instanceof MediaStream) {
        v.srcObject.getTracks().forEach((t) => t.stop());
      }
      if (v) v.srcObject = null;
    });
    lastBytesRef.current = null;
    setStats(ZERO);
    setRunning(false);
  }

  useEffect(() => () => stop(), []);

  const isHealthy = stats.iceState === "connected" || stats.iceState === "completed";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="card p-0 overflow-hidden bg-black aspect-video relative">
          <video ref={publisherRef} autoPlay muted playsInline className="w-full h-full object-contain" />
          <div className="absolute top-2 left-2 text-[10px] uppercase tracking-wide bg-bg/80 backdrop-blur px-2 py-0.5 rounded">
            Publisher
          </div>
        </div>
        <div className="card p-0 overflow-hidden bg-black aspect-video relative">
          <video ref={subscriberRef} autoPlay muted playsInline className="w-full h-full object-contain" />
          <div className="absolute top-2 left-2 text-[10px] uppercase tracking-wide bg-bg/80 backdrop-blur px-2 py-0.5 rounded">
            Subscriber (WebRTC loopback)
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {!running ? (
          <button onClick={start} disabled={starting} className="btn-primary">
            {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />}
            {labels.start}
          </button>
        ) : (
          <button onClick={stop} className="btn-ghost">
            {labels.stop}
          </button>
        )}
        {err && (
          <span className="text-xs text-danger flex items-center gap-1.5">
            <AlertTriangle className="w-3 h-3" /> {err}
          </span>
        )}
      </div>

      {running && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Stat label={labels.status} value={stats.iceState} good={isHealthy} />
          <Stat
            label={labels.latency}
            value={stats.rtt_ms !== null ? `${stats.rtt_ms.toFixed(1)} ms` : "—"}
            good={stats.rtt_ms !== null && stats.rtt_ms < 100}
          />
          <Stat
            label={labels.jitter}
            value={stats.jitter_ms !== null ? `${stats.jitter_ms.toFixed(2)} ms` : "—"}
            good={stats.jitter_ms === null || stats.jitter_ms < 50}
          />
          <Stat label={labels.fps} value={stats.fps !== null ? `${stats.fps}` : "—"} good={!!stats.fps && stats.fps >= 20} />
          <Stat
            label={labels.bitrate}
            value={stats.bitrate_kbps !== null ? `${stats.bitrate_kbps} kbps` : "—"}
            good
          />
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, good }: { label: string; value: string; good: boolean }) {
  return (
    <div className="card text-center">
      <div className="text-[10px] uppercase tracking-wide text-text-muted">{label}</div>
      <div className={`text-lg font-bold ${good ? "text-success" : "text-warning"}`}>{value}</div>
    </div>
  );
}
