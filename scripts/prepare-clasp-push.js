const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const src = path.join(root, "apps_script_collection_data.gs");
const outDir = path.join(root, "apps-script");
const destGs = path.join(outDir, "Code.gs");
const destManifest = path.join(outDir, "appsscript.json");
const srcManifest = path.join(root, "appsscript.json");

if (!fs.existsSync(src)) {
  console.error("Missing apps_script_collection_data.gs at project root.");
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(src, destGs);
if (fs.existsSync(srcManifest)) {
  fs.copyFileSync(srcManifest, destManifest);
}

console.log("Prepared apps-script/Code.gs for clasp push.");
