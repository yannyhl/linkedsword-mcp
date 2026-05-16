#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const isInspector = args.includes("--inspector");

const SRC_PATH = path.join(__dirname, "src", "plugin.luau");
const OUT_NAME = isInspector ? "LinkedswordInspector.rbxmx" : "Linkedsword.rbxmx";
const SCRIPT_NAME = isInspector ? "LinkedswordInspector" : "Linkedsword";
const OUT_PATH = path.join(__dirname, OUT_NAME);

let source;
try {
  source = fs.readFileSync(SRC_PATH, "utf-8");
} catch (err) {
  console.error(`Failed to read Luau source at ${SRC_PATH}: ${err.message}`);
  process.exit(1);
}

// Inspector variant: flip the INSPECTOR_ONLY flag from false → true so the
// dispatch guard physically blocks every write tool. Same source file, single
// targeted substitution — keeps the two builds in lockstep.
if (isInspector) {
  const before = source;
  source = source.replace(
    /local\s+INSPECTOR_ONLY\s*=\s*false/,
    "local INSPECTOR_ONLY = true",
  );
  if (source === before) {
    console.error("--inspector: expected 'local INSPECTOR_ONLY = false' marker in plugin.luau; aborting.");
    process.exit(1);
  }
}

// Handle ]]> inside CDATA by splitting into multiple CDATA sections.
// "]]>" inside CDATA must be escaped as "]]]]><![CDATA[>" so the XML
// parser sees the literal text "]]>" when the sections are concatenated.
const escapedSource = source.replace(/\]\]>/g, "]]]]><![CDATA[>");

const rbxmx = `<roblox xmlns:xmime="http://www.w3.org/2005/05/xmlmime" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.roblox.com/roblox.xsd" version="4">
	<External>null</External>
	<External>nil</External>
	<Item class="Script" referent="RBX0">
		<Properties>
			<string name="Name">${SCRIPT_NAME}</string>
			<ProtectedString name="Source"><![CDATA[${escapedSource}]]></ProtectedString>
			<bool name="Disabled">false</bool>
			<Content name="LinkedSource"><null></null></Content>
			<token name="RunContext">0</token>
		</Properties>
	</Item>
</roblox>
`;

try {
  fs.writeFileSync(OUT_PATH, rbxmx, "utf-8");
} catch (err) {
  console.error(`Failed to write .rbxmx file: ${err.message}`);
  process.exit(1);
}

console.log(`Built ${OUT_PATH}${isInspector ? " (inspector variant — write tools disabled)" : ""}`);
