/**
 * Vite plugin to import HTML files as strings
 * Allows importing .html files directly as JavaScript strings
 */

import type { Plugin } from "vite";
import * as fs from "fs";

export function htmlPlugin(): Plugin {
    return {
        name: "html",
        resolveId(id) {
            if (id.endsWith(".html")) {
                return id;
            }
        },
        load(id) {
            if (id.endsWith(".html")) {
                const html = fs.readFileSync(id, "utf-8");
                return `export default ${JSON.stringify(html)};`;
            }
        },
    };
}
