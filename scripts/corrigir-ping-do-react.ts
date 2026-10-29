/**
 * Ponto de entrada de linha de comando (roda sozinho antes de `npm run build` e de `npm run dev`, pelos `prebuild` e `predev` do `package.json`).
 * As regras estão em corrigir-ping-do-react-regras.ts, sem process.exit, para dar para testar.
 */
import path from "node:path";

import { corrigirArquivos } from "./corrigir-ping-do-react-regras";

const resultados = corrigirArquivos(process.cwd());
const nomes = (estado: string) => resultados.filter((r) => r.estado === estado).map((r) => path.relative(process.cwd(), r.arquivo));

if (resultados.length === 0) {
  console.warn("corrigir-ping-do-react: nenhum arquivo do React dentro do Next foi achado (node_modules/next/dist/compiled/react-dom). Nada a corrigir.");
} else if (nomes("nao-encontrada").length === resultados.length) {
  console.warn(
    "corrigir-ping-do-react: o trecho com defeito não existe mais nos arquivos do React do Next (versão nova do Next, com o React já corrigido?). Conferir e, se for o caso, apagar scripts/corrigir-ping-do-react*, o teste e os prebuild/predev do package.json.",
  );
} else {
  console.log(`corrigir-ping-do-react: ${nomes("aplicada").length} arquivo(s) corrigido(s), ${nomes("ja-aplicada").length} já estavam corrigidos.`);
}
