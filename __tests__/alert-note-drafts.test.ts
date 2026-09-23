/**
 * /alerts and /alerts/[id] client components (no DOM test runner in this
 * repo, so these are source invariants guarding two 2026-09-23 fixes):
 *
 * 1. Note → Save → Close erased the note: both components copied the `note`
 *    prop into state once at mount; router.refresh() updates the prop, not the
 *    state, so Close sent the stale "" and the state route stored NULL. Drafts
 *    are now seeded when a dialog opens, and Close sends `note` only when it
 *    was edited there (an omitted field leaves the stored note alone).
 * 2. The fixed mobile action bar sat on top of the mobile tab bar.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");
const stateActions = read("app/(app)/alerts/alert-state-actions.tsx");
const mobileActions = read("app/(app)/alerts/[id]/alert-mobile-actions.tsx");
const tabbar = read("components/mobile-tabbar.tsx");

describe("alert note drafts", () => {
  it.each([
    ["alert-state-actions", stateActions],
    ["alert-mobile-actions", mobileActions],
  ])("%s never seeds the draft from the prop at mount", (_name, src) => {
    expect(src).not.toMatch(/useState\(\s*note\b/);
    expect(src).toMatch(/setNoteDraft\(note \?\? ""\)/);
  });

  it("Close sends the note only when it was edited in the dialog", () => {
    expect(stateActions).toMatch(/transition\("closed", noteDirty \? \{ note: noteDraft \} : undefined\)/);
    expect(stateActions).toMatch(/setNoteDirty\(true\)/);
    expect(stateActions).not.toMatch(/onClick=\{\(\) => setCloseOpen\(true\)\}/);
  });

  it("the state route leaves the stored note alone when `note` is omitted", () => {
    const route = read("app/api/alerts/[id]/state/route.ts");
    expect(route).toMatch(/parsed\.data\.note === undefined \? undefined/);
    expect(route).toMatch(/if \(note !== undefined\) patch\.note = note;/);
  });
});

describe("mobile alert action bar", () => {
  it("floats above the mobile tab bar instead of covering it", () => {
    const tabHeight = /h-\[(\d+)px\]/.exec(tabbar)?.[1];
    expect(tabHeight).toBe("68");
    expect(mobileActions).not.toMatch(/fixed inset-x-0 bottom-0/);
    // 68px row + 2px border, above the tab bar's own bottom inset.
    expect(mobileActions).toContain("bottom-[calc(max(0.75rem,env(safe-area-inset-bottom,0px))+70px+0.5rem)]");
    expect(mobileActions).toMatch(/lg:sticky lg:inset-auto lg:bottom-4/);
  });
});
