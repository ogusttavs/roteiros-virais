/**
 * A marcação de fala do roteiro (E41, parte 2a; as seis marcas e as regras R-FALA da seção 10 de `briefing-e-rubricas.md`): a pessoa liga "Marcas de fala" (ou abre o modo gravação) e o
 * roteiro Reels falado que ela escolheu ganha peso, pausa, devagar e tom, escritos uma vez e guardados em `roteiros.marcas_de_fala`. Sob demanda: nunca na geração, nunca nas versões que
 * ninguém escolheu (decisão do Fable em 10/10/2026, para não pagar por marca que ninguém vai ler).
 *
 * Quem faz o quê: o modelo (barato) só COLOCA marcas, bloco a bloco, e escolhe o tom de cada bloco; o código confere que o texto sem as marcas é idêntico ao original (a trava, `textoIdentico`),
 * põe e tira o que as regras que "conferem por código" mandam (`consertarMarcas`) e guarda as conferências que não mexem em marca como aviso (`conferirFala`). Um bloco que o modelo não acerta
 * em duas tentativas fica só com as marcas do código, nunca com texto mudado. A frase fixa da R-FALA-24 não passa por aqui (`textos/marcas-de-fala.ts`).
 */
import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { roteiros, type ConteudoRoteiro, type MarcasDeFala } from "@/db/schema";
import { gerarEstruturado } from "@/ia/cliente";
import * as marcarIA from "@/ia/prompts/marcarFala";
import { registrarGeracao } from "@/ia/registro";
import { logger } from "@/lib/log";
import {
  ambienteComBarulho,
  BLOCOS_FALADOS,
  conferirFala,
  consertarMarcas,
  contarPalavras,
  escreverPalavras,
  lerPalavras,
  publicoMaisVelho,
  temChaveNoTexto,
  textoIdentico,
  textoSemMarcas,
  TOM_PADRAO_DO_BLOCO,
  TONS_DO_BLOCO,
  type BlocoFalado,
  type ConferenciaDeFala,
  type TomDoBloco,
} from "@/lib/marcas-de-fala";
import { textosMarcasDeFala } from "@/textos/marcas-de-fala";

import { perfilDoCliente } from "./briefing";
import { ErroRoteiro, roteiroPorId } from "./roteiro";

export type MotivoSemMarcas = "story" | "sem_fala" | "sem_texto" | "chave_no_texto" | "editado_no_meio";

export type ResultadoDaMarcacao = { ok: true; marcas: MarcasDeFala; novas: boolean } | { ok: false; motivo: MotivoSemMarcas };

/** Os blocos falados do conteúdo, na ordem do vídeo, sem os vazios. */
export function blocosFalados(conteudo: ConteudoRoteiro): { bloco: BlocoFalado; texto: string }[] {
  return BLOCOS_FALADOS.map((bloco) => ({ bloco, texto: (conteudo[bloco] ?? "").trim() })).filter((b) => b.texto !== "");
}

/** Story e vídeo sem fala não têm fala; texto sem palavra ou com chave (a sintaxe das marcas) não se marca. */
export function motivoDeNaoMarcar(roteiro: { formato: string; estilo: string; conteudo: ConteudoRoteiro }): MotivoSemMarcas | null {
  if (roteiro.formato === "story") return "story";
  if (roteiro.estilo === "sem_fala") return "sem_fala";
  const blocos = blocosFalados(roteiro.conteudo);
  if (blocos.length === 0) return "sem_texto";
  if (blocos.some((b) => temChaveNoTexto(b.texto))) return "chave_no_texto";
  return null;
}

/**
 * As marcas guardadas valem para o texto de agora? Só se tiver um bloco marcado para cada bloco falado de agora, na mesma ordem, e o texto sem as marcas de cada um for idêntico ao texto
 * de agora. É a segunda trava: uma edição que não passou por `editarRoteiro` (um conserto no banco, uma corrida entre a edição e a marcação) não deixa marca velha sobre texto novo.
 */
export function marcasValidas(marcas: MarcasDeFala | null | undefined, conteudo: ConteudoRoteiro): MarcasDeFala | null {
  if (!marcas) return null;
  const atuais = blocosFalados(conteudo);
  if (atuais.length !== marcas.blocos.length) return null;
  for (let i = 0; i < atuais.length; i += 1) {
    const guardado = marcas.blocos[i];
    if (guardado.bloco !== atuais[i].bloco) return null;
    if (!textoIdentico(atuais[i].texto, guardado.marcado)) return null;
  }
  return marcas;
}

/**
 * Junta o que o modelo devolveu para um bloco com o conserto por código. Um texto do modelo que não passa na trava é descartado inteiro (o bloco fica só com as marcas do código).
 * A quebra de parágrafo do roteiro é mantida quando o modelo a manteve; se não, o bloco volta numa linha só. O resultado SEMPRE passa na trava: se por algum defeito não passar, o bloco
 * volta como o original, sem marca nenhuma, e o erro vai para o log (nunca texto mudado na tela).
 */
export function marcarBloco(
  original: string,
  marcadoPeloModelo: string | null,
  contexto: { chamadaFinal: boolean; maisDevagar: boolean },
): { marcado: string; correcoes: string[]; usouModelo: boolean } {
  const paragrafos = original
    .split(/\n+/)
    .map((p) => p.trim())
    .filter((p) => p !== "");
  const candidato = marcadoPeloModelo !== null && textoIdentico(original, marcadoPeloModelo) ? marcadoPeloModelo : null;

  let pedacos: string[];
  if (candidato === null) {
    pedacos = paragrafos;
  } else {
    // As palavras do modelo são as do original (a trava), então a quebra de parágrafo do roteiro volta por contagem de palavras, qualquer que seja o que o modelo fez com as quebras de linha.
    const palavras = lerPalavras(candidato);
    const contagens = paragrafos.map(contarPalavras);
    if (contagens.reduce((soma, n) => soma + n, 0) === palavras.length) {
      let inicio = 0;
      pedacos = contagens.map((n) => {
        const parte = escreverPalavras(palavras.slice(inicio, inicio + n));
        inicio += n;
        return parte;
      });
    } else {
      pedacos = [escreverPalavras(palavras)];
    }
  }

  const correcoes: string[] = [];
  const consertados = pedacos.map((pedaco, i) => {
    const r = consertarMarcas(pedaco, { chamadaFinal: contexto.chamadaFinal && i === pedacos.length - 1, maisDevagar: contexto.maisDevagar });
    correcoes.push(...r.correcoes);
    return r.texto;
  });
  const marcado = consertados.join("\n");
  if (!textoIdentico(original, marcado)) {
    logger.error({ original: original.slice(0, 200) }, "a marcacao de fala mudou o texto: o bloco volta sem marca");
    return { marcado: paragrafos.join("\n"), correcoes: [], usouModelo: false };
  }
  return { marcado, correcoes, usouModelo: candidato !== null };
}

function textoDoAviso(conferencia: ConferenciaDeFala): string {
  switch (conferencia.regra) {
    case "R-FALA-01":
      return textosMarcasDeFala.avisos.muleta(conferencia.muleta);
    case "R-FALA-04":
      return textosMarcasDeFala.avisos.fraseComprida(conferencia.comeco);
    case "R-FALA-14":
      return textosMarcasDeFala.avisos.barulho;
    case "R-FALA-15":
      return textosMarcasDeFala.avisos.publicoMaisVelho;
  }
}

function tomValido(tom: string | undefined, bloco: BlocoFalado): TomDoBloco {
  return (TONS_DO_BLOCO as readonly string[]).includes(tom ?? "") ? (tom as TomDoBloco) : TOM_PADRAO_DO_BLOCO[bloco];
}

/** Uma marcação por roteiro de cada vez no processo: dois pedidos juntos (a chave e o modo gravação) esperam a mesma chamada, em vez de pagar duas. */
const EM_ANDAMENTO = new Map<string, Promise<ResultadoDaMarcacao>>();

/**
 * Devolve as marcas de fala do roteiro, escrevendo-as na primeira vez. Idempotente: com marcas válidas guardadas, não chama IA. O roteiro é conferido por dono (`roteiroPorId(id,
 * clienteId)`): de outra marca é "não achei". Erro da IA sobe como `ErroIA` (nada é guardado, a pessoa tenta de novo).
 */
export async function marcarFalaDoRoteiro(clienteId: number, roteiroId: number): Promise<ResultadoDaMarcacao> {
  const roteiro = await roteiroPorId(roteiroId, clienteId);
  if (!roteiro) throw new ErroRoteiro(textosMarcasDeFala.erros.naoEncontrado);

  const motivo = motivoDeNaoMarcar(roteiro);
  if (motivo) return { ok: false, motivo };

  const guardadas = marcasValidas(roteiro.marcasDeFala, roteiro.conteudo);
  if (guardadas) return { ok: true, marcas: guardadas, novas: false };

  const chave = `${clienteId}:${roteiroId}`;
  const emAndamento = EM_ANDAMENTO.get(chave);
  if (emAndamento) return emAndamento;
  const trabalho = escreverMarcas(clienteId, roteiro).finally(() => EM_ANDAMENTO.delete(chave));
  EM_ANDAMENTO.set(chave, trabalho);
  return trabalho;
}

async function escreverMarcas(clienteId: number, roteiro: NonNullable<Awaited<ReturnType<typeof roteiroPorId>>>): Promise<ResultadoDaMarcacao> {
  const conteudo = roteiro.conteudo;
  const blocos = blocosFalados(conteudo);

  const perfil = await perfilDoCliente(clienteId);
  const lugares = [roteiro.momento?.onde, roteiro.momento?.oQueDaParaMostrar, ...(conteudo.cenas ?? []).map((c) => c.oQueFazer)].filter((t): t is string => Boolean(t));
  const barulho = ambienteComBarulho(lugares);
  const velho = perfil ? publicoMaisVelho([perfil.fatos.clienteIdeal]) : false;
  const maisDevagar = barulho || velho;

  const doModelo = new Map<BlocoFalado, { texto: string; tom: string }>();
  let pendentes: BlocoFalado[] = blocos.map((b) => b.bloco);
  let falhouAntes: BlocoFalado[] | undefined;

  for (let tentativa = 1; tentativa <= 2 && pendentes.length > 0; tentativa += 1) {
    const inicio = Date.now();
    const saida = await gerarEstruturado({
      tarefa: "marcarFala",
      nivel: marcarIA.nivel,
      effort: marcarIA.esforco,
      schema: marcarIA.schema,
      sistemaEstavel: marcarIA.montarSistemaEstavel(),
      entrada: marcarIA.montarEntrada({
        titulo: conteudo.titulo,
        duracaoS: conteudo.duracaoS,
        blocos: blocos.filter((b) => pendentes.includes(b.bloco)),
        ambienteComBarulho: barulho,
        publicoMaisVelho: velho,
        falhouNaTentativaAnterior: falhouAntes,
      }),
    });
    // O registro é do custo e da auditoria: se ele falhar, a marcação que já foi paga não se perde.
    try {
      await registrarGeracao({
        tarefa: "marcarFala",
        versaoPrompt: marcarIA.versao,
        modelo: saida.modelo,
        nivel: marcarIA.nivel,
        clienteId,
        entradas: { roteiroId: roteiro.id, tentativa, blocos: pendentes },
        saida: saida.dados,
        uso: {
          tokensEntrada: saida.tokensEntrada,
          tokensSaida: saida.tokensSaida,
          tokensCacheLeitura: saida.tokensCacheLeitura,
          tokensCacheEscrita: saida.tokensCacheEscrita,
        },
        duracaoMs: Date.now() - inicio,
      });
    } catch (erro) {
      logger.warn({ err: erro, clienteId, roteiroId: roteiro.id }, "nao foi possivel registrar a marcacao de fala");
    }

    const falharam: BlocoFalado[] = [];
    for (const bloco of pendentes) {
      const original = blocos.find((b) => b.bloco === bloco)!.texto;
      const devolvido = saida.dados.blocos.find((b) => b.bloco === bloco);
      if (devolvido && textoIdentico(original, devolvido.texto)) doModelo.set(bloco, { texto: devolvido.texto, tom: devolvido.tom });
      else falharam.push(bloco);
    }
    pendentes = falharam;
    falhouAntes = falharam;
  }

  const marcas: MarcasDeFala = {
    versaoPrompt: marcarIA.versao,
    geradoEm: new Date().toISOString(),
    blocos: [],
    avisos: [],
    correcoes: [],
    semModelo: [],
  };
  const sem: Partial<Record<BlocoFalado, string>> = {};
  for (const { bloco, texto } of blocos) {
    const devolvido = doModelo.get(bloco);
    const r = marcarBloco(texto, devolvido?.texto ?? null, { chamadaFinal: bloco === "chamadaFinal", maisDevagar });
    marcas.blocos.push({ bloco, marcado: r.marcado, tom: tomValido(devolvido?.tom, bloco) });
    marcas.correcoes.push(...r.correcoes);
    if (!r.usouModelo) marcas.semModelo.push(bloco);
    sem[bloco] = textoSemMarcas(r.marcado);
  }
  marcas.avisos = conferirFala(sem, { ambienteComBarulho: barulho, publicoMaisVelho: velho }).map((c) => ({ regra: c.regra, texto: textoDoAviso(c) }));

  // Só grava se o roteiro não foi editado enquanto o modelo escrevia (a edição apaga as marcas e muda `editado_em`); senão, a tela pede de novo.
  const gravadas = await db()
    .update(roteiros)
    .set({ marcasDeFala: marcas })
    .where(and(eq(roteiros.id, roteiro.id), eq(roteiros.clienteId, clienteId), sql`${roteiros.editadoEm} is not distinct from ${roteiro.editadoEm}`))
    .returning({ id: roteiros.id });
  if (gravadas.length === 0) return { ok: false, motivo: "editado_no_meio" };
  return { ok: true, marcas, novas: true };
}
