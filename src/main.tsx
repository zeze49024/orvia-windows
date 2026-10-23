import "./styles.css";
import "./workspace.css";
import "./application.css";
import "./themes.css";
import "./beta6.css";
import "./beta8.css";
import "./rc1.css";
import "./rc2.css";
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { restoreThemeHint } from "./core/themes";
restoreThemeHint();
const root = createRoot(document.getElementById("root")!);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
if (import.meta.hot) import.meta.hot.dispose(() => root.unmount());
