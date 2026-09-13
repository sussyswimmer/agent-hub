import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { Scriptorium } from "./scriptorium/Scriptorium";
import "./theme/fonts.css";
import "./theme/tokens.css";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");

createRoot(root).render(
  <StrictMode>
    <Scriptorium />
  </StrictMode>,
);
