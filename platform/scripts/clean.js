// Removes platform/dist before a fresh build. Plain Node, no deps.
"use strict";
const fs = require("fs");
const path = require("path");

const distDir = path.join(__dirname, "..", "dist");
fs.rmSync(distDir, { recursive: true, force: true });
