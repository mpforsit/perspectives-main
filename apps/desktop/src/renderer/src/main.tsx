import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { TrpcProvider } from "./trpc/provider";
import "./styles/globals.css";

const container = document.getElementById("root");
if (container === null) {
  throw new Error("Missing #root container in index.html");
}

createRoot(container).render(
  <StrictMode>
    <TrpcProvider>
      <App />
    </TrpcProvider>
  </StrictMode>,
);
