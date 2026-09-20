import { readFile, writeFile } from "node:fs/promises";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

// Ship both bundles with the Python package; no Node runtime or CDN is needed.
await build({
  entryPoints: ["main.tsx"],
  outfile: "../src/click_detector/static/app.js",
  bundle: true,
  minify: true,
  jsx: "automatic",
  target: ["es2022"],
  define: { "process.env.NODE_ENV": '"production"' },
  legalComments: "inline",
});
const css = await postcss([tailwind({ optimize: { minify: true } })]).process(
  await readFile("styles/app.css", "utf8"),
  { from: "styles/app.css", to: "../src/click_detector/static/style.css" },
);
await writeFile("../src/click_detector/static/style.css", css.css);
