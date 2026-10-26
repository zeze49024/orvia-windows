// @vitest-environment jsdom
import { test, expect, vi } from "vitest";
import { applyMotion, motionProfiles, chatScrollBehavior } from "./motion";
import { emptyWorkspace, workspaceSchema } from "./model";
test("legacy preferences default to moderate; all profiles share bounded ordered timings", () => {
  const w = emptyWorkspace();
  delete (w.settings as any).motion;
  expect(workspaceSchema.parse(w).settings.motion).toBe("moderate");
  expect(motionProfiles.elegant.page).toBeGreaterThan(
    motionProfiles.moderate.page,
  );
  expect(motionProfiles.moderate.page).toBeGreaterThan(
    motionProfiles.rapid.page,
  );
  for (const p of ["elegant", "moderate", "rapid"] as const) {
    applyMotion(p);
    expect(document.documentElement.dataset.motion).toBe(p);
    expect(
      document.documentElement.style.getPropertyValue("--motion-cycle"),
    ).toBe(`${motionProfiles[p].cycle}ms`);
    expect(motionProfiles[p].page).toBeLessThanOrEqual(300);
  }
});
test("rapid and system reduced motion avoid smooth chat scrolling", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  applyMotion("elegant");
  expect(chatScrollBehavior()).toBe("smooth");
  applyMotion("rapid");
  expect(chatScrollBehavior()).toBe("auto");
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  applyMotion("elegant");
  expect(chatScrollBehavior()).toBe("auto");
  vi.unstubAllGlobals();
});
