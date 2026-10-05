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

import * as roteiroIA from "../src/ia/prompts/roteiro";
import { montarFontesDosFatos } from "../src/ia/prompts/roteiro";
import * as verificarTextoIA from "../src/ia/prompts/verificarTexto";
import { palavrasDeConteudo, verificarLocalmente } from "../src/ia/verificador";
import { extrairCamposRoteiro } from "../src/servicos/roteiro";

import { rodarComoEmProducao, linhaDoResumo, resumirProducao } from "./golden-producao";

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
  /** Reprovados nas DUAS tentativas (em produção, `ErroIA`): o número que decide o deploy. */
  reprovadosNoVerificador: number;
  /** Reprovados na 1ª tentativa (a 2ª refaz com o motivo). */
  reprovadosNa1aTentativa: number;
  /** Casos (ou verificadores) que o lote devolveu com falha: impressos com o motivo, e os outros seguem. */
  casosFalhos: number;
  custoTotalUsd: number;
};

export async function avaliarMomentos(): Promise<ResultadoAvaliarMomentos> {
  const { caminho, ehExemplo } = caminhoDoConjunto();
  const conjunto = conjuntoSchema.parse(JSON.parse(readFileSync(caminho, "utf8")));
  const titulos: string[] = [];
  let reprovadosNoVerificador = 0;
  let casosFalhos = 0;
  let custoTotalUsd = 0;

  console.log(`conjunto: ${caminho}${ehExemplo ? " (exemplo, nao e o golden set real)" : ""}`);
  console.log(`${conjunto.length} caso(s)\n`);

  // Pelo MESMO caminho de produção (`golden-producao.ts`): 1ª tentativa de todos os casos, a conferência local e a do `verificarTexto` com as fontes, e os reprovados refazem
  // com o motivo (2ª tentativa); reprovar nas duas é o `ErroIA` que a pessoa veria. Cada etapa em lote (ou `--direto`).
  const producao = await rodarComoEmProducao<roteiroIA.SaidaRoteiro>({
    rotulo: "momentos",
    lembreteFinal: roteiroIA.LEMBRETE_ACENTUACAO,
    casos: conjunto.map((caso) => ({
      pedido: () => ({
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
        formato: "reels",
        estilo: "falado",
      }),
      entrada: roteiroIA.montarEntrada({
        tema: "",
        objetivo: caso.objetivo,
        formato: "reels",
        estilo: "falado",
        evidencias: [],
        roteirosRecentes: [],
        instrucaoAbertura: { tipo: null, tiposProibidos: [] },
        momento: { onde: caso.onde, oQueEstaAcontecendo: caso.oQueEstaAcontecendo, oQueDaParaMostrar: caso.oQueDaParaMostrar },
        contextoDeSerie: caso.contextoDeSerie,
        marcaCitada: caso.marcaCitada,
      }),
    }),
      local: (saida) => {
      const campos = extrairCamposRoteiro(saida);
      const palavrasDoMomento = palavrasDeConteudo(`${caso.onde} ${caso.oQueEstaAcontecendo}`);
      const local = verificarLocalmente(campos, { palavrasDoMomento });
        return local;
      },
      campos: (saida) => extrairCamposRoteiro(saida),
      pedidoVerificador: (campos) => ({
        tarefa: "verificarTexto",
        nivel: verificarTextoIA.nivel,
        effort: verificarTextoIA.esforco,
        schema: verificarTextoIA.schema,
        sistemaEstavel: verificarTextoIA.montarSistemaEstavel("roteiro", true),
        entrada: verificarTextoIA.montarEntrada({ texto: Object.values(campos).join("\n"), proibicoes: [], fontes: montarFontesDosFatos({ perfilCompilado: caso.perfilCompilado, camadaExclusiva: caso.camadaExclusiva, momento: { onde: caso.onde, oQueEstaAcontecendo: caso.oQueEstaAcontecendo, oQueDaParaMostrar: caso.oQueDaParaMostrar }, marcaCitada: caso.marcaCitada }) }),
      }),
    })),
  });
  const resumo = resumirProducao(producao);

  for (const [indice, caso] of conjunto.entries()) {
    console.log(`${"=".repeat(70)}`);
    console.log(`caso ${indice + 1}/${conjunto.length}: onde "${caso.onde}", tipo "${caso.tipo}"`);
    console.log(`ponto principal: ${caso.pontoPrincipal}`);
    console.log(`${"-".repeat(70)}\n`);

    const prod = producao[indice];
    if (prod.falhou && !prod.gerada) {
      casosFalhos += 1;
      console.log(`[FALHOU: ${prod.falhou.message}]\n`);
      continue;
    }
    const resultado = prod.gerada!;

    const saida = resultado.dados;
    titulos.push(saida.titulo);
    const custoDoCasoUsd = prod.custoUsd;

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

    const verificacao = prod.verificacao;
    if (prod.falhou) {
      casosFalhos += 1;
      console.log(`[VERIFICADOR FALHOU: ${prod.falhou.message}]`);
    }
    if (prod.reprovouNa1a) console.log(`[1ª TENTATIVA REPROVADA: ${prod.motivosDa1a.join("; ")}]${prod.tentativas === 2 ? " (a 2ª tentativa foi escrita com este motivo)" : ""}`);
    if (!verificacao.aprovado) {
      reprovadosNoVerificador += 1;
      console.log(`\n[REPROVADO NAS DUAS TENTATIVAS (ErroIA em produção): ${verificacao.motivos.join("; ")}]`);
    }

    custoTotalUsd += custoDoCasoUsd;
    console.log(`\ncusto deste caso: US$ ${custoDoCasoUsd.toFixed(4)} (${resultado.modelo})\n`);
  }

  console.log(linhaDoResumo(conjunto.length, resumo));
  console.log(`reprovados no verificador: ${reprovadosNoVerificador} de ${conjunto.length}`);
  if (casosFalhos > 0) console.log(`casos que falharam no lote: ${casosFalhos} de ${conjunto.length}`);
  console.log(`custo total: US$ ${custoTotalUsd.toFixed(4)}`);

  return { conjunto: caminho, ehExemplo, casos: conjunto.length, titulos, reprovadosNoVerificador, reprovadosNa1aTentativa: resumo.reprovadosNa1a, casosFalhos, custoTotalUsd };
}

if (require.main === module) {
  avaliarMomentos().catch((erro: unknown) => {
    console.error(erro);
    process.exitCode = 1;
  });
}
