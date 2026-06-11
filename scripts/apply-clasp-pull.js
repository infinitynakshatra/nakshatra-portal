const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const src = path.join(root, "apps-script", "Code.gs");
const dest = path.join(root, "apps_script_collection_data.gs");

if (!fs.existsSync(src)) {
  console.error("Missing apps-script/Code.gs — run clasp pull first.");
  process.exit(1);
}

fs.copyFileSync(src, dest);
console.log("Updated apps_script_collection_data.gs from Google.");
