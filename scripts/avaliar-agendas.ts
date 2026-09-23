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

import { gerarEstruturado } from "../src/ia/cliente";
import * as lerAgendaIA from "../src/ia/prompts/lerAgenda";
import * as planejarDiaIA from "../src/ia/prompts/planejarDia";
import { calcularCustoUsd } from "../src/ia/registro";
import { ErroDataRelativa, resolverDataRelativa } from "../src/lib/data-relativa";

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

  for (const [indice, caso] of conjunto.entries()) {
    console.log(`${"=".repeat(70)}`);
    console.log(`caso ${indice + 1}/${conjunto.length}: ${caso.local} (hoje: ${caso.hoje})`);
    console.log(`agenda contada: ${caso.texto}`);
    console.log(`${"-".repeat(70)}\n`);

    const leitura = await gerarEstruturado({
      tarefa: "lerAgenda",
      nivel: lerAgendaIA.nivel,
      effort: lerAgendaIA.esforco,
      schema: lerAgendaIA.schema,
      sistemaEstavel: lerAgendaIA.montarSistemaEstavel(),
      entrada: lerAgendaIA.montarEntrada({ texto: caso.texto }),
    });
    custoTotalUsd += calcularCustoUsd(lerAgendaIA.nivel, leitura);

    for (const dia of leitura.dados.dias) {
      diasLidos += 1;
      let dataResolvida: string;
      try {
        dataResolvida = resolverDataRelativa(dia.referenciaDia, caso.hoje);
      } catch (erro) {
        if (erro instanceof ErroDataRelativa) {
          diasSemData += 1;
          console.log(`  [SEM DATA] "${dia.referenciaDia}" nao resolveu (${erro.message})`);
          continue;
        }
        throw erro;
      }

      console.log(`  dia ${dataResolvida} (referencia "${dia.referenciaDia}"), lugar: ${dia.lugar || "(nao informado)"}`);
      for (const compromisso of dia.compromissos) {
        console.log(`    - ${compromisso}`);
      }

      const plano = await gerarEstruturado({
        tarefa: "planejarDia",
        nivel: planejarDiaIA.nivel,
        effort: planejarDiaIA.esforco,
        schema: planejarDiaIA.schema,
        sistemaEstavel: planejarDiaIA.montarSistemaEstavel({
          perfilCompilado: caso.perfilCompilado,
          modeloNicho: caso.modeloNicho,
        }),
        entrada: planejarDiaIA.montarEntrada({ lugar: dia.lugar, compromissos: dia.compromissos }),
      });
      custoTotalUsd += calcularCustoUsd(planejarDiaIA.nivel, plano);

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
