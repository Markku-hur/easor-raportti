#!/usr/bin/env node
/**
 * Adds this server as "easor" to the Claude desktop app's claude_desktop_config.json
 * and, if the claude command is installed, to Claude Code. Run with: npm run setup:claude
 *
 * Keeps every other setting, and writes a backup (.bak-easor) next to the config first.
 */

import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const NAME = "easor";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const index = join(root, "dist", "index.js");
const node = process.execPath;

if (!existsSync(index)) {
  console.error(`Tiedostoa ${index} ei löydy. Aja ensin: npm ci && npm run build`);
  process.exit(1);
}

/** Every place the desktop app keeps its config, newest layout first. */
function candidateDirs() {
  const home = homedir();
  if (process.platform === "darwin") return [join(home, "Library", "Application Support", "Claude")];
  if (process.platform !== "win32") return [join(home, ".config", "Claude")];
  const local = process.env.LOCALAPPDATA ?? join(home, "AppData", "Local");
  const roaming = process.env.APPDATA ?? join(home, "AppData", "Roaming");
  const sub = (dir, prefix) => (existsSync(dir) ? readdirSync(dir).filter((n) => n.startsWith(prefix)).map((n) => join(dir, n)) : []);
  return [
    ...sub(join(local, "Claude-Data"), "claude_"),
    ...sub(join(local, "Packages"), "Claude_").map((p) => join(p, "LocalCache", "Roaming", "Claude")),
    join(roaming, "Claude"),
  ];
}

const dirs = candidateDirs().filter((d) => existsSync(d));
const existing = dirs.map((d) => join(d, "claude_desktop_config.json")).filter((f) => existsSync(f));
const targets = existing.length ? existing : dirs.slice(0, 1).map((d) => join(d, "claude_desktop_config.json"));

if (!targets.length) {
  console.error("Claude-työpöytäsovelluksen kansiota ei löytynyt. Asenna ja avaa sovellus kerran, ja aja tämä sitten uudelleen.");
} else {
  for (const file of targets) {
    let config = {};
    if (existsSync(file)) {
      const text = readFileSync(file, "utf8").replace(/^﻿/, "");
      try {
        config = text.trim() ? JSON.parse(text) : {};
      } catch {
        console.error(`${file} ei ole kelvollista JSONia, joten sitä ei muutettu. Korjaa tai lisää palvelin käsin README:n ohjeella.`);
        continue;
      }
      copyFileSync(file, `${file}.bak-easor`);
    }
    config.mcpServers = { ...(config.mcpServers ?? {}), [NAME]: { command: node, args: [index] } };
    writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
    console.log(`Lisätty työpöytäsovellukseen: ${file}`);
  }
}

// Claude Code, which publishes the report page (README step 3).
const which = spawnSync(process.platform === "win32" ? "where" : "which", ["claude"], { encoding: "utf8" });
if (which.status === 0) {
  const claude = which.stdout.split(/\r?\n/).find(Boolean);
  spawnSync(claude, ["mcp", "remove", NAME, "--scope", "user"], { stdio: "ignore" });
  const added = spawnSync(claude, ["mcp", "add", NAME, "--scope", "user", "--", node, index], { stdio: "inherit" });
  if (added.status !== 0) console.error("Claude Codeen lisääminen epäonnistui. Katso README:n kohta 3.");
} else {
  console.log("claude-komentoa ei löytynyt, joten Claude Codeen ei lisätty mitään. Katso README:n kohta 3.");
}

console.log("\nValmis. Lopeta Claude-sovellus kokonaan (Windowsissa ilmaisinalueen kuvakkeesta: Quit) ja avaa se uudelleen.");
