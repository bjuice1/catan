// Bundles src/main.jsx (React included) and inlines it into a single index.html.
// No CDN, no external assets except the Google font.
import * as esbuild from "esbuild";
import { writeFileSync } from "fs";

const result = await esbuild.build({
  entryPoints: ["src/main.jsx"],
  bundle: true,
  minify: true,
  format: "iife",
  loader: { ".jsx": "jsx" },
  define: { "process.env.NODE_ENV": '"production"', __APP_V__: String(Date.now()) },
  write: false,
  outfile: "bundle.js",
});

let js = result.outputFiles[0].text;
// An unescaped </script inside the bundle would close the tag early.
js = js.replace(/<\/script/gi, "<\\/script");

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Harbor">
<meta name="theme-color" content="#061419">
<meta name="robots" content="noindex, nofollow">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta property="og:title" content="Harbor">
<meta property="og:description" content="A settlers game for friends — tap to take your seat.">
<meta property="og:image" content="/icon-512.png">
<title>Harbor</title>
<style>
  html,body{margin:0;padding:0;background:#061419;-webkit-text-size-adjust:100%;}
  #root{min-height:100vh;max-width:560px;margin:0 auto;
    padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);}
  *{-webkit-tap-highlight-color:transparent;}
  input,textarea{font-size:16px;}
</style>
</head>
<body>
<div id="root"></div>
<script>
${js}
</script>
<script>
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(function () {});
</script>
</body>
</html>
`;

writeFileSync("index.html", html);
// bundle.js is gitignored; it exists so the smoke test can eval the exact
// code that shipped without having to parse it back out of the HTML.
writeFileSync("bundle.js", js);
console.log(`index.html written — ${Math.round(html.length / 1024)} KB`);
