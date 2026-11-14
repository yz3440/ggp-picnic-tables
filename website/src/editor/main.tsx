import { createRoot } from "react-dom/client";
import { MantineProvider, createTheme } from "@mantine/core";
import "@mantine/core/styles.css";
import App from "./App";

document.documentElement.style.margin = "0";
document.documentElement.style.padding = "0";
document.body.style.margin = "0";
document.body.style.padding = "0";
document.body.style.overflow = "hidden";

const theme = createTheme({
  primaryColor: "blue",
  fontFamily: "'SF Mono', 'Fira Code', 'JetBrains Mono', monospace",
  fontFamilyMonospace: "'SF Mono', 'Fira Code', 'JetBrains Mono', monospace",
});

// No StrictMode: its double mount starts two deck.gl instances on one canvas,
// and the second sometimes never draws the 3D tiles.
createRoot(document.getElementById("root")!).render(
  <MantineProvider theme={theme} defaultColorScheme="dark">
    <App />
  </MantineProvider>
);
