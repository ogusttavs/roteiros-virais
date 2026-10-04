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
import type { TipoMarca } from "../src/db/schema";
import * as avaliarRespostaIA from "../src/ia/prompts/avaliarResposta";
import * as verificarTextoIA from "../src/ia/prompts/verificarTexto";
import { verificarLocalmente } from "../src/ia/verificador";

import { custoDoResultado, gerarVariosOuErro } from "./golden-lote";

const casoSchema = z.object({
  perguntaId: z.string(),
  resposta: z.string(),
  notaEsperada: z.number().min(0).max(10),
  pontoPrincipal: z.string(),
});
const conjuntoSchema = z.array(casoSchema);

/** P1, item 6: golden set proprio da pessoa, mesmo formato do negocio. */
function caminhoDoConjunto(tipo: TipoMarca): { caminho: string; ehExemplo: boolean } {
  const dir = process.env.GOLDEN_SET_DIR ?? "../avaliacoes-privadas";
  const nomeArquivo = tipo === "pessoa" ? "briefing-pessoa.json" : "briefing.json";
  const nomeExemplo = tipo === "pessoa" ? "briefing-pessoa.exemplo.json" : "briefing.exemplo.json";
  const caminhoReal = path.resolve(process.cwd(), dir, nomeArquivo);
  if (existsSync(caminhoReal)) {
    return { caminho: caminhoReal, ehExemplo: false };
  }
  return {
    caminho: path.resolve(process.cwd(), `avaliacoes/${nomeExemplo}`),
    ehExemplo: true,
  };
}

export type ResultadoAvaliarBriefing = {
  conjunto: string;
  ehExemplo: boolean;
  casos: number;
  diferencaMedia: number;
  acimaDaMeta: boolean;
  /**
   * Quantos casos o verificador (checagem local mais a tarefa
   * verificarTexto, `generoTexto: "analise"`) reprovaria na primeira
   * tentativa (rodada de acabamento de 06/09, item 1: meta e zero).
   */
  reprovadosNoVerificador: number;
  /** Soma do custo de todas as chamadas (avaliarResposta e verificarTexto), em dolares. */
  custoTotalUsd: number;
};

const META_DIFERENCA = 1.0;

/**
 * Roda o conjunto inteiro e imprime cada caso (npm run avaliar:briefing) e
 * devolve o resumo numerico, para `avaliar-tudo.ts` gravar num JSON so
 * (etapa 18, decisao 4 do `PROXIMO.md`) sem precisar reler o stdout.
 */
export async function avaliarBriefing(tipo: TipoMarca = "negocio"): Promise<ResultadoAvaliarBriefing> {
  const { caminho, ehExemplo } = caminhoDoConjunto(tipo);
  const conjunto = conjuntoSchema.parse(JSON.parse(readFileSync(caminho, "utf8")));

  console.log(`conjunto: ${caminho}${ehExemplo ? " (exemplo, nao e o golden set real)" : ""}`);
  console.log(`${conjunto.length} caso(s)\n`);

  let somaDiferencas = 0;
  let casosAvaliados = 0;
  let reprovadosNoVerificador = 0;
  let custoTotalUsd = 0;

  // O golden set pelo lote (`golden-lote.ts`): a nota de todas as respostas num lote, o verificador (checagem local aqui, e o `verificarTexto` num segundo lote só para as que a
  // local aprovou), e só então a leitura, caso a caso. Um caso que falha (erro de rede, resposta truncada) continua sendo pulado sem derrubar o resto do conjunto.
  const perguntas = conjunto.map((caso) => perguntaPorId(caso.perguntaId, tipo));
  const indicesValidos = conjunto.flatMap((_, indice) => (perguntas[indice] ? [indice] : []));
  const notas = await gerarVariosOuErro(
    indicesValidos.map((indice) => {
      const caso = conjunto[indice];
      const pergunta = perguntas[indice]!;
      return {
        tarefa: "avaliarResposta" as const,
        nivel: avaliarRespostaIA.nivel,
        effort: avaliarRespostaIA.esforco,
        schema: avaliarRespostaIA.schema,
        sistemaEstavel: avaliarRespostaIA.montarSistemaEstavel(),
        entrada: avaliarRespostaIA.montarEntrada({
          pergunta: pergunta.enunciado,
          oQueAIAProcura: pergunta.oQueAIAProcura,
          resposta: caso.resposta,
          tipo,
        }),
      };
    }),
    "briefing",
  );
  const notaDoCaso = new Map(indicesValidos.map((indice, i) => [indice, notas[i]] as const));

  const camposDoCaso = new Map<number, Record<string, string>>();
  const locais = new Map<number, { aprovado: boolean; motivos: string[] }>();
  for (const [indice, nota] of notaDoCaso) {
    if (nota instanceof Error) continue;
    const campos = {
      bom: nota.dados.bom,
      melhorar: nota.dados.melhorar,
      como: nota.dados.como,
      exemplo: nota.dados.exemplo,
      impacto: nota.dados.impacto,
    };
    camposDoCaso.set(indice, campos);
    locais.set(indice, verificarLocalmente(campos));
  }
  const indicesParaVerificador = [...locais].flatMap(([indice, local]) => (local.aprovado ? [indice] : []));
  const respostasDoVerificador = await gerarVariosOuErro(
    indicesParaVerificador.map((indice) => ({
      tarefa: "verificarTexto" as const,
      nivel: verificarTextoIA.nivel,
      effort: verificarTextoIA.esforco,
      schema: verificarTextoIA.schema,
      sistemaEstavel: verificarTextoIA.montarSistemaEstavel("analise"),
      entrada: verificarTextoIA.montarEntrada({ texto: Object.values(camposDoCaso.get(indice)!).join("\n"), proibicoes: [] }),
    })),
    "verificador (briefing)",
  );
  const verificadorDoCaso = new Map(indicesParaVerificador.map((indice, i) => [indice, respostasDoVerificador[i]] as const));

  for (const [indice, caso] of conjunto.entries()) {
    if (!perguntas[indice]) {
      console.log(`${caso.perguntaId}: pergunta desconhecida, pulando`);
      continue;
    }

    const resultado = notaDoCaso.get(indice)!;
    const saida = verificadorDoCaso.get(indice);
    if (resultado instanceof Error || saida instanceof Error) {
      const erro = resultado instanceof Error ? resultado : (saida as Error);
      console.log(`${caso.perguntaId}: erro ao avaliar, pulando (${erro.message})`);
      continue;
    }

    const diferenca = Math.abs(resultado.dados.nota - caso.notaEsperada);
    somaDiferencas += diferenca;
    casosAvaliados += 1;
    custoTotalUsd += custoDoResultado(avaliarRespostaIA.nivel, resultado);

    /**
     * O mesmo verificador de producao (checagem local mais verificarTexto,
     * `generoTexto: "analise"`), rodado aqui so para saber se aprovaria,
     * sem repetir nem gravar em geracoes_ia (rodada de acabamento de
     * 06/09, item 1): antes deste ajuste o script so media a nota, nunca
     * conferia se a analise passaria no verificador de verdade.
     */
    let verificacao = locais.get(indice)!;
    if (saida) {
      custoTotalUsd += custoDoResultado(verificarTextoIA.nivel, saida);
      verificacao = {
        aprovado: saida.dados.aprovado,
        motivos: saida.dados.aprovado ? [] : [saida.dados.motivo ?? "reprovado"],
      };
    }
    if (!verificacao.aprovado) reprovadosNoVerificador += 1;

    console.log(
      `${caso.perguntaId}: IA deu ${resultado.dados.nota}, esperado ${caso.notaEsperada} ` +
        `(diferenca ${diferenca.toFixed(1)}) - ${caso.pontoPrincipal}` +
        (verificacao.aprovado ? "" : ` [REPROVADO NO VERIFICADOR: ${verificacao.motivos.join("; ")}]`),
    );
  }

  const diferencaMedia = casosAvaliados > 0 ? somaDiferencas / casosAvaliados : 0;
  const acimaDaMeta = diferencaMedia >= META_DIFERENCA;
  console.log(`\ndiferenca media: ${diferencaMedia.toFixed(2)}`);
  if (acimaDaMeta) {
    console.log("acima da meta de 1,0 (plano de execucao, etapa 5).");
  }
  console.log(`reprovados no verificador: ${reprovadosNoVerificador} de ${casosAvaliados}`);
  console.log(`custo total: US$ ${custoTotalUsd.toFixed(4)}`);

  return {
    conjunto: caminho,
    ehExemplo,
    casos: conjunto.length,
    diferencaMedia,
    acimaDaMeta,
    reprovadosNoVerificador,
    custoTotalUsd,
  };
}

/**
 * So dispara ao rodar `tsx scripts/avaliar-briefing.ts` direto (`npm run
 * avaliar:briefing`), nunca quando `avaliar-tudo.ts` importa a funcao: os
 * dois rodam no mesmo processo CommonJS do tsx, entao `require.main` e o
 * script que foi chamado na linha de comando, nao este arquivo, quando e
 * so um import.
 *
 * P1, item 6: `npm run avaliar:briefing -- pessoa` roda o golden set da
 * pessoa; sem argumento, roda o do negocio, como sempre.
 */
if (require.main === module) {
  const tipoArgumento = process.argv[2];
  const tipo: TipoMarca = tipoArgumento === "pessoa" ? "pessoa" : "negocio";
  avaliarBriefing(tipo).catch((erro: unknown) => {
    console.error(erro);
    process.exitCode = 1;
  });
}
