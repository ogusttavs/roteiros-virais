/**
 * Conjunto de referência da leitura da agenda (golden set, V9b, item 5,
 * `PROXIMO.md`): `lerAgenda` e `planejarDia` são tarefas baratas, sem
 * verificador (`src/ia/prompts/lerAgenda.ts`, `src/ia/prompts/planejarDia.ts`),
 * então este script não tem "reprovado": ele roda as duas tarefas com a
 * chave real, mostra o que saiu e soma o custo, para o Gustavo ler e decidir
 * se a leitura faz sentido. `diasSemData` conta dias cuja `referenciaDia` o
 * código não conseguiu resolver (`resolverDataRelativa`), o mesmo
 * comportamento de `servicos/plano.ts`, `lerAgendaDeTexto` (esses dias saem
 * silenciosamente do plano).
 *
 * `GOLDEN_SET_DIR` aponta para a pasta que tem `agendas.json`; sem o arquivo
 * real lá, roda com `avaliacoes/agendas.exemplo.json` e avisa que é exemplo.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import * as lerAgendaIA from "../src/ia/prompts/lerAgenda";
import * as planejarDiaIA from "../src/ia/prompts/planejarDia";
import { ErroDataRelativa, resolverDataRelativa } from "../src/lib/data-relativa";

import { custoDoResultado, gerarVarios } from "./golden-lote";

const casoSchema = z.object({
  local: z.string(),
  hoje: z.string(),
  texto: z.string(),
  perfilCompilado: z.string(),
  modeloNicho: z.string(),
});
const conjuntoSchema = z.array(casoSchema);

function caminhoDoConjunto(): { caminho: string; ehExemplo: boolean } {
  const dir = process.env.GOLDEN_SET_DIR ?? "../avaliacoes-privadas";
  const caminhoReal = path.resolve(process.cwd(), dir, "agendas.json");
  if (existsSync(caminhoReal)) {
    return { caminho: caminhoReal, ehExemplo: false };
  }
  return {
    caminho: path.resolve(process.cwd(), "avaliacoes/agendas.exemplo.json"),
    ehExemplo: true,
  };
}

export type ResultadoAvaliarAgendas = {
  conjunto: string;
  ehExemplo: boolean;
  casos: number;
  diasLidos: number;
  diasSemData: number;
  custoTotalUsd: number;
};

export async function avaliarAgendas(): Promise<ResultadoAvaliarAgendas> {
  const { caminho, ehExemplo } = caminhoDoConjunto();
  const conjunto = conjuntoSchema.parse(JSON.parse(readFileSync(caminho, "utf8")));
  let diasLidos = 0;
  let diasSemData = 0;
  let custoTotalUsd = 0;

  console.log(`conjunto: ${caminho}${ehExemplo ? " (exemplo, nao e o golden set real)" : ""}`);
  console.log(`${conjunto.length} caso(s)\n`);

  // O golden set pelo lote (`golden-lote.ts`): a leitura de todas as agendas num lote, o plano de todos os dias com data resolvida num segundo, e só então a leitura, caso a caso.
  const leituras = await gerarVarios(
    conjunto.map((caso) => ({
      tarefa: "lerAgenda" as const,
      nivel: lerAgendaIA.nivel,
      effort: lerAgendaIA.esforco,
      schema: lerAgendaIA.schema,
      sistemaEstavel: lerAgendaIA.montarSistemaEstavel(),
      entrada: lerAgendaIA.montarEntrada({ texto: caso.texto }),
    })),
    "agendas",
  );

  // Cada dia lido, com a data resolvida (ou o motivo de não ter resolvido); só os que resolveram pedem plano.
  type DiaLido = { indiceCaso: number; dia: (typeof leituras)[number]["dados"]["dias"][number]; dataResolvida: string | null; motivo: string | null };
  const diasPorCaso: DiaLido[][] = conjunto.map((caso, indiceCaso) =>
    leituras[indiceCaso].dados.dias.map((dia) => {
      try {
        return { indiceCaso, dia, dataResolvida: resolverDataRelativa(dia.referenciaDia, caso.hoje), motivo: null };
      } catch (erro) {
        if (erro instanceof ErroDataRelativa) return { indiceCaso, dia, dataResolvida: null, motivo: erro.message };
        throw erro;
      }
    }),
  );
  const diasComPlano = diasPorCaso.flat().filter((d) => d.dataResolvida !== null);
  const planos = await gerarVarios(
    diasComPlano.map((d) => ({
      tarefa: "planejarDia" as const,
      nivel: planejarDiaIA.nivel,
      effort: planejarDiaIA.esforco,
      schema: planejarDiaIA.schema,
      sistemaEstavel: planejarDiaIA.montarSistemaEstavel({
        perfilCompilado: conjunto[d.indiceCaso].perfilCompilado,
        modeloNicho: conjunto[d.indiceCaso].modeloNicho,
      }),
      entrada: planejarDiaIA.montarEntrada({ lugar: d.dia.lugar, compromissos: d.dia.compromissos }),
    })),
    "plano dos dias",
  );
  const planoDoDia = new Map<DiaLido, (typeof planos)[number]>(diasComPlano.map((d, i) => [d, planos[i]]));

  for (const [indice, caso] of conjunto.entries()) {
    console.log(`${"=".repeat(70)}`);
    console.log(`caso ${indice + 1}/${conjunto.length}: ${caso.local} (hoje: ${caso.hoje})`);
    console.log(`agenda contada: ${caso.texto}`);
    console.log(`${"-".repeat(70)}\n`);

    custoTotalUsd += custoDoResultado(lerAgendaIA.nivel, leituras[indice]);

    for (const lido of diasPorCaso[indice]) {
      const { dia } = lido;
      diasLidos += 1;
      if (lido.dataResolvida === null) {
        diasSemData += 1;
        console.log(`  [SEM DATA] "${dia.referenciaDia}" nao resolveu (${lido.motivo})`);
        continue;
      }

      console.log(`  dia ${lido.dataResolvida} (referencia "${dia.referenciaDia}"), lugar: ${dia.lugar || "(nao informado)"}`);
      for (const compromisso of dia.compromissos) {
        console.log(`    - ${compromisso}`);
      }

      const plano = planoDoDia.get(lido)!;
      custoTotalUsd += custoDoResultado(planejarDiaIA.nivel, plano);

      for (const sugestao of plano.dados.sugestoes) {
        console.log(`      sugestao (${sugestao.objetivo}): ${sugestao.situacao} / mostrar: ${sugestao.oQueMostrar}`);
      }
    }
    console.log("");
  }

  console.log(`dias lidos: ${diasLidos}, sem data resolvida: ${diasSemData}`);
  console.log(`custo total: US$ ${custoTotalUsd.toFixed(4)}`);

  return { conjunto: caminho, ehExemplo, casos: conjunto.length, diasLidos, diasSemData, custoTotalUsd };
}

if (require.main === module) {
  avaliarAgendas().catch((erro: unknown) => {
    console.error(erro);
    process.exitCode = 1;
  });
}
