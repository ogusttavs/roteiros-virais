/**
 * Conjunto de referência do momento (golden set, V9a, item 6, `PROXIMO.md`):
 * mesmo raciocínio de `avaliar-roteiros.ts` ("o Gustavo leria isso e
 * gravaria?"), mais a checagem específica do item 2 (o gancho cita um
 * elemento concreto do momento) e, quando o caso tem `marcaCitada`, se ela
 * aparece como parte da vida de quem grava, nunca como anúncio.
 *
 * O arquivo real, com os cinco momentos de verdade da viagem do Bruno, fica
 * fora do repositório público (`avaliacoes/README.md` explica o porquê).
 * `GOLDEN_SET_DIR` aponta para a pasta que tem `momentos.json`; sem o
 * arquivo real lá, roda com `avaliacoes/momentos.exemplo.json` e avisa que
 * é exemplo.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import { gerarEstruturado } from "../src/ia/cliente";
import * as roteiroIA from "../src/ia/prompts/roteiro";
import * as verificarTextoIA from "../src/ia/prompts/verificarTexto";
import { calcularCustoUsd } from "../src/ia/registro";
import { palavrasDeConteudo, verificarLocalmente } from "../src/ia/verificador";
import { extrairCamposRoteiro } from "../src/servicos/roteiro";

const objetivoSchema = z.enum(["alcance", "engajamento", "conversao"]);

const casoSchema = z.object({
  onde: z.string(),
  oQueEstaAcontecendo: z.string(),
  oQueDaParaMostrar: z.string(),
  objetivo: objetivoSchema,
  perfilCompilado: z.string(),
  camadaExclusiva: z.string(),
  modeloNicho: z.string(),
  /** V9a, item 4: ausente vira "negocio", o mesmo padrão da coluna. */
  tipo: z.enum(["negocio", "pessoa"]).default("negocio"),
  /** V9a, item 2: os momentos anteriores da mesma viagem, "o que já foi gravado nesta sequência". */
  contextoDeSerie: z.array(z.object({ tema: z.string(), gancho: z.string() })).default([]),
  /** V9a, item 4: só nos casos em que a pessoa citou outra marca dela durante o momento. */
  marcaCitada: z.object({ nome: z.string(), perfilCompilado: z.string() }).optional(),
  pontoPrincipal: z.string(),
});
const conjuntoSchema = z.array(casoSchema);

function caminhoDoConjunto(): { caminho: string; ehExemplo: boolean } {
  const dir = process.env.GOLDEN_SET_DIR ?? "../avaliacoes-privadas";
  const caminhoReal = path.resolve(process.cwd(), dir, "momentos.json");
  if (existsSync(caminhoReal)) {
    return { caminho: caminhoReal, ehExemplo: false };
  }
  return {
    caminho: path.resolve(process.cwd(), "avaliacoes/momentos.exemplo.json"),
    ehExemplo: true,
  };
}

export type ResultadoAvaliarMomentos = {
  conjunto: string;
  ehExemplo: boolean;
  casos: number;
  titulos: string[];
  /** Reprovado no verificador de produção OU na checagem do item 2 (gancho sem elemento concreto do momento). */
  reprovadosNoVerificador: number;
  custoTotalUsd: number;
};

export async function avaliarMomentos(): Promise<ResultadoAvaliarMomentos> {
  const { caminho, ehExemplo } = caminhoDoConjunto();
  const conjunto = conjuntoSchema.parse(JSON.parse(readFileSync(caminho, "utf8")));
  const titulos: string[] = [];
  let reprovadosNoVerificador = 0;
  let custoTotalUsd = 0;

  console.log(`conjunto: ${caminho}${ehExemplo ? " (exemplo, nao e o golden set real)" : ""}`);
  console.log(`${conjunto.length} caso(s)\n`);

  for (const [indice, caso] of conjunto.entries()) {
    console.log(`${"=".repeat(70)}`);
    console.log(`caso ${indice + 1}/${conjunto.length}: onde "${caso.onde}", tipo "${caso.tipo}"`);
    console.log(`ponto principal: ${caso.pontoPrincipal}`);
    console.log(`${"-".repeat(70)}\n`);

    const resultado = await gerarEstruturado({
      tarefa: "roteiro",
      nivel: roteiroIA.nivel,
      effort: roteiroIA.esforco,
      schema: roteiroIA.schema,
      sistemaEstavel: roteiroIA.montarSistemaEstavel({
        perfilCompilado: caso.perfilCompilado,
        camadaExclusiva: caso.camadaExclusiva,
        modeloNicho: caso.modeloNicho,
        regrasCliente: [],
        tipo: caso.tipo,
      }),
      entrada: roteiroIA.montarEntrada({
        tema: "",
        objetivo: caso.objetivo,
        evidencias: [],
        roteirosRecentes: [],
        instrucaoAbertura: { tipo: null, tiposProibidos: [] },
        momento: { onde: caso.onde, oQueEstaAcontecendo: caso.oQueEstaAcontecendo, oQueDaParaMostrar: caso.oQueDaParaMostrar },
        contextoDeSerie: caso.contextoDeSerie,
        marcaCitada: caso.marcaCitada,
      }),
    });

    const saida = resultado.dados;
    titulos.push(saida.titulo);
    let custoDoCasoUsd = calcularCustoUsd(roteiroIA.nivel, resultado);

    console.log(`tema curto: ${saida.temaCurto ?? "(nulo)"}`);
    console.log(`titulo: ${saida.titulo}`);
    console.log(`duracao: ${saida.duracaoS}s\n`);
    console.log("OS 3 PRIMEIROS SEGUNDOS");
    console.log(`  ${saida.gancho}\n`);
    console.log("O MEIO");
    console.log(`  ${saida.corpo}\n`);
    console.log("O FECHAMENTO");
    console.log(`  ${saida.fechamento}\n`);
    console.log("A CHAMADA FINAL");
    console.log(`  ${saida.chamadaFinal}\n`);
    console.log("ONDE GRAVAR E O QUE MOSTRAR");
    console.log(`  ${saida.ondeGravar}`);
    for (const cena of saida.cenas) {
      console.log(`  ${cena.momento}: ${cena.oQueFazer}`);
    }
    if (caso.marcaCitada) {
      console.log(`\nmarca citada no caso: ${caso.marcaCitada.nome} (confira se o gancho/corpo nao vira anuncio dela)`);
    }

    const campos = extrairCamposRoteiro(saida);
    const palavrasDoMomento = palavrasDeConteudo(`${caso.onde} ${caso.oQueEstaAcontecendo}`);
    const local = verificarLocalmente(campos, { palavrasDoMomento });
    let verificacao = local;
    if (local.aprovado) {
      const saidaVerificacao = await gerarEstruturado({
        tarefa: "verificarTexto",
        nivel: verificarTextoIA.nivel,
        effort: verificarTextoIA.esforco,
        schema: verificarTextoIA.schema,
        sistemaEstavel: verificarTextoIA.montarSistemaEstavel("roteiro"),
        entrada: verificarTextoIA.montarEntrada({ texto: Object.values(campos).join("\n"), proibicoes: [] }),
      });
      custoDoCasoUsd += calcularCustoUsd(verificarTextoIA.nivel, saidaVerificacao);
      verificacao = {
        aprovado: saidaVerificacao.dados.aprovado,
        motivos: saidaVerificacao.dados.aprovado ? [] : [saidaVerificacao.dados.motivo ?? "reprovado"],
      };
    }
    if (!verificacao.aprovado) {
      reprovadosNoVerificador += 1;
      console.log(`\n[REPROVADO NO VERIFICADOR: ${verificacao.motivos.join("; ")}]`);
    }

    custoTotalUsd += custoDoCasoUsd;
    console.log(`\ncusto deste caso: US$ ${custoDoCasoUsd.toFixed(4)} (${resultado.modelo})\n`);
  }

  console.log(`reprovados no verificador: ${reprovadosNoVerificador} de ${conjunto.length}`);
  console.log(`custo total: US$ ${custoTotalUsd.toFixed(4)}`);

  return { conjunto: caminho, ehExemplo, casos: conjunto.length, titulos, reprovadosNoVerificador, custoTotalUsd };
}

if (require.main === module) {
  avaliarMomentos().catch((erro: unknown) => {
    console.error(erro);
    process.exitCode = 1;
  });
}
