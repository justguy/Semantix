import * as React from "react";
import { createRoot } from "react-dom/client";

window.React = React;

await import("./control-surface/ui.jsx");
await import("./control-surface/app.jsx");

const App = window.SemantixApp;

if (typeof App !== "function") {
  throw new Error("SemantixApp was not registered by the bundled control-surface modules.");
}

createRoot(document.getElementById("root")).render(<App />);
