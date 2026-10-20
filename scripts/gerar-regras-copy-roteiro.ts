/**
 * E50 parte 2, PR 1: gera `src/ia/prompts/regras-copy-roteiro.ts` a partir da seção 11 de
 * `estrategia/briefing-e-rubricas.md` (as 53 regras: 25 R-COPY, 19 R-ROTEIRO, 9 R-CONF). A tabela
 * do documento é a fonte; o arquivo gerado é commitado porque a CI só tem o checkout de
 * `plataforma/` e o prompt precisa das regras lá. O texto é copiado, nunca reescrito: trocar uma
 * regra é trocar o documento e rodar `npm run gerar:regras-copy-roteiro`.
 *
 * A lógica pura (`lerTabelaDaSecao11`, `montarArquivoGerado`) fica em `gerar-regras-copy-roteiro-lib.ts`,
 * sem acesso a disco, para dar para testar.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { lerTabelaDaSecao11, montarArquivoGerado } from "./gerar-regras-copy-roteiro-lib";

const DOC = path.resolve(process.cwd(), "../estrategia/briefing-e-rubricas.md");
const SAIDA = path.resolve(process.cwd(), "src/ia/prompts/regras-copy-roteiro.ts");

if (!existsSync(DOC)) {
  console.error(`gerar-regras-copy-roteiro: ${DOC} nao encontrado (precisa dos dois repositorios lado a lado).`);
  process.exit(1);
}

const regras = lerTabelaDaSecao11(readFileSync(DOC, "utf8"));
writeFileSync(SAIDA, montarArquivoGerado(regras), "utf8");
console.log(`gerar-regras-copy-roteiro: ${regras.length} regras escritas em ${path.relative(process.cwd(), SAIDA)}.`);
