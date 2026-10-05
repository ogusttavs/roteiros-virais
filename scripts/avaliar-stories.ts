/**
 * Conjunto de referência do Story (golden set, V9c, item 5, `PROXIMO.md`):
 * mesmo raciocínio de `avaliar-roteiros.ts` ("o Gustavo leria isso e
 * gravaria?"), mais a checagem por regra do verificador (`R-IG-STORY-03` a
 * `07`) e a conferência de `porQueAssim` contra a lista de regras válidas.
 * Cada caso é origem "tema" (como `avaliar-roteiros.ts`) ou origem
 * "momento" (como `avaliar-momentos.ts`), nunca os dois: um caso do
 * conjunto é a viagem do Bruno como pessoa citando a marca, que só existe
 * com `momento`.
 *
 * O arquivo real fica fora do repositório público (`avaliacoes/README.md`
 * explica o porquê). `GOLDEN_SET_DIR` aponta para a pasta que tem
 * `stories.json`; sem o arquivo real lá, roda com
 * `avaliacoes/stories.exemplo.json` e avisa que é exemplo.
 */
import "./chave-de-testes";
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

const evidenciaSchema = z.object({
  id: z.number(),
  assunto: z.string(),
  gancho: z.string(),
  estrutura: z.string(),
  fechamento: z.string(),
  chamadaFinal: z.string(),
  foraDaCurva: z.number(),
  momentoChave: z.string().optional(),
});

const momentoSchema = z.object({
  onde: z.string(),
  oQueEstaAcontecendo: z.string(),
  oQueDaParaMostrar: z.string(),
});

const casoSchema = z
  .object({
    /** Origem "tema" (como `avaliar-roteiros.ts`): presente junto com `evidencias`, nunca com `momento`. */
    tema: z.string().optional(),
    /** Origem "momento" (como `avaliar-momentos.ts`): presente sozinho, nunca com `tema`. */
    momento: momentoSchema.optional(),
    objetivo: objetivoSchema,
    perfilCompilado: z.string(),
    camadaExclusiva: z.string(),
    modeloNicho: z.string(),
    evidencias: z.array(evidenciaSchema).default([]),
    roteirosRecentes: z
      .array(z.object({ tema: z.string(), objetivo: objetivoSchema, status: z.string(), gancho: z.string() }))
      .default([]),
    regrasCliente: z.array(z.object({ regra: z.string(), contagem: z.number() })).default([]),
    tipo: z.enum(["negocio", "pessoa"]).default("negocio"),
    /** Só com `momento`: os momentos anteriores da mesma viagem. */
    contextoDeSerie: z.array(z.object({ tema: z.string(), gancho: z.string() })).default([]),
    /** Só com `momento`: quando a pessoa citou outra marca dela durante o momento. */
    marcaCitada: z.object({ nome: z.string(), perfilCompilado: z.string() }).optional(),
    pontoPrincipal: z.string(),
  })
  .refine((caso) => Boolean(caso.tema) !== Boolean(caso.momento), {
    message: "cada caso tem tema ou momento, nunca os dois nem nenhum",
  });
const conjuntoSchema = z.array(casoSchema);

function caminhoDoConjunto(): { caminho: string; ehExemplo: boolean } {
  const dir = process.env.GOLDEN_SET_DIR ?? "../avaliacoes-privadas";
  const caminhoReal = path.resolve(process.cwd(), dir, "stories.json");
  if (existsSync(caminhoReal)) {
    return { caminho: caminhoReal, ehExemplo: false };
  }
  return {
    caminho: path.resolve(process.cwd(), "avaliacoes/stories.exemplo.json"),
    ehExemplo: true,
  };
}

export type ResultadoAvaliarStories = {
  conjunto: string;
  ehExemplo: boolean;
  casos: number;
  titulos: string[];
  /** Reprovado no verificador de produção: checagem local (por regra R-IG-STORY) mais verificarTexto. */
  /** Reprovados nas DUAS tentativas (em produção, `ErroIA`): o número que decide o deploy. */
  reprovadosNoVerificador: number;
  /** Reprovados na 1ª tentativa (a 2ª refaz com o motivo). */
  reprovadosNa1aTentativa: number;
  /** Casos (ou verificadores) que o lote devolveu com falha: impressos com o motivo, e os outros seguem. */
  casosFalhos: number;
  custoTotalUsd: number;
};

export async function avaliarStories(): Promise<ResultadoAvaliarStories> {
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
    rotulo: "stories",
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
        regrasCliente: caso.regrasCliente,
        tipo: caso.tipo,
        formato: "story",
        estilo: "falado",
      }),
      entrada: roteiroIA.montarEntrada({
        tema: caso.tema ?? "",
        objetivo: caso.objetivo,
        formato: "story",
        estilo: "falado",
        evidencias: caso.evidencias,
        roteirosRecentes: caso.roteirosRecentes,
        instrucaoAbertura: { tipo: null, tiposProibidos: [] },
        momento: caso.momento,
        contextoDeSerie: caso.contextoDeSerie,
        marcaCitada: caso.marcaCitada,
      }),
    }),
      local: (saida) => {
      const campos = extrairCamposRoteiro(saida);
      const palavrasDoMomento = caso.momento
        ? palavrasDeConteudo(`${caso.momento.onde} ${caso.momento.oQueEstaAcontecendo}`)
        : undefined;
      const local = verificarLocalmente(campos, {
        formato: "story",
        cartoes: saida.cartoes,
        porQueAssim: saida.porQueAssim,
        palavrasDoMomento,
      });
        return local;
      },
      campos: (saida) => extrairCamposRoteiro(saida),
      pedidoVerificador: (campos) => ({
        tarefa: "verificarTexto",
        nivel: verificarTextoIA.nivel,
        effort: verificarTextoIA.esforco,
        schema: verificarTextoIA.schema,
        sistemaEstavel: verificarTextoIA.montarSistemaEstavel("roteiro", true),
        entrada: verificarTextoIA.montarEntrada({ texto: Object.values(campos).join("\n"), proibicoes: [], fontes: montarFontesDosFatos({ perfilCompilado: caso.perfilCompilado, camadaExclusiva: caso.camadaExclusiva, tema: caso.tema, momento: caso.momento, marcaCitada: caso.marcaCitada, evidencias: caso.evidencias }) }),
      }),
    })),
  });
  const resumo = resumirProducao(producao);

  for (const [indice, caso] of conjunto.entries()) {
    console.log(`${"=".repeat(70)}`);
    console.log(`caso ${indice + 1}/${conjunto.length}: "${caso.tema ?? caso.momento?.onde}"`);
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

    console.log(`titulo: ${saida.titulo}`);
    console.log(`duracao: ${saida.duracaoS}s`);
    console.log(`tema curto: ${saida.temaCurto ?? "(nulo)"}\n`);

    (saida.cartoes ?? []).forEach((cartao, i) => {
      console.log(`CARTAO ${i + 1} (figurinha: ${cartao.figurinha})`);
      console.log(`  o que falar: ${cartao.oQueFalar}`);
      console.log(`  o que mostrar: ${cartao.oQueMostrar}`);
      console.log(`  texto na tela: ${cartao.textoNaTela}\n`);
    });

    console.log("POR QUE ASSIM");
    for (const item of saida.porQueAssim) {
      console.log(`  ${item.regra}: ${item.motivo}`);
    }
    if (caso.marcaCitada) {
      console.log(`\nmarca citada no caso: ${caso.marcaCitada.nome} (confira se nao virou anuncio dela)`);
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
  avaliarStories().catch((erro: unknown) => {
    console.error(erro);
    process.exitCode = 1;
  });
}
