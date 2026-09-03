/**
 * Conjunto de referência do tema (golden set, briefing-e-rubricas.md
 * seção 6; etapa 10, decisão 7 do `PROXIMO.md`): compara a nota por pilar
 * que `avaliarTema` dá com a nota que o Gustavo daria. Cada caso já traz a
 * evidência e o perfil fixos (não toca banco nem cliente real), para medir
 * só o julgamento do modelo diante do mesmo material. Meta do plano:
 * diferença média por pilar abaixo de 1,5.
 *
 * O arquivo real, com casos avaliados de verdade pelo Gustavo, fica fora do
 * repositório público (`avaliacoes/README.md` explica o formato e o
 * porquê). `GOLDEN_SET_DIR` aponta para a pasta que tem `temas.json`; sem
 * o arquivo real lá, roda com `avaliacoes/temas.exemplo.json` e avisa que é
 * exemplo.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import { gerarEstruturado } from "../src/ia/cliente";
import * as avaliarTemaIA from "../src/ia/prompts/avaliarTema";

const PILARES = ["viralizar", "gerarCliente", "encaixe", "novidade", "facilidade"] as const;

const casoSchema = z.object({
  tema: z.string(),
  perfilCompilado: z.string(),
  modeloNicho: z.string(),
  persona: z.enum(["negocio", "criador"]),
  evidencias: z.array(z.object({ id: z.number(), assunto: z.string(), foraDaCurva: z.number() })),
  notaEsperada: z.object({
    viralizar: z.number().min(0).max(10),
    gerarCliente: z.number().min(0).max(10),
    encaixe: z.number().min(0).max(10),
    novidade: z.number().min(0).max(10),
    facilidade: z.number().min(0).max(10),
  }),
  pontoPrincipal: z.string(),
});
const conjuntoSchema = z.array(casoSchema);

function caminhoDoConjunto(): { caminho: string; ehExemplo: boolean } {
  const dir = process.env.GOLDEN_SET_DIR ?? "../avaliacoes-privadas";
  const caminhoReal = path.resolve(process.cwd(), dir, "temas.json");
  if (existsSync(caminhoReal)) {
    return { caminho: caminhoReal, ehExemplo: false };
  }
  return {
    caminho: path.resolve(process.cwd(), "avaliacoes/temas.exemplo.json"),
    ehExemplo: true,
  };
}

async function main() {
  const { caminho, ehExemplo } = caminhoDoConjunto();
  const conjunto = conjuntoSchema.parse(JSON.parse(readFileSync(caminho, "utf8")));

  console.log(`conjunto: ${caminho}${ehExemplo ? " (exemplo, nao e o golden set real)" : ""}`);
  console.log(`${conjunto.length} caso(s)\n`);

  let somaDiferencas = 0;
  let comparacoes = 0;

  for (const caso of conjunto) {
    const resultado = await gerarEstruturado({
      tarefa: "avaliarTema",
      nivel: avaliarTemaIA.nivel,
      effort: avaliarTemaIA.esforco,
      schema: avaliarTemaIA.schema,
      sistemaEstavel: avaliarTemaIA.montarSistemaEstavel({
        perfilCompilado: caso.perfilCompilado,
        modeloNicho: caso.modeloNicho,
        persona: caso.persona,
      }),
      entrada: avaliarTemaIA.montarEntrada({ tema: caso.tema, evidencias: caso.evidencias }),
    });

    console.log(`"${caso.tema}" (${caso.pontoPrincipal})`);
    for (const pilar of PILARES) {
      const notaIA = resultado.dados.pilares[pilar].nota;
      const notaEsperada = caso.notaEsperada[pilar];
      const diferenca = Math.abs(notaIA - notaEsperada);
      somaDiferencas += diferenca;
      comparacoes += 1;
      console.log(`  ${pilar}: IA deu ${notaIA}, esperado ${notaEsperada} (diferenca ${diferenca.toFixed(1)})`);
    }
    console.log();
  }

  const diferencaMedia = comparacoes > 0 ? somaDiferencas / comparacoes : 0;
  console.log(`diferenca media por pilar: ${diferencaMedia.toFixed(2)}`);
  if (diferencaMedia >= 1.5) {
    console.log("acima da meta de 1,5 (PROXIMO.md, decisao 7 da etapa 10).");
  }
}

main().catch((erro: unknown) => {
  console.error(erro);
  process.exitCode = 1;
});
