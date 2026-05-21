"""
Defense demo — hierarchical per-face reveal hierarchy visualization.

Ажиллуулах:
    python demo_hierarchical_reveal.py

6 хүний нүүрийг hash-chain key-ээр encrypt хийгээд, role түвшин бүр
ямар нүүрсийг reveal хийж чадахыг хүснэгтээр харуулна.
"""

import secrets

import hierarchical_keys as hk

ROLES = [
    (0, "Director",   "Бүх нүүр"),
    (1, "Deputy",     "1-ээс доош"),
    (2, "Region head","2-оос доош"),
    (3, "Manager",    "3-аас доош"),
    (4, "Supervisor", "4-ээс доош"),
    (5, "Operator",   "Зөвхөн өөрөө"),
]

GREEN = "\033[92m"
RED = "\033[91m"
DIM = "\033[2m"
BOLD = "\033[1m"
RESET = "\033[0m"


def main() -> None:
    master = secrets.token_bytes(32)
    recording_id = "demo-cctv-20260519-0001"

    # 6 хүний нүүр (жинхэнэ системд JPEG crop bytes)
    people = [f"Person-{i + 1}".encode() for i in range(6)]

    print()
    print(f"{BOLD}╔══════════════════════════════════════════════════════════════╗{RESET}")
    print(f"{BOLD}║  MONGOLZ — Hierarchical Per-Face Reveal (hash-chain keys)    ║{RESET}")
    print(f"{BOLD}╚══════════════════════════════════════════════════════════════╝{RESET}")
    print()
    print(f"Recording: {recording_id}")
    print(f"Detected faces: {len(people)}  (Person-1 … Person-6)")
    print()
    print(f"{DIM}Encryption: Face i → AES-256-GCM(Kᵢ),  Kᵢ₊₁ = SHA256(Kᵢ){RESET}")
    print()

    # Бүх нүүрийг chain key-ээр encrypt
    blobs = hk.encrypt_faces(people, recording_id, master)
    encrypted = {i: b for i, b in enumerate(blobs)}

    # Header
    print(f"{BOLD}Role           Key   │ " + " ".join(f"P{i+1}" for i in range(6)) + f"  │ Scope{RESET}")
    print("─" * 68)

    for level, role, scope in ROLES:
        # Энэ түвшний key-ээр reveal хийнэ (root-гүй, зөвхөн K_level)
        level_key = hk.key_at_index(recording_id, level, master)
        revealed = hk.reveal_with_level_key(encrypted, level, level_key)

        cells = []
        for i in range(6):
            if i in revealed:
                # Decrypt амжилттай — нүүр харагдана
                assert revealed[i] == people[i]
                cells.append(f"{GREEN}██{RESET}")
            else:
                # Хүрэхгүй — blurred хэвээр
                cells.append(f"{RED}▓▓{RESET}")

        keylabel = f"K{level}"
        print(f"{role:<14} {keylabel:<4} │ " + " ".join(cells) + f"  │ {DIM}{scope}{RESET}")

    print("─" * 68)
    print(f"  {GREEN}██{RESET} = reveal боломжтой    {RED}▓▓{RESET} = blurred (key хүрэхгүй)")
    print()
    print(f"{BOLD}Security guarantee:{RESET}")
    print(f"  • Kᵢ → Kᵢ₊₁ = SHA256(Kᵢ)  (урагшаа derive)")
    print(f"  • Kᵢ → Kᵢ₋₁  {RED}БОЛОМЖГҮЙ{RESET}  (SHA256 нэг чиглэлт)")
    print(f"  • Manager (K3) Person-1,2,3-ийг хэзээ ч нээж чадахгүй")
    print()

    # Эцсийн баталгаа — backward resistance
    k3 = hk.key_at_index(recording_id, 3, master)
    blocked = hk.reveal_with_level_key(encrypted, 3, k3)
    assert 0 not in blocked and 1 not in blocked and 2 not in blocked
    print(f"{GREEN}✓ Verified:{RESET} K3 → {sorted(blocked.keys())} reveal "
          f"(Person-1,2,3 blocked)")
    print()


if __name__ == "__main__":
    main()
