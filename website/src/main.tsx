import { createRoot } from "react-dom/client";
import App from "./App";
import "./app.css";

// No StrictMode: its double mount starts two deck.gl instances on one canvas,
// and the second sometimes never draws the 3D tiles.
createRoot(document.getElementById("root")!).render(<App />);
