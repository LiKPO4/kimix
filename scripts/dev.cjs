// Clear Electron env vars set by parent IDE (Trae/Electron-based editor)
// so that the child Electron app runs in GUI mode, not Node mode.
delete process.env.ELECTRON_RUN_AS_NODE;
delete process.env.ELECTRON_FORCE_IS_PACKAGED;

const { spawn } = require("child_process");
const path = require("path");

// Use node directly to run electron-vite to avoid shell env issues on Windows
const electronVite = path.join(__dirname, "..", "node_modules", "electron-vite", "bin", "electron-vite.js");

const child = spawn("node", [electronVite, "dev"], {
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
