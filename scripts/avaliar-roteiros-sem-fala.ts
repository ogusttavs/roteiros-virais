/**
 * Conjunto de referência do roteiro sem fala (golden set, M4, item 6): mesmo raciocínio de
 * `avaliar-stories.ts` ("o Gustavo leria isso e gravaria?"), com a checagem do verificador
 * (`estilo: "sem_fala"`, nenhum cartão com fala, texto na tela dentro do limite, legenda
 * presente). Cada caso é origem "tema" ou origem "momento", nunca os dois, mesmo padrão de
 * `avaliar-stories.ts`.
 *
 * O arquivo real fica fora do repositório público (`avaliacoes/README.md` explica o porquê).
 * `GOLDEN_SET_DIR` aponta para a pasta que tem `roteiros-sem-fala.json`; sem o arquivo real lá,
 * roda com `avaliacoes/roteiros-sem-fala.exemplo.json` e avisa que é exemplo.
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

const evidenciaSchema = z.object({
  id: z.number(),
  assunto: z.string(),
  gancho: z.string(),
  estrutura: z.string(),
  fechamento: z.string(),
  chamadaFinal: z.string(),
  foraDaCurva: z.number(),
  momentoChave: z.string().optional(),
  semFala: z.boolean().optional(),
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
    /** "reels" (padrão) ou "story": sem fala vale nos dois (M4, item 2). */
    formato: z.enum(["reels", "story"]).default("reels"),
    pontoPrincipal: z.string(),
  })
  .refine((caso) => Boolean(caso.tema) !== Boolean(caso.momento), {
    message: "cada caso tem tema ou momento, nunca os dois nem nenhum",
  });
const conjuntoSchema = z.array(casoSchema);

function caminhoDoConjunto(): { caminho: string; ehExemplo: boolean } {
  const dir = process.env.GOLDEN_SET_DIR ?? "../avaliacoes-privadas";
  const caminhoReal = path.resolve(process.cwd(), dir, "roteiros-sem-fala.json");
  if (existsSync(caminhoReal)) {
    return { caminho: caminhoReal, ehExemplo: false };
  }
  return {
    caminho: path.resolve(process.cwd(), "avaliacoes/roteiros-sem-fala.exemplo.json"),
    ehExemplo: true,
  };
}

export type ResultadoAvaliarRoteirosSemFala = {
  conjunto: string;
  ehExemplo: boolean;
  casos: number;
  titulos: string[];
  /** Reprovado no verificador de produção: checagem local (`estilo: "sem_fala"`) mais verificarTexto. */
  reprovadosNoVerificador: number;
  custoTotalUsd: number;
};

export async function avaliarRoteirosSemFala(): Promise<ResultadoAvaliarRoteirosSemFala> {
  const { caminho, ehExemplo } = caminhoDoConjunto();
  const conjunto = conjuntoSchema.parse(JSON.parse(readFileSync(caminho, "utf8")));
  const titulos: string[] = [];
  let reprovadosNoVerificador = 0;
  let custoTotalUsd = 0;

  console.log(`conjunto: ${caminho}${ehExemplo ? " (exemplo, nao e o golden set real)" : ""}`);
  console.log(`${conjunto.length} caso(s)\n`);

  for (const [indice, caso] of conjunto.entries()) {
    console.log(`${"=".repeat(70)}`);
    console.log(`caso ${indice + 1}/${conjunto.length}: "${caso.tema ?? caso.momento?.onde}" (${caso.formato})`);
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
        regrasCliente: caso.regrasCliente,
        tipo: caso.tipo,
        formato: caso.formato,
        estilo: "sem_fala",
      }),
      entrada: roteiroIA.montarEntrada({
        tema: caso.tema ?? "",
        objetivo: caso.objetivo,
        formato: caso.formato,
        estilo: "sem_fala",
        evidencias: caso.evidencias,
        roteirosRecentes: caso.roteirosRecentes,
        instrucaoAbertura: { tipo: null, tiposProibidos: [] },
        momento: caso.momento,
      }),
    });

    const saida = resultado.dados;
    titulos.push(saida.titulo);
    let custoDoCasoUsd = calcularCustoUsd(roteiroIA.nivel, resultado);

    console.log(`titulo: ${saida.titulo}`);
    console.log(`duracao: ${saida.duracaoS}s`);
    console.log(`tema curto: ${saida.temaCurto ?? "(nulo)"}\n`);

    (saida.cartoes ?? []).forEach((cartao, i) => {
      console.log(`CENA ${i + 1}`);
      console.log(`  o que falar (precisa ficar vazio): "${cartao.oQueFalar}"`);
      console.log(`  o que mostrar: ${cartao.oQueMostrar}`);
      console.log(`  texto na tela: ${cartao.textoNaTela}\n`);
    });

    console.log(`LEGENDA DO POST\n  ${saida.legenda ?? "(nula, deveria estar preenchida)"}\n`);

    const campos = extrairCamposRoteiro(saida);
    const palavrasDoMomento = caso.momento
      ? palavrasDeConteudo(`${caso.momento.onde} ${caso.momento.oQueEstaAcontecendo}`)
      : undefined;
    const local = verificarLocalmente(campos, {
      estilo: "sem_fala",
      cartoes: saida.cartoes,
      legenda: saida.legenda,
      palavrasDoMomento,
    });
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
      console.log(`[REPROVADO NO VERIFICADOR: ${verificacao.motivos.join("; ")}]`);
    }

    custoTotalUsd += custoDoCasoUsd;
    console.log(`\ncusto deste caso: US$ ${custoDoCasoUsd.toFixed(4)} (${resultado.modelo})\n`);
  }

  console.log(`reprovados no verificador: ${reprovadosNoVerificador} de ${conjunto.length}`);
  console.log(`custo total: US$ ${custoTotalUsd.toFixed(4)}`);

  return { conjunto: caminho, ehExemplo, casos: conjunto.length, titulos, reprovadosNoVerificador, custoTotalUsd };
}

if (require.main === module) {
  avaliarRoteirosSemFala().catch((erro: unknown) => {
    console.error(erro);
    process.exitCode = 1;
  });
}
