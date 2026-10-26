export type MotionPreference = "elegant" | "moderate" | "rapid";
export const motionProfiles = {
  elegant: { control: 220, page: 300, panel: 240, cycle: 1500, distance: 6 },
  moderate: { control: 140, page: 180, panel: 160, cycle: 1050, distance: 3 },
  rapid: { control: 55, page: 70, panel: 65, cycle: 550, distance: 1 },
} as const;
export function reducedMotion() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
export function applyMotion(preference: MotionPreference) {
  const root = document.documentElement,
    profile = motionProfiles[preference];
  root.dataset.motion = preference;
  for (const key of ["control", "page", "panel", "cycle"] as const)
    root.style.setProperty(`--motion-${key}`, `${profile[key]}ms`);
  root.style.setProperty("--motion-distance", `${profile.distance}px`);
}
export function motionPreference(): MotionPreference {
  const v = document.documentElement.dataset.motion;
  return v === "elegant" || v === "rapid" ? v : "moderate";
}
export function chatScrollBehavior(): ScrollBehavior {
  return reducedMotion() || motionPreference() === "rapid" ? "auto" : "smooth";
}
