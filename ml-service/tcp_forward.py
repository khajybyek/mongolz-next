"""
TCP forwarder via SOCKS5 — Tailscale userspace networking bridge.

Railway-ийн container нь TUN device-гүй учир Tailscale-ийг userspace
networking mode-д ажиллуулдаг. Тэр mode-д ердийн TCP socket нь tailnet
IP-руу шууд хүрч чаддаггүй — Tailscale-ийн SOCKS5 proxy (:1055)-аар
дамжих ёстой.

FFmpeg / OpenCV нь SOCKS5 native дэмжихгүй учир, бид localhost-д TCP
listener асааж, түүн рүү ирсэн connection бүрийг PySocks-аар Tailscale
SOCKS5-руу proxying хийнэ.

CAMERA_TAILNET_FWD env-ийн форматhybnyh:

    "5554:192.168.0.15:554"           — нэг forwarding
    "5554:192.168.0.15:554;5555:..."  — олон forwarding (semicolon-аар хуваана)

Жишээ ашиглалт:
    rtsp://admin:pass@127.0.0.1:5554/...   ← Vercel /cameras-д
"""

from __future__ import annotations

import logging
import os
import socket
import sys
import threading
from typing import Iterable, NamedTuple

try:
    import socks  # type: ignore[import-not-found]
except ImportError:
    print("FATAL: PySocks not installed. Add 'PySocks' to requirements.txt", file=sys.stderr)
    sys.exit(2)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [tcp_forward] %(levelname)s %(message)s",
)
log = logging.getLogger("tcp_forward")


class Forward(NamedTuple):
    local_port: int
    remote_host: str
    remote_port: int


def parse_forwards(spec: str) -> list[Forward]:
    """
    "5554:192.168.0.15:554;5555:10.0.0.5:80" → [Forward(5554, ...), Forward(5555, ...)]
    """
    out: list[Forward] = []
    for piece in spec.split(";"):
        piece = piece.strip()
        if not piece:
            continue
        parts = piece.split(":")
        if len(parts) != 3:
            log.warning("Invalid forward spec %r (expected PORT:HOST:PORT)", piece)
            continue
        try:
            local_p = int(parts[0])
            remote_p = int(parts[2])
        except ValueError:
            log.warning("Invalid port numbers in %r", piece)
            continue
        out.append(Forward(local_p, parts[1], remote_p))
    return out


def pipe(src: socket.socket, dst: socket.socket, tag: str) -> None:
    """Half-duplex copy until EOF."""
    try:
        while True:
            data = src.recv(8192)
            if not data:
                break
            dst.sendall(data)
    except OSError as e:
        log.debug("pipe %s closed: %s", tag, e)
    finally:
        for s in (src, dst):
            try:
                s.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            try:
                s.close()
            except OSError:
                pass


def handle_client(client: socket.socket, fwd: Forward, proxy_host: str, proxy_port: int) -> None:
    """Open SOCKS5 connection to remote, then full-duplex pipe."""
    upstream = socks.socksocket()
    upstream.set_proxy(socks.SOCKS5, proxy_host, proxy_port)
    try:
        upstream.connect((fwd.remote_host, fwd.remote_port))
    except (socks.GeneralProxyError, socks.ProxyConnectionError, OSError) as e:
        log.error("SOCKS5 → %s:%d failed: %s", fwd.remote_host, fwd.remote_port, e)
        client.close()
        return

    log.info("Forward open: client → %s:%d (via SOCKS5)", fwd.remote_host, fwd.remote_port)

    # Full-duplex
    t1 = threading.Thread(target=pipe, args=(client, upstream, "c→u"), daemon=True)
    t2 = threading.Thread(target=pipe, args=(upstream, client, "u→c"), daemon=True)
    t1.start()
    t2.start()
    t1.join()
    t2.join()
    log.debug("Forward closed: %s:%d", fwd.remote_host, fwd.remote_port)


def run_listener(fwd: Forward, proxy_host: str, proxy_port: int) -> None:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        sock.bind(("127.0.0.1", fwd.local_port))
    except OSError as e:
        log.error("Bind 127.0.0.1:%d failed: %s", fwd.local_port, e)
        return
    sock.listen(64)
    log.info(
        "Listening 127.0.0.1:%d → SOCKS5(%s:%d) → %s:%d",
        fwd.local_port, proxy_host, proxy_port, fwd.remote_host, fwd.remote_port,
    )

    while True:
        try:
            client, addr = sock.accept()
        except OSError as e:
            log.warning("accept() failed: %s", e)
            continue
        threading.Thread(
            target=handle_client,
            args=(client, fwd, proxy_host, proxy_port),
            daemon=True,
        ).start()


def main(argv: Iterable[str]) -> int:
    spec = os.environ.get("CAMERA_TAILNET_FWD", "").strip()
    if not spec:
        log.info("CAMERA_TAILNET_FWD not set — nothing to forward, exiting.")
        return 0

    forwards = parse_forwards(spec)
    if not forwards:
        log.error("CAMERA_TAILNET_FWD parsed empty: %r", spec)
        return 1

    proxy_host = os.environ.get("TAILSCALE_SOCKS_HOST", "127.0.0.1")
    proxy_port = int(os.environ.get("TAILSCALE_SOCKS_PORT", "1055"))

    log.info("Starting %d forwarder(s) via SOCKS5 %s:%d", len(forwards), proxy_host, proxy_port)

    threads: list[threading.Thread] = []
    for fwd in forwards:
        t = threading.Thread(
            target=run_listener,
            args=(fwd, proxy_host, proxy_port),
            daemon=False,  # Main thread waits on these
            name=f"fwd-{fwd.local_port}",
        )
        t.start()
        threads.append(t)

    for t in threads:
        t.join()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
