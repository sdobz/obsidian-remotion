const esbuild = require("esbuild");
const fs = require("fs");
const isProduction = process.env.NODE_ENV === "production";

// HTML plugin for esbuild
const htmlPlugin = {
  name: "html",
  setup(build) {
    build.onLoad({ filter: /\.html$/ }, (args) => {
      const html = fs.readFileSync(args.path, "utf-8");
      return {
        contents: `export default ${JSON.stringify(html)};`,
        loader: "js",
      };
    });
  },
};

const config = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  loader: {
    ".json": "json", // Enable JSON imports
  },
  plugins: [htmlPlugin],
  external: [
    "obsidian",
    "electron",
    "path",
    "fs",
    "esbuild",
    "codemirror",
    "@codemirror/autocomplete",
    "@codemirror/closebrackets",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/comment",
    "@codemirror/fold",
    "@codemirror/gutter",
    "@codemirror/highlight",
    "@codemirror/history",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/matchbrackets",
    "@codemirror/panel",
    "@codemirror/rangeset",
    "@codemirror/rectangular-selection",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/stream-parser",
    "@codemirror/text",
    "@codemirror/tooltip",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    "@lezer/markdown",
    "@lezer/tree",
  ],
  outfile: "main.js",
  sourcemap: isProduction ? false : "inline",
  minify: isProduction,
};

if (process.argv.includes("--watch")) {
  esbuild.context(config).then((ctx) => ctx.watch());
} else {
  esbuild.build(config);
}
