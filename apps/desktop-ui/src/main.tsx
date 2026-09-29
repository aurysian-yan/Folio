import React from "react";
import ReactDOM from "react-dom/client";
import "./style.css";
import App from "./App";
import { previewCacheStats } from "./font-preview";
import { installPerformanceMetrics } from "./performance-metrics";

installPerformanceMetrics(previewCacheStats);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
