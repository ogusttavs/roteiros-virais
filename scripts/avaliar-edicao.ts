/**
 * Conjunto de referência da edição de vídeo (golden set, E47 PR 3): a decisão do modelo forte, o motor de corte e o verificador, de ponta a ponta, sobre a fala de um vídeo (palavras com
 * tempo e curva de energia), sem banco e sem render. Mede o que o aceite do PR 3 pede (`estrategia/e47-edicao-pela-ia.md`, seção 4):
 *  - o retake certo (a tentativa da abertura que o Gustavo aprovou) em pelo menos 4 de 5;
 *  - nenhum nome do briefing errado na legenda (e nenhuma palavra proibida nela);
 *  - nenhum alerta de corte com palavra ainda soando;
 *  - a edição termina `verificado` (não `para_revisao`);
 *  - o título, impresso, para o Gustavo dizer se é igual à abertura do roteiro ou melhor;
 *  - tokens e custo reais de cada caso (teto de US$ 5 por dia no golden set).
 *
 * O arquivo real fica fora do repositório (`avaliacoes/README.md`): `GOLDEN_SET_DIR/edicao.json`, com a fala REAL de cada vídeo de referência (as palavras que a Groq devolveu e a curva de
 * energia medida do áudio, `palavras` e `energia`) e a abertura que ele aprovou (`esperado.aberturaCerta`). Sem ele, roda com `avaliacoes/edicao.exemplo.json` (fala sintética, montada
 * de `frases`) e avisa que é exemplo. As chamadas vão direto pelo caminho normal (a decisão tem dois passos que dependem um do outro, então o lote não serve), a preço cheio.
 *
 * Como preparar um caso real depois que o Gustavo gravar os vídeos (fase 0 do estudo): subir o vídeo pelo app até o estado `transcrito`, copiar `palavras` e `energia` da edição
 * (`edicoes.palavras` e `edicoes.energia`) para um caso novo, e escrever em `esperado` a abertura que ele aprovou na edição de referência, os nomes que a legenda deve ter e o que não pode ter.
 */
import "./chave-de-testes";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import { montarFalaSintetica } from "../src/edicao/sintetica";
import { nomesParaGrafar } from "../src/edicao/verificacao";
import { calcularCustoUsd } from "../src/ia/registro";
import { config } from "../src/lib/config";
import { decidirEVerificar, type Chamador, type ContextoDaEdicao } from "../src/servicos/decidir-edicao-nucleo";

import { descricaoDaIA } from "./golden-lote";

const faixaSchema = z.object({ deIndice: z.number().int(), ateIndice: z.number().int() });

const casoSchema = z
  .object({
    nome: z.string(),
    marca: z.object({
      nome: z.string(),
      cidade: z.string().nullable().optional(),
      concorrentes: z.array(z.string()).default([]),
      resumo: z.string().default(""),
    }),
    roteiro: z.object({ titulo: z.string(), gancho: z.string(), corpo: z.string(), fechamento: z.string(), chamadaFinal: z.string(), textoNaTela: z.array(z.string()).default([]) }),
    /** Fala sintética: frases em ordem, com a pausa antes de cada uma (só no exemplo). */
    frases: z.array(z.object({ texto: z.string(), pausaAntes: z.number().optional() })).optional(),
    /** Fala real: as palavras que a Groq devolveu e a curva de energia do áudio (só no conjunto real). */
    palavras: z.array(z.object({ texto: z.string(), inicio: z.number(), fim: z.number(), abreTrecho: z.boolean().optional() })).optional(),
    energia: z.object({ db: z.array(z.number()), duracao: z.number() }).optional(),
    esperado: z.object({
      /** Na fala sintética: o número (de 1) da frase que é a tentativa certa da abertura. */
      aberturaCertaFrase: z.number().int().optional(),
      /** Na fala real: as palavras da tentativa que o Gustavo aprovou. O que conta é a primeira palavra. */
      aberturaCerta: faixaSchema.optional(),
      legendaDeveConter: z.array(z.string()).default([]),
      legendaNaoPodeConter: z.array(z.string()).default([]),
    }),
    pontoPrincipal: z.string(),
  })
  .refine((c) => Boolean(c.frases) || (Boolean(c.palavras) && Boolean(c.energia)), { message: "o caso precisa de `frases` (fala sintética) ou de `palavras` e `energia` (fala real)" });
const conjuntoSchema = z.array(casoSchema);

type Caso = z.infer<typeof casoSchema>;

function caminhoDoConjunto(): { caminho: string; ehExemplo: boolean } {
  const dir = process.env.GOLDEN_SET_DIR ?? "../avaliacoes-privadas";
  const caminhoReal = path.resolve(process.cwd(), dir, "edicao.json");
  if (existsSync(caminhoReal)) return { caminho: caminhoReal, ehExemplo: false };
  return { caminho: path.resolve(process.cwd(), "avaliacoes/edicao.exemplo.json"), ehExemplo: true };
}

function falaDoCaso(caso: Caso) {
  if (caso.frases) {
    const f = montarFalaSintetica(caso.frases);
    const certa = caso.esperado.aberturaCertaFrase !== undefined ? f.faixas[caso.esperado.aberturaCertaFrase - 1] : caso.esperado.aberturaCerta;
    return { palavras: f.palavras, energia: f.energia, duracaoS: f.duracao, aberturaCerta: certa };
  }
  const db = Float32Array.from(caso.energia!.db);
  return { palavras: caso.palavras!, energia: { db, duracao: caso.energia!.duracao }, duracaoS: caso.energia!.duracao, aberturaCerta: caso.esperado.aberturaCerta };
}

function contextoDoCaso(caso: Caso): ContextoDaEdicao {
  const r = caso.roteiro;
  return {
    roteiro: r,
    textoDoRoteiro: [r.titulo, r.gancho, r.corpo, r.fechamento, r.chamadaFinal, ...r.textoNaTela].join(" "),
    marca: { nome: caso.marca.nome, resumo: caso.marca.resumo },
    nomes: nomesParaGrafar({ nomeDaMarca: caso.marca.nome, cidade: caso.marca.cidade, concorrentes: caso.marca.concorrentes }),
  };
}

export type ResultadoAvaliarEdicao = {
  conjunto: string;
  ehExemplo: boolean;
  casos: number;
  verificados: number;
  aberturasCertas: number;
  semProblemaNaLegenda: number;
  semAlertaDeCorte: number;
  casosFalhos: number;
  tokensEntrada: number;
  tokensSaida: number;
  custoUsd: number;
};

export async function avaliarEdicao(): Promise<ResultadoAvaliarEdicao> {
  const { caminho, ehExemplo } = caminhoDoConjunto();
  const conjunto = conjuntoSchema.parse(JSON.parse(readFileSync(caminho, "utf8")));
  console.log(`[${descricaoDaIA(config.ia.provedor, config.ia.modeloForte, config.ia.modeloBarato)}]\n`);
  console.log(`conjunto: ${caminho}${ehExemplo ? " (exemplo, nao e o golden set real)" : ""}`);
  console.log(`${conjunto.length} caso(s)\n`);

  const r: ResultadoAvaliarEdicao = { conjunto: caminho, ehExemplo, casos: conjunto.length, verificados: 0, aberturasCertas: 0, semProblemaNaLegenda: 0, semAlertaDeCorte: 0, casosFalhos: 0, tokensEntrada: 0, tokensSaida: 0, custoUsd: 0 };

  for (const [indice, caso] of conjunto.entries()) {
    console.log("=".repeat(70));
    console.log(`caso ${indice + 1}/${conjunto.length}: ${caso.nome}`);
    console.log(`ponto principal: ${caso.pontoPrincipal}`);
    console.log("-".repeat(70));

    const fala = falaDoCaso(caso);
    let tokensEntrada = 0;
    let tokensSaida = 0;
    let custo = 0;
    const chamar: Chamador = async (tarefa, _versao, nivel, _detalhes, fazer) => {
      const saida = await fazer();
      tokensEntrada += saida.tokensEntrada + saida.tokensCacheLeitura + saida.tokensCacheEscrita;
      tokensSaida += saida.tokensSaida;
      custo += calcularCustoUsd(nivel, { tokensEntrada: saida.tokensEntrada, tokensSaida: saida.tokensSaida, tokensCacheLeitura: saida.tokensCacheLeitura, tokensCacheEscrita: saida.tokensCacheEscrita });
      console.log(`  chamada ${tarefa} (${saida.modelo}): ${saida.tokensEntrada} de entrada, ${saida.tokensSaida} de saida`);
      return saida.dados;
    };

    let saida;
    try {
      saida = await decidirEVerificar({ palavras: fala.palavras, energia: fala.energia, duracaoS: fala.duracaoS, contexto: contextoDoCaso(caso), chamar, agora: new Date() });
    } catch (erro) {
      r.casosFalhos += 1;
      console.log(`[FALHOU: ${erro instanceof Error ? erro.message : String(erro)}]\n`);
      r.tokensEntrada += tokensEntrada;
      r.tokensSaida += tokensSaida;
      r.custoUsd += custo;
      continue;
    }
    r.tokensEntrada += tokensEntrada;
    r.tokensSaida += tokensSaida;
    r.custoUsd += custo;

    const resultado = saida.resultado;
    const verificado = saida.estado === "verificado";
    if (verificado) r.verificados += 1;
    console.log(`estado: ${saida.estado} (${saida.decisoes} decisao(oes))${saida.problemas.length > 0 ? `; problemas: ${saida.problemas.join("; ")}` : ""}`);

    if (resultado && saida.decisao) {
      const legenda = resultado.legenda.blocos.map((b) => b.texto).join(" ");
      const abertura = saida.decisao.gancho;
      const certa = fala.aberturaCerta;
      const abriuCerto = certa ? abertura.deIndice === certa.deIndice : null;
      if (abriuCerto) r.aberturasCertas += 1;
      const faltou = caso.esperado.legendaDeveConter.filter((t) => !legenda.toUpperCase().includes(t.toUpperCase()));
      const proibidas = caso.esperado.legendaNaoPodeConter.filter((t) => legenda.toUpperCase().includes(t.toUpperCase()));
      if (faltou.length === 0 && proibidas.length === 0) r.semProblemaNaLegenda += 1;
      if (resultado.edl.alertas.length === 0) r.semAlertaDeCorte += 1;

      console.log(`abertura escolhida: palavras ${abertura.deIndice} a ${abertura.ateIndice} (${abertura.tentativasDescartadas} outra(s) tentativa(s) de fora)${abriuCerto === null ? "" : abriuCerto ? " -> CERTA" : ` -> ERRADA (a certa comeca na ${certa?.deIndice})`}`);
      console.log(`titulo: ${resultado.titulo.texto}${resultado.titulo.subtitulo ? ` | ${resultado.titulo.subtitulo}` : ""}`);
      console.log(`  (titulo do roteiro: ${caso.roteiro.titulo}; abertura do roteiro: ${caso.roteiro.gancho})`);
      console.log(`trechos: ${resultado.edl.trechos.length}; duracao ${resultado.edl.duracao.toFixed(1)} s de ${resultado.edl.duracaoOrigem.toFixed(1)} s; alertas de corte: ${resultado.edl.alertas.length}`);
      console.log(`legenda (${resultado.legenda.blocos.length} blocos): ${legenda}`);
      if (faltou.length > 0) console.log(`  FALTOU na legenda: ${faltou.join(", ")}`);
      if (proibidas.length > 0) console.log(`  NA LEGENDA E NAO PODIA: ${proibidas.join(", ")}`);
      if (resultado.avisos.length > 0) console.log(`avisos para a pessoa: ${resultado.avisos.join(" | ")}`);
    }
    console.log(`tokens: ${tokensEntrada} de entrada, ${tokensSaida} de saida; custo deste caso: US$ ${custo.toFixed(4)}\n`);
  }

  const avaliados = r.casos - r.casosFalhos;
  console.log("=".repeat(70));
  console.log(`edicoes verificadas: ${r.verificados} de ${avaliados}`);
  console.log(`abertura certa: ${r.aberturasCertas} de ${avaliados} (meta do PR 3: 4 de 5)`);
  console.log(`legenda sem nome errado nem palavra proibida: ${r.semProblemaNaLegenda} de ${avaliados}`);
  console.log(`sem alerta de corte com palavra soando: ${r.semAlertaDeCorte} de ${avaliados}`);
  if (r.casosFalhos > 0) console.log(`casos que falharam: ${r.casosFalhos} de ${r.casos}`);
  console.log(`tokens: ${r.tokensEntrada} de entrada, ${r.tokensSaida} de saida; custo total: US$ ${r.custoUsd.toFixed(4)} (teto de US$ 5 por dia no golden set)`);
  return r;
}

if (require.main === module) {
  avaliarEdicao().catch((erro: unknown) => {
    console.error(erro);
    process.exitCode = 1;
  });
}
