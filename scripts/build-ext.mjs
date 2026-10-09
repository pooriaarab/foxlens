// Builds extension/ into dist-ext/: esbuild bundles each script, and the
// other files are copied. It stops when the manifest version is not the
// package.json version, so AMO signs the version that npm publishes.
// With --e2e it builds dist-e2e/: the same extension plus the E2E harness
// page from e2e/harness/. The harness never ships in dist-ext/.
import { cpSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { build } from "esbuild";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const manifest = JSON.parse(readFileSync("extension/manifest.json", "utf8"));
if (manifest.version !== pkg.version) {
  console.error(`extension/manifest.json has version ${manifest.version}, but package.json has ${pkg.version}. Make them equal.`);
  process.exit(1);
}

const e2e = process.argv.includes("--e2e");
const out = e2e ? "dist-e2e" : "dist-ext";
const dirs = e2e ? ["extension", "e2e/harness"] : ["extension"];
rmSync(out, { recursive: true, force: true });
for (const dir of dirs) {
  const files = readdirSync(dir);
  await build({
    entryPoints: files.filter((f) => f.endsWith(".js")).map((f) => `${dir}/${f}`),
    outdir: out,
    bundle: true,
    format: "iife",
    target: "firefox153",
    resolveExtensions: [".ts", ".js"],
    logLevel: "warning",
  });
  for (const file of files.filter((f) => !f.endsWith(".js"))) cpSync(`${dir}/${file}`, `${out}/${file}`, { recursive: true });
}
console.log(`Built ${out}/ (version ${pkg.version}).`);
