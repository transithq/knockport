import React from "react";
import ReactDOM from "react-dom/client";
import { AppShell } from "@knockport/ui";
import "@knockport/ui/styles";
import "./styles.css";

const root = document.getElementById("root")!;

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <AppShell />
  </React.StrictMode>,
);
