/**
 * Conjunto de referencia do briefing (golden set, briefing-e-rubricas.md
 * secao 8; plano de execucao, etapa 5): compara a nota que avaliarResposta
 * da com a nota que o Gustavo daria, e imprime a diferenca media. Meta do
 * plano: diferenca media abaixo de 1,0.
 *
 * O arquivo real, com respostas de verdade do primeiro cliente de teste, fica
 * fora do repositorio publico (avaliacoes/README.md explica o formato e o porque).
 * GOLDEN_SET_DIR aponta para a pasta que tem briefing.json; sem o arquivo
 * real la, roda com avaliacoes/briefing.exemplo.json e avisa que e exemplo.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import { perguntaPorId } from "../src/config/briefing";
import { gerarEstruturado } from "../src/ia/cliente";
import * as avaliarRespostaIA from "../src/ia/prompts/avaliarResposta";

const casoSchema = z.object({
  perguntaId: z.string(),
  resposta: z.string(),
  notaEsperada: z.number().min(0).max(10),
  pontoPrincipal: z.string(),
});
const conjuntoSchema = z.array(casoSchema);

function caminhoDoConjunto(): { caminho: string; ehExemplo: boolean } {
  const dir = process.env.GOLDEN_SET_DIR ?? "../avaliacoes-privadas";
  const caminhoReal = path.resolve(process.cwd(), dir, "briefing.json");
  if (existsSync(caminhoReal)) {
    return { caminho: caminhoReal, ehExemplo: false };
  }
  return {
    caminho: path.resolve(process.cwd(), "avaliacoes/briefing.exemplo.json"),
    ehExemplo: true,
  };
}

export type ResultadoAvaliarBriefing = {
  conjunto: string;
  ehExemplo: boolean;
  casos: number;
  diferencaMedia: number;
  acimaDaMeta: boolean;
};

const META_DIFERENCA = 1.0;

/**
 * Roda o conjunto inteiro e imprime cada caso (npm run avaliar:briefing) e
 * devolve o resumo numerico, para `avaliar-tudo.ts` gravar num JSON so
 * (etapa 18, decisao 4 do `PROXIMO.md`) sem precisar reler o stdout.
 */
export async function avaliarBriefing(): Promise<ResultadoAvaliarBriefing> {
  const { caminho, ehExemplo } = caminhoDoConjunto();
  const conjunto = conjuntoSchema.parse(JSON.parse(readFileSync(caminho, "utf8")));

  console.log(`conjunto: ${caminho}${ehExemplo ? " (exemplo, nao e o golden set real)" : ""}`);
  console.log(`${conjunto.length} caso(s)\n`);

  let somaDiferencas = 0;
  let casosAvaliados = 0;

  for (const caso of conjunto) {
    const pergunta = perguntaPorId(caso.perguntaId);
    if (!pergunta) {
      console.log(`${caso.perguntaId}: pergunta desconhecida, pulando`);
      continue;
    }

    const resultado = await gerarEstruturado({
      tarefa: "avaliarResposta",
      nivel: avaliarRespostaIA.nivel,
      effort: avaliarRespostaIA.esforco,
      schema: avaliarRespostaIA.schema,
      sistemaEstavel: avaliarRespostaIA.montarSistemaEstavel(),
      entrada: avaliarRespostaIA.montarEntrada({
        pergunta: pergunta.enunciado,
        oQueAIAProcura: pergunta.oQueAIAProcura,
        resposta: caso.resposta,
      }),
    });

    const diferenca = Math.abs(resultado.dados.nota - caso.notaEsperada);
    somaDiferencas += diferenca;
    casosAvaliados += 1;

    console.log(
      `${caso.perguntaId}: IA deu ${resultado.dados.nota}, esperado ${caso.notaEsperada} ` +
        `(diferenca ${diferenca.toFixed(1)}) - ${caso.pontoPrincipal}`,
    );
  }

  const diferencaMedia = casosAvaliados > 0 ? somaDiferencas / casosAvaliados : 0;
  const acimaDaMeta = diferencaMedia >= META_DIFERENCA;
  console.log(`\ndiferenca media: ${diferencaMedia.toFixed(2)}`);
  if (acimaDaMeta) {
    console.log("acima da meta de 1,0 (plano de execucao, etapa 5).");
  }

  return { conjunto: caminho, ehExemplo, casos: conjunto.length, diferencaMedia, acimaDaMeta };
}

/**
 * So dispara ao rodar `tsx scripts/avaliar-briefing.ts` direto (`npm run
 * avaliar:briefing`), nunca quando `avaliar-tudo.ts` importa a funcao: os
 * dois rodam no mesmo processo CommonJS do tsx, entao `require.main` e o
 * script que foi chamado na linha de comando, nao este arquivo, quando e
 * so um import.
 */
if (require.main === module) {
  avaliarBriefing().catch((erro: unknown) => {
    console.error(erro);
    process.exitCode = 1;
  });
}
