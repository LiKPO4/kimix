/**
 * Single source of truth for the application version.
 *
 * Reads from `package.json` at build time so version strings in UI and backup
 * exports never drift from the package manifest.
 */
import packageJson from "../../package.json";

export const APP_VERSION = packageJson.version;
