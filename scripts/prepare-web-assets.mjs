import { cpSync, existsSync, mkdirSync, rmSync, copyFileSync } from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const outputDir = path.join(rootDir, "www");

const fileEntries = [
  "index.html",
  "styles.css",
  "script.js",
  "manifest.webmanifest",
  "sw.js",
  ".nojekyll",
];

const directoryEntries = [
  "assets",
];

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });

for (const entry of fileEntries) {
  copyFileSync(path.join(rootDir, entry), path.join(outputDir, entry));
}

for (const entry of directoryEntries) {
  const sourceDir = path.join(rootDir, entry);
  const targetDir = path.join(outputDir, entry);
  if (existsSync(sourceDir)) {
    cpSync(sourceDir, targetDir, { recursive: true });
  }
}

console.log(`Prepared web assets in ${outputDir}`);
