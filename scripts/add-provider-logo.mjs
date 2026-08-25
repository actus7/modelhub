#!/usr/bin/env node
// Copia o logo de um provedor de @lobehub/icons-static-svg (devDependency) para
// public/providers/<providerId>.svg. Processo para adicionar o logo de um novo
// provedor (issue #249):
//   1. Achar o slug em node_modules/@lobehub/icons-static-svg/icons (nome da
//      marca, ex.: "openai", "deepseek").
//   2. node scripts/add-provider-logo.mjs <providerId> <slug>
//   3. Adicionar <providerId> ao Set em components/dashboard/routing/provider-logos.ts
//
// Prioriza a variante colorida ("<slug>-color.svg"); cai para a monocromática
// ("<slug>.svg", usa fill="currentColor") quando não há versão colorida.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const [providerId, slug] = process.argv.slice(2);
if (!providerId || !slug) {
  console.error("Uso: node scripts/add-provider-logo.mjs <providerId> <slug>");
  process.exit(1);
}

const iconsDir = "node_modules/@lobehub/icons-static-svg/icons";
const source = ["-color.svg", ".svg"]
  .map((suffix) => join(iconsDir, `${slug}${suffix}`))
  .find(existsSync);

if (!source) {
  console.error(`Nenhum icone encontrado para "${slug}" em @lobehub/icons-static-svg`);
  process.exit(1);
}

mkdirSync("public/providers", { recursive: true });
copyFileSync(source, join("public/providers", `${providerId}.svg`));
console.log(`OK: ${source} -> public/providers/${providerId}.svg`);
