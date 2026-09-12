import { createRoot } from "react-dom/client";
import "./globals.css";
import Application from "./application";
import { initializeLanguage } from "./i18n";
initializeLanguage();
createRoot(document.getElementById("root")!).render(<Application />);
