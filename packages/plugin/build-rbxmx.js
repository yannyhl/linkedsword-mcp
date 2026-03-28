#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const SRC_PATH = path.join(__dirname, "src", "plugin.luau");
const OUT_PATH = path.join(__dirname, "Linkedsword.rbxmx");

// Read the Luau source
let source;
try {
  source = fs.readFileSync(SRC_PATH, "utf-8");
} catch (err) {
  console.error(`Failed to read Luau source at ${SRC_PATH}: ${err.message}`);
  process.exit(1);
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
			<string name="Name">Linkedsword</string>
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

console.log(`Built ${OUT_PATH}`);
