/**
 * Conjunto de referência da extração do vídeo (golden set, E44 PR 1): para cada vídeo do conjunto (título, legenda, transcrição e o formato que um humano
 * classificaria), chama a tarefa `extrairVideo` e confere se o `formatoCatalogo` que o modelo devolveu bate com o esperado. É o ensaio do prompt novo (versão 1.11.0)
 * antes de reclassificar o banco: três casos por formato que o banco de exemplo cobre (passo a passo, antes e depois, lista, erro comum, humor e meme, respondendo
 * pergunta). O arquivo real fica fora do repositório (`avaliacoes/README.md`): `GOLDEN_SET_DIR` aponta para a pasta que tem `extrair.json`; sem ele roda com
 * `avaliacoes/extrair.exemplo.json` e avisa. Em `AI_PROVIDER=mock` a classificação sai por palavra do título (ver `ia/mock.ts`), só para exercitar o caminho.
 *
 *   npm run avaliar:extrair
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import { FICHAS_EM_ORDEM } from "../src/config/fichas";
import { FORMATOS_DO_VIDEO } from "../src/config/formatos";
import { gerarEstruturado } from "../src/ia/cliente";
import * as extrairVideoIA from "../src/ia/prompts/extrairVideo";
import { calcularCustoUsd } from "../src/ia/registro";

const casoSchema = z.object({
  formatoEsperado: z.enum(FORMATOS_DO_VIDEO),
  /** E49 PR 2: para que o vídeo parece feito, pelas cinco fichas; ausente (conjunto antigo) não entra na conta. */
  fichaEsperada: z.enum(FICHAS_EM_ORDEM as [(typeof FICHAS_EM_ORDEM)[number], ...(typeof FICHAS_EM_ORDEM)[number][]]).optional(),
  titulo: z.string(),
  descricao: z.string().nullable().default(null),
  handle: z.string().nullable().default(null),
  transcricao: z.string(),
});
const conjuntoSchema = z.array(casoSchema);

function caminhoDoConjunto(): { caminho: string; ehExemplo: boolean } {
  const dir = process.env.GOLDEN_SET_DIR ?? "../avaliacoes-privadas";
  const caminhoReal = path.resolve(process.cwd(), dir, "extrair.json");
  if (existsSync(caminhoReal)) return { caminho: caminhoReal, ehExemplo: false };
  return { caminho: path.resolve(process.cwd(), "avaliacoes/extrair.exemplo.json"), ehExemplo: true };
}

export type ResultadoAvaliarExtrair = {
  conjunto: string;
  ehExemplo: boolean;
  casos: number;
  acertos: number;
  /** E49 PR 2: quantos casos com ficha esperada, e em quantos a ficha devolvida bateu (o julgamento fino é humano; isto só aponta o que desviou). */
  casosComFicha: number;
  acertosDeFicha: number;
  /** Quantos vieram com "outro" ou nulos (a ficha ficou sem o formato). */
  comoOutro: number;
  /** Os casos que erraram: o título, o esperado e o devolvido, para leitura humana. */
  erros: { titulo: string; esperado: string; devolvido: string }[];
  custoTotalUsd: number;
};

export async function avaliarExtrair(): Promise<ResultadoAvaliarExtrair> {
  const { caminho, ehExemplo } = caminhoDoConjunto();
  const conjunto = conjuntoSchema.parse(JSON.parse(readFileSync(caminho, "utf8")));
  console.log(`conjunto: ${caminho}${ehExemplo ? " (exemplo, nao e o golden set real)" : ""}`);
  console.log(`${conjunto.length} caso(s)\n`);

  let acertos = 0;
  let casosComFicha = 0;
  let acertosDeFicha = 0;
  let comoOutro = 0;
  let custoTotalUsd = 0;
  const erros: ResultadoAvaliarExtrair["erros"] = [];

  for (const caso of conjunto) {
    const resultado = await gerarEstruturado({
      tarefa: "extrairVideo",
      nivel: extrairVideoIA.nivel,
      effort: extrairVideoIA.esforco,
      schema: extrairVideoIA.schema,
      sistemaEstavel: extrairVideoIA.montarSistemaEstavel(),
      entrada: extrairVideoIA.montarEntrada({
        titulo: caso.titulo,
        descricao: caso.descricao,
        handle: caso.handle,
        transcricao: caso.transcricao,
        nomeNicho: "limpeza e organização da casa",
        termosNicho: ["limpeza", "sofá", "mancha", "faxina"],
      }),
    });
    custoTotalUsd += calcularCustoUsd(extrairVideoIA.nivel, resultado);
    const devolvido = resultado.dados.formatoCatalogo ?? "(nulo)";
    if (devolvido === "outro" || devolvido === "(nulo)") comoOutro += 1;
    const bateu = devolvido === caso.formatoEsperado;
    if (bateu) acertos += 1;
    else erros.push({ titulo: caso.titulo, esperado: caso.formatoEsperado, devolvido });
    if (caso.fichaEsperada) {
      casosComFicha += 1;
      const ficha = resultado.dados.fichaCatalogo ?? "(nulo)";
      if (ficha === caso.fichaEsperada) acertosDeFicha += 1;
      else console.log(`     ficha: esperada ${caso.fichaEsperada}, devolvida ${ficha}`);
    }
    console.log(`${bateu ? "ok  " : "erro"} ${caso.formatoEsperado.padEnd(22)} ${devolvido.padEnd(22)} ${caso.titulo}`);
  }

  console.log(`\nacertos: ${acertos}/${conjunto.length}, como "outro": ${comoOutro}, fichas: ${acertosDeFicha}/${casosComFicha}, custo: US$ ${custoTotalUsd.toFixed(4)}`);
  return { conjunto: caminho, ehExemplo, casos: conjunto.length, acertos, casosComFicha, acertosDeFicha, comoOutro, erros, custoTotalUsd };
}

if (require.main === module) {
  avaliarExtrair()
    .then(() => process.exit(0))
    .catch((erro: unknown) => {
      console.error(erro);
      process.exitCode = 1;
    });
}
