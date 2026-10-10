/**
 * E28, os comentários do público: as duas conferências por código que ficam entre o modelo e o banco. O modelo só agrupa por número;
 * quem conta, quem soma e quem decide o que vale é daqui (o mesmo desenho de `conferirAssuntos`, da E55). Puro, sem banco, para o
 * teste provar a contagem e a limpeza sem a IA.
 *
 * Dois níveis:
 * 1. `conferirLeitura`: UM vídeo. Cada item volta com os números dos comentários que dizem aquilo; vale só número que existe, e um
 *    comentário conta uma vez por lista. `vezes` é o tamanho disso. O texto do item é a nossa frase, limpa de @, endereço, emoji e
 *    travessão. As frases literais só entram se estiverem mesmo no comentário indicado.
 * 2. `conferirVozes`: o SETOR. Os itens de todos os vídeos da semana entram numerados; o modelo junta os que dizem o mesmo; a soma
 *    das vezes e os vídeos de origem são nossos. O que o modelo deixou de fora volta como grupo de um item só: nada se perde.
 */
import type { ComentariosAnalise, ItemDoPublico, VozDoPublico, VozesDoSetor } from "@/db/schema";
import type { SaidaJuntarVozes } from "@/ia/prompts/juntarVozes";
import type { SaidaLerComentarios } from "@/ia/prompts/lerComentarios";
import { formaDeComparar, limparComentario, limparTextoDoModelo } from "@/lib/comentarios";

export type ComentarioNumerado = { numero: number; texto: string; curtidas: number };
export type TipoDeVoz = "duvida" | "objecao" | "pedido";

const TEXTO_MAXIMO = 140;
const POR_LISTA_NO_VIDEO = 8;
const POR_TIPO_NO_SETOR: Record<TipoDeVoz, number> = { duvida: 10, objecao: 5, pedido: 5 };

function conferirLista(lista: { texto: string; comentarios: number[] }[], validos: Set<number>): ItemDoPublico[] {
  const usados = new Set<number>();
  const itens: ItemDoPublico[] = [];
  for (const item of lista) {
    const numeros = [...new Set(item.comentarios)].filter((n) => validos.has(n) && !usados.has(n));
    if (numeros.length === 0) continue;
    const texto = limparTextoDoModelo(item.texto, TEXTO_MAXIMO);
    if (!texto) continue;
    for (const n of numeros) usados.add(n);
    itens.push({ texto, vezes: numeros.length });
  }
  // Dois itens que o modelo escreveu iguais (sem olhar maiúscula, acento nem pontuação) são um só: somam.
  const juntos = new Map<string, ItemDoPublico>();
  for (const item of itens) {
    const chave = formaDeComparar(item.texto);
    const atual = juntos.get(chave);
    if (atual) atual.vezes += item.vezes;
    else juntos.set(chave, { ...item });
  }
  return [...juntos.values()].sort((a, b) => b.vezes - a.vezes).slice(0, POR_LISTA_NO_VIDEO);
}

/** A leitura de um vídeo, conferida: números que existem, contagem por código, frases literais conferidas. */
export function conferirLeitura(saida: SaidaLerComentarios, comentarios: ComentarioNumerado[]): ComentariosAnalise {
  const validos = new Set(comentarios.map((c) => c.numero));
  const formaPorNumero = new Map(comentarios.map((c) => [c.numero, formaDeComparar(c.texto)]));

  const frases: string[] = [];
  for (const f of saida.frasesDoPublico) {
    const base = formaPorNumero.get(f.comentario);
    const trecho = limparComentario(f.trecho);
    if (!base || !trecho) continue;
    const forma = formaDeComparar(trecho);
    if (forma.length < 8 || !base.includes(forma)) continue;
    if (frases.some((x) => formaDeComparar(x) === forma)) continue;
    frases.push(trecho);
  }

  return {
    duvidas: conferirLista(saida.duvidas, validos),
    objecoes: conferirLista(saida.objecoes, validos),
    pedidos: conferirLista(saida.pedidos, validos),
    oQueElogiaram: conferirLista(saida.oQueElogiaram, validos),
    frasesDoPublico: frases.slice(0, 5),
    sentimento: saida.sentimento,
    lidos: comentarios.length,
  };
}

/** Um item da leitura de um vídeo, pronto para entrar na junção do setor. */
export type ItemDoVideo = { numero: number; tipo: TipoDeVoz; texto: string; vezes: number; videoId: number };

/** Os itens de dúvida, objeção e pedido das leituras da semana, numerados de 1, na ordem em que vieram. */
export function itensParaJuntar(leituras: { videoId: number; analise: ComentariosAnalise }[]): ItemDoVideo[] {
  const itens: ItemDoVideo[] = [];
  const empilhar = (videoId: number, tipo: TipoDeVoz, lista: ItemDoPublico[]) => {
    for (const i of lista) itens.push({ numero: itens.length + 1, tipo, texto: i.texto, vezes: i.vezes, videoId });
  };
  for (const { videoId, analise } of leituras) {
    empilhar(videoId, "duvida", analise.duvidas);
    empilhar(videoId, "objecao", analise.objecoes);
    empilhar(videoId, "pedido", analise.pedidos);
  }
  return itens;
}

function montarGrupo(membros: ItemDoVideo[], texto: string): VozDoPublico {
  return {
    texto,
    vezes: membros.reduce((soma, m) => soma + m.vezes, 0),
    videos: [...new Set(membros.map((m) => m.videoId))].sort((a, b) => a - b),
  };
}

function ordenar(vozes: VozDoPublico[], maximo: number): VozDoPublico[] {
  return vozes.sort((a, b) => b.vezes - a.vezes || b.videos.length - a.videos.length || a.texto.localeCompare(b.texto)).slice(0, maximo);
}

/** Sem o modelo (falhou ou devolveu lixo): junta só o que é igual, escrito igual (sem acento, sem pontuação, sem maiúscula). */
export function vozesSemOModelo(itens: ItemDoVideo[]): Record<TipoDeVoz, VozDoPublico[]> {
  const grupos = new Map<string, ItemDoVideo[]>();
  for (const i of itens) {
    const chave = `${i.tipo}|${formaDeComparar(i.texto)}`;
    grupos.set(chave, [...(grupos.get(chave) ?? []), i]);
  }
  const saida: Record<TipoDeVoz, VozDoPublico[]> = { duvida: [], objecao: [], pedido: [] };
  for (const membros of grupos.values()) saida[membros[0].tipo].push(montarGrupo(membros, membros[0].texto));
  return { duvida: ordenar(saida.duvida, POR_TIPO_NO_SETOR.duvida), objecao: ordenar(saida.objecao, POR_TIPO_NO_SETOR.objecao), pedido: ordenar(saida.pedido, POR_TIPO_NO_SETOR.pedido) };
}

/**
 * O que o modelo juntou, conferido: só itens que existem, cada item em no máximo um grupo, todos os itens de um grupo do mesmo tipo
 * (o que não é do tipo do grupo fica de fora dele e volta sozinho), e o item que o modelo esqueceu vira grupo de um item só.
 */
export function conferirVozes(saida: SaidaJuntarVozes, itens: ItemDoVideo[]): Record<TipoDeVoz, VozDoPublico[]> {
  const porNumero = new Map(itens.map((i) => [i.numero, i]));
  const usados = new Set<number>();
  const finais: { tipo: TipoDeVoz; voz: VozDoPublico }[] = [];

  for (const g of saida.grupos) {
    const membros = [...new Set(g.itens)]
      .map((n) => porNumero.get(n))
      .filter((i): i is ItemDoVideo => i !== undefined && !usados.has(i.numero) && i.tipo === g.tipo);
    if (membros.length === 0) continue;
    for (const m of membros) usados.add(m.numero);
    const texto = limparTextoDoModelo(g.texto, TEXTO_MAXIMO) ?? membros[0].texto;
    finais.push({ tipo: g.tipo, voz: montarGrupo(membros, texto) });
  }
  for (const i of itens) {
    if (usados.has(i.numero)) continue;
    finais.push({ tipo: i.tipo, voz: montarGrupo([i], i.texto) });
  }

  const por = (tipo: TipoDeVoz) => ordenar(finais.filter((f) => f.tipo === tipo).map((f) => f.voz), POR_TIPO_NO_SETOR[tipo]);
  return { duvida: por("duvida"), objecao: por("objecao"), pedido: por("pedido") };
}

/** "As vozes do público" de um setor, a partir do que já foi juntado e de quantos vídeos e comentários entraram. */
export function montarVozes(juntas: Record<TipoDeVoz, VozDoPublico[]>, totais: { videos: number; comentarios: number }): VozesDoSetor {
  return { duvidas: juntas.duvida, objecoes: juntas.objecao, pedidos: juntas.pedido, videos: totais.videos, comentarios: totais.comentarios };
}
