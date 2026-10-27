import type { ReactNode } from "react";

/** A settings section with one clear heading and a shared control rhythm. */
export function SettingsGroup({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="settings-group">
      <header className="settings-group-heading">
        <h3>{title}</h3>
        {description && <p>{description}</p>}
      </header>
      <div className="settings-group-body">{children}</div>
    </section>
  );
}
