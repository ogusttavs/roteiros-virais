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
import * as verificarTextoIA from "../src/ia/prompts/verificarTexto";
import { verificarLocalmente } from "../src/ia/verificador";

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
  /**
   * Quantos casos o verificador (checagem local mais a tarefa
   * verificarTexto, `generoTexto: "analise"`) reprovaria na primeira
   * tentativa (rodada de acabamento de 06/09, item 1: meta e zero).
   */
  reprovadosNoVerificador: number;
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
  let reprovadosNoVerificador = 0;

  for (const caso of conjunto) {
    const pergunta = perguntaPorId(caso.perguntaId);
    if (!pergunta) {
      console.log(`${caso.perguntaId}: pergunta desconhecida, pulando`);
      continue;
    }

    /**
     * Um caso que falha (erro transitorio de rede, resposta truncada) nao
     * pode derrubar o resto do conjunto: sem isso, um golden set de doze
     * casos perdia todos os que vinham depois do primeiro erro.
     */
    try {
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

      /**
       * O mesmo verificador de producao (checagem local mais verificarTexto,
       * `generoTexto: "analise"`), rodado aqui so para saber se aprovaria,
       * sem repetir nem gravar em geracoes_ia (rodada de acabamento de
       * 06/09, item 1): antes deste ajuste o script so media a nota, nunca
       * conferia se a analise passaria no verificador de verdade.
       */
      const campos = {
        bom: resultado.dados.bom,
        melhorar: resultado.dados.melhorar,
        como: resultado.dados.como,
        exemplo: resultado.dados.exemplo,
        impacto: resultado.dados.impacto,
      };
      const local = verificarLocalmente(campos);
      let verificacao = local;
      if (local.aprovado) {
        const saida = await gerarEstruturado({
          tarefa: "verificarTexto",
          nivel: verificarTextoIA.nivel,
          effort: verificarTextoIA.esforco,
          schema: verificarTextoIA.schema,
          sistemaEstavel: verificarTextoIA.montarSistemaEstavel("analise"),
          entrada: verificarTextoIA.montarEntrada({ texto: Object.values(campos).join("\n"), proibicoes: [] }),
        });
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
    } catch (erro) {
      console.log(`${caso.perguntaId}: erro ao avaliar, pulando (${erro instanceof Error ? erro.message : String(erro)})`);
    }
  }

  const diferencaMedia = casosAvaliados > 0 ? somaDiferencas / casosAvaliados : 0;
  const acimaDaMeta = diferencaMedia >= META_DIFERENCA;
  console.log(`\ndiferenca media: ${diferencaMedia.toFixed(2)}`);
  if (acimaDaMeta) {
    console.log("acima da meta de 1,0 (plano de execucao, etapa 5).");
  }
  console.log(`reprovados no verificador: ${reprovadosNoVerificador} de ${casosAvaliados}`);

  return {
    conjunto: caminho,
    ehExemplo,
    casos: conjunto.length,
    diferencaMedia,
    acimaDaMeta,
    reprovadosNoVerificador,
  };
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
