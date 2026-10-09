/**
 * Conjunto de referência do tema do momento (E55, revisão do Fable em 06/10/2026: `temaDoMomento` é um prompt novo no modelo forte e não tinha como ser medido). Cada caso traz o setor (nome, termos e
 * modelo do nicho) e uma lista de assuntos em alta no Brasil, e diz se o modelo DEVE gerar um tema do momento ou não. O script aplica as mesmas travas do código de produção (`jobs/tema-do-momento.ts`):
 * o tema só nasce se o modelo escolheu um assunto que existe, que não é sensível, com encaixe de pelo menos `ENCAIXE_MINIMO`. Mede o acerto de gerar ou não gerar, e imprime o título e o encaixe
 * do que gerou, para o revisor ler (o ângulo é do setor? cita a fonte?). Um caso sensível é enviado COM o assunto marcado "SENSÍVEL" (em produção o job nem o manda; aqui mede se o modelo obedece
 * mesmo assim, e a trava do código o barra de qualquer jeito).
 *
 * O arquivo real fica fora do repositório (`avaliacoes/README.md`): `GOLDEN_SET_DIR/tema-do-momento.json`; sem ele, roda com `avaliacoes/tema-do-momento.exemplo.json` e avisa que é exemplo.
 */
import "./chave-de-testes";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import * as temaDoMomentoIA from "../src/ia/prompts/temaDoMomento";

import { custoDoResultado, gerarVariosOuErro } from "./golden-lote";

const casoSchema = z.object({
  /** Um nome curto do caso, para o resumo. */
  nome: z.string(),
  setor: z.object({ nome: z.string(), termos: z.array(z.string()), modeloNicho: z.string() }),
  assuntos: z
    .array(
      z.object({
        assunto: z.string(),
        sensivel: z.boolean().default(false),
        fontes: z.array(z.object({ fonte: z.enum(["google", "youtube"]), titulo: z.string() })).min(1),
      }),
    )
    .min(1),
  /** O que o código de produção deve concluir: nasce um tema do momento ou não. */
  deveGerar: z.boolean(),
  /** Quando deve gerar, qual assunto (o número na lista, de 1) é o certo; ausente, qualquer um que não seja sensível serve. */
  assuntoCerto: z.number().int().optional(),
  pontoPrincipal: z.string(),
});
const conjuntoSchema = z.array(casoSchema);

function caminhoDoConjunto(): { caminho: string; ehExemplo: boolean } {
  const dir = process.env.GOLDEN_SET_DIR ?? "../avaliacoes-privadas";
  const caminhoReal = path.resolve(process.cwd(), dir, "tema-do-momento.json");
  if (existsSync(caminhoReal)) return { caminho: caminhoReal, ehExemplo: false };
  return { caminho: path.resolve(process.cwd(), "avaliacoes/tema-do-momento.exemplo.json"), ehExemplo: true };
}

export type ResultadoAvaliarTemaDoMomento = {
  conjunto: string;
  ehExemplo: boolean;
  casos: number;
  acertos: number;
  /** Casos em que o modelo escolheu um assunto sensível (a trava do código o barrou, mas o modelo desobedeceu). */
  escolheuSensivel: number;
  casosFalhos: number;
  custoUsd: number;
};

export async function avaliarTemaDoMomento(): Promise<ResultadoAvaliarTemaDoMomento> {
  const { caminho, ehExemplo } = caminhoDoConjunto();
  const conjunto = conjuntoSchema.parse(JSON.parse(readFileSync(caminho, "utf8")));

  console.log(`conjunto: ${caminho}${ehExemplo ? " (exemplo, nao e o golden set real)" : ""}`);
  console.log(`${conjunto.length} caso(s)\n`);

  const resultados = await gerarVariosOuErro(
    conjunto.map((caso) => ({
      tarefa: "temaDoMomento" as const,
      nivel: temaDoMomentoIA.nivel,
      effort: temaDoMomentoIA.esforco,
      schema: temaDoMomentoIA.schema,
      sistemaEstavel: temaDoMomentoIA.montarSistemaEstavel({ nomeDoSetor: caso.setor.nome, termosDoSetor: caso.setor.termos, modeloNicho: caso.setor.modeloNicho }),
      entrada: temaDoMomentoIA.montarEntrada({
        assuntos: caso.assuntos.map((a, i) => ({ numero: i + 1, assunto: a.assunto, sensivel: a.sensivel, fontes: a.fontes })),
      }),
    })),
    "tema do momento",
  );

  let acertos = 0;
  let escolheuSensivel = 0;
  let casosFalhos = 0;
  let custoUsd = 0;

  for (const [indice, caso] of conjunto.entries()) {
    const resultado = resultados[indice];
    if (resultado instanceof Error) {
      casosFalhos += 1;
      console.log(`"${caso.nome}": [FALHOU: ${resultado.message}]\n`);
      continue;
    }
    custoUsd += custoDoResultado(temaDoMomentoIA.nivel, resultado);

    const escolha = resultado.dados.escolha;
    const escolhido = escolha ? caso.assuntos[escolha.indice - 1] : undefined;
    const sensivelEscolhido = Boolean(escolhido?.sensivel);
    if (sensivelEscolhido) escolheuSensivel += 1;
    // As travas do código de produção: o assunto existe, não é sensível e o encaixe passa do mínimo.
    const nasceu = Boolean(escolha && escolhido && !escolhido.sensivel && escolha.encaixe >= temaDoMomentoIA.ENCAIXE_MINIMO);
    const certoNoAssunto = !caso.deveGerar || caso.assuntoCerto === undefined || escolha?.indice === caso.assuntoCerto;
    const acertou = nasceu === caso.deveGerar && (!nasceu || certoNoAssunto);
    if (acertou) acertos += 1;

    console.log(`"${caso.nome}" (${caso.pontoPrincipal})`);
    console.log(`  esperado: ${caso.deveGerar ? `gera${caso.assuntoCerto ? ` o assunto ${caso.assuntoCerto}` : ""}` : "não gera"}`);
    if (!escolha) {
      console.log("  modelo: nenhum tema (escolha nula)");
    } else {
      console.log(`  modelo: assunto ${escolha.indice} (${escolhido?.assunto ?? "índice que não existe"}), encaixe ${escolha.encaixe}${sensivelEscolhido ? ", SENSÍVEL (a trava do código barra)" : ""}`);
      console.log(`  título: ${escolha.titulo}`);
      console.log(`  porQue: ${escolha.porQue}`);
    }
    console.log(`  produção: ${nasceu ? "nasce o tema" : "nenhum tema"} -> ${acertou ? "ACERTOU" : "ERROU"}\n`);
  }

  console.log(`acertos: ${acertos} de ${conjunto.length - casosFalhos}${casosFalhos > 0 ? ` (${casosFalhos} falharam no lote)` : ""}`);
  if (escolheuSensivel > 0) console.log(`o modelo escolheu um assunto sensível em ${escolheuSensivel} caso(s) (a trava do código barrou)`);
  console.log(`custo: US$ ${custoUsd.toFixed(4)}`);

  return { conjunto: caminho, ehExemplo, casos: conjunto.length, acertos, escolheuSensivel, casosFalhos, custoUsd };
}

if (require.main === module) {
  avaliarTemaDoMomento().catch((erro: unknown) => {
    console.error(erro);
    process.exitCode = 1;
  });
}
