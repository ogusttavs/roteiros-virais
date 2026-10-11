"use server";

import { ehFicha } from "@/config/fichas";
import type { DestinoDaPesquisa } from "@/db/schema";
import { chaveDeVozValida } from "@/lib/chave-da-voz";
import { idDoBancoOuNulo } from "@/lib/id-rota";
import { type ResultadoAcao } from "@/lib/resultado-acao";
import { recusaDoVerComo, sessaoDoPainel } from "@/lib/ver-como";
import { ErroAcessoNegado, clienteDaSessaoAtual, garantirMembroDaMarca } from "@/servicos/clientes";
import {
  confirmarPesquisa,
  criarPesquisa,
  ErroDoTeto,
  ErroPesquisa,
  lerPesquisa,
  pesquisarDeNovo,
  pesquisaParaATela,
  registrarVistaDoFim,
  type PesquisaDaTela,
  type Profundidade,
} from "@/servicos/pesquisa-na-hora";
import {
  ErroRoteiro,
  validarData,
  validarEstilo,
  validarFormato,
  validarMomentoDoDia,
  validarObjetivo,
  validarQuemAparece,
} from "@/servicos/roteiro";
import { textosPesquisa } from "@/textos/pesquisa";

/** O pedido de pesquisa como ele chega do navegador: o texto livre e o que a tela estava fazendo (o que é conferido aqui antes de gravar). */
export type EntradaDaPesquisa = {
  pedido: string;
  profundidade: Profundidade;
  destino:
    | { tipo: "objetivo"; livre: string; data?: string; noticiaId?: number; noticiaAssuntoId?: number; alta?: string; pergunta?: string }
    | {
        tipo: "momento";
        onde: string;
        oQueEstaAcontecendo: string;
        oQueDaParaMostrar: string;
        objetivo: string;
        ficha?: string;
        formato?: string;
        estilo?: string;
        marcaId?: number;
        transcricao?: string;
        objetivoDoVideo?: string;
        quemAparece?: string;
        data?: string;
        momentoDoDia?: string;
      };
};

const TEXTO_MAXIMO = 4000;
const TRANSCRICAO_MAXIMA = 20000;
/** O assunto do Tema livre vai inteiro ao objetivo (o campo não corta; só o texto que a conferência da premissa lê é cortado, no serviço). */
const TEMA_LIVRE_MAXIMO = 4000;

/**
 * O resultado das ações da pesquisa: como `ResultadoAcao`, com o recado de que a recusa é o teto do dia (`calma`: a tela diz com calma, nunca como erro) e de que ainda cabe a rápida
 * (`soCabeRapida`: a tela oferece a rápida em vez de dizer que acabou).
 */
export type ResultadoDaPesquisa<T> = { ok: true; dado: T } | { ok: false; erro: string; calma?: boolean; soCabeRapida?: boolean };

function recusa(falha: ErroPesquisa | ErroRoteiro): { ok: false; erro: string; calma?: boolean; soCabeRapida?: boolean } {
  if (falha instanceof ErroDoTeto) return { ok: false, erro: falha.message, calma: true, soCabeRapida: falha.soCabeRapida };
  return { ok: false, erro: falha.message };
}

function aparar(valor: unknown, maximo: number): string {
  return typeof valor === "string" ? valor.trim().slice(0, maximo) : "";
}

function opcional(valor: unknown, maximo: number): string | undefined {
  const texto = aparar(valor, maximo);
  return texto === "" ? undefined : texto;
}

/**
 * O destino guardado na pesquisa, reconstruído campo a campo e conferido (o navegador manda texto livre): o que a tela estava fazendo quando a pessoa pediu a pesquisa, para a
 * própria tela da pesquisa levar adiante depois, em qualquer aparelho. Devolve também o assunto do vídeo, que é o que a conferência da premissa compara com os dados.
 */
async function destinoConferido(destino: EntradaDaPesquisa["destino"], usuarioId: string): Promise<{ destino: DestinoDaPesquisa; tema: string }> {
  if (destino.tipo === "objetivo") {
    const livre = aparar(destino.livre, TEMA_LIVRE_MAXIMO);
    if (livre === "") throw new ErroPesquisa("Escreva o assunto do vídeo antes de pesquisar.");
    const consulta: Extract<DestinoDaPesquisa, { tipo: "objetivo" }>["consulta"] = { livre };
    const data = validarData(opcional(destino.data, 10));
    if (data) consulta.data = data;
    const noticiaId = idDoBancoOuNulo(destino.noticiaId);
    if (noticiaId) consulta.noticiaId = String(noticiaId);
    const noticiaAssuntoId = idDoBancoOuNulo(destino.noticiaAssuntoId);
    if (noticiaAssuntoId) consulta.noticiaAssuntoId = String(noticiaAssuntoId);
    const alta = opcional(destino.alta, 120);
    if (alta) consulta.alta = alta;
    const pergunta = chaveDeVozValida(destino.pergunta);
    if (pergunta) consulta.pergunta = pergunta;
    return { destino: { tipo: "objetivo", consulta }, tema: livre };
  }

  const onde = aparar(destino.onde, TEXTO_MAXIMO);
  const oQueEstaAcontecendo = aparar(destino.oQueEstaAcontecendo, TEXTO_MAXIMO);
  const oQueDaParaMostrar = aparar(destino.oQueDaParaMostrar, TEXTO_MAXIMO);
  if (!onde || !oQueEstaAcontecendo || !oQueDaParaMostrar) {
    throw new ErroPesquisa("Conte onde você está, o que está acontecendo e o que dá para mostrar antes de pesquisar.");
  }
  let marcaId: number | undefined;
  if (destino.marcaId !== undefined) {
    const id = idDoBancoOuNulo(destino.marcaId);
    if (id === null) throw new ErroPesquisa("Marca não encontrada.");
    await garantirMembroDaMarca(usuarioId, id);
    marcaId = id;
  }
  const dados: Extract<DestinoDaPesquisa, { tipo: "momento" }>["dados"] = {
    onde,
    oQueEstaAcontecendo,
    oQueDaParaMostrar,
    objetivo: validarObjetivo(destino.objetivo),
  };
  if (ehFicha(destino.ficha)) dados.ficha = destino.ficha;
  const formato = validarFormato(opcional(destino.formato, 20));
  if (formato) dados.formato = formato;
  const estilo = validarEstilo(opcional(destino.estilo, 20));
  if (estilo) dados.estilo = estilo;
  if (marcaId !== undefined) dados.marcaId = marcaId;
  const transcricao = opcional(destino.transcricao, TRANSCRICAO_MAXIMA);
  if (transcricao) dados.transcricao = transcricao;
  const objetivoDoVideo = opcional(destino.objetivoDoVideo, 200);
  if (objetivoDoVideo) dados.objetivoDoVideo = objetivoDoVideo;
  const quemAparece = validarQuemAparece(opcional(destino.quemAparece, 40));
  if (quemAparece) dados.quemAparece = quemAparece;
  const data = validarData(opcional(destino.data, 10));
  if (data) dados.data = data;
  const momentoDoDia = validarMomentoDoDia(opcional(destino.momentoDoDia, 20));
  if (momentoDoDia) dados.momentoDoDia = momentoDoDia;
  return { destino: { tipo: "momento", dados }, tema: `${onde}. ${oQueEstaAcontecendo}. ${oQueDaParaMostrar}` };
}

/**
 * "Pesquisar e escrever": cria a pesquisa (o teto do dia e o tamanho do pedido são conferidos no serviço, nunca na tela) e a deixa na fila. A marca vem sempre da sessão. Os erros
 * esperados voltam como resultado, com a frase pronta (Next troca a mensagem de uma exceção por um texto genérico em produção).
 */
export async function pedirPesquisaAction(entrada: EntradaDaPesquisa): Promise<ResultadoDaPesquisa<{ id: number }>> {
  const recusaVerComo = await recusaDoVerComo();
  if (recusaVerComo) return { ok: false, erro: recusaVerComo };
  const sessao = await sessaoDoPainel();
  if (!sessao) throw new ErroAcessoNegado("E preciso entrar de novo.");
  try {
    const cliente = await clienteDaSessaoAtual();
    const { destino, tema } = await destinoConferido(entrada.destino, sessao.user.id);
    const pesquisa = await criarPesquisa(cliente.id, {
      pedido: entrada.pedido,
      tema,
      profundidade: entrada.profundidade === "aprofundada" ? "aprofundada" : "normal",
      destino,
    });
    return { ok: true, dado: { id: pesquisa.id } };
  } catch (falha) {
    if (falha instanceof ErroPesquisa || falha instanceof ErroRoteiro) return recusa(falha);
    throw falha;
  }
}

/** A pesquisa como a tela a lê (a espera repete esta leitura até ela terminar). Nula quando não é da marca. */
export async function lerPesquisaAction(id: number): Promise<PesquisaDaTela | null> {
  const sessao = await sessaoDoPainel();
  if (!sessao) throw new ErroAcessoNegado("E preciso entrar de novo.");
  const pesquisaId = idDoBancoOuNulo(id);
  if (pesquisaId === null) return null;
  const cliente = await clienteDaSessaoAtual();
  const tela = await pesquisaParaATela(cliente.id, pesquisaId);
  // A pessoa viu a pesquisa terminar sem dado ou em erro: o Criar não precisa mais lembrar dela.
  if (tela && (tela.status === "sem_achados" || tela.status === "erro")) await registrarVistaDoFim(cliente.id, pesquisaId);
  return tela;
}

const DECISOES = ["fontes", "mudar", "manter"] as const;

/**
 * "Escrever com estes N": guarda os dados marcados, o que a pessoa decidiu diante do aviso da premissa e a posição dela, e devolve para onde seguir (o destino guardado na pesquisa).
 * `mudar` não passa por aqui: quem quer mudar o que escreveu volta ao campo.
 */
export async function confirmarPesquisaAction(
  id: number,
  confirmacao: { ids: number[]; decisao?: string | null; posicao?: string | null },
): Promise<ResultadoAcao<{ destino: DestinoDaPesquisa | null }>> {
  const recusaVerComo = await recusaDoVerComo();
  if (recusaVerComo) return { ok: false, erro: recusaVerComo };
  const sessao = await sessaoDoPainel();
  if (!sessao) throw new ErroAcessoNegado("E preciso entrar de novo.");
  const pesquisaId = idDoBancoOuNulo(id);
  if (pesquisaId === null) return { ok: false, erro: textosPesquisa.tela.erroGenerico };
  try {
    const cliente = await clienteDaSessaoAtual();
    const decisao = DECISOES.find((d) => d === confirmacao.decisao) ?? null;
    const resultado = await confirmarPesquisa(cliente.id, pesquisaId, {
      ids: Array.isArray(confirmacao.ids) ? confirmacao.ids.filter((n) => Number.isInteger(n)) : [],
      decisao,
      posicao: typeof confirmacao.posicao === "string" ? confirmacao.posicao.slice(0, 600) : null,
    });
    return { ok: true, dado: resultado };
  } catch (falha) {
    if (falha instanceof ErroPesquisa) return { ok: false, erro: falha.message };
    throw falha;
  }
}

/**
 * "Pesquisar de novo" e "Tentar de novo": a mesma pesquisa numa linha nova (passa pelo teto do dia como qualquer outra). `profundidade: "normal"` é a pessoa pedindo a rápida quando só
 * ela cabe; qualquer outro valor vale como "o mesmo tamanho de antes".
 */
export async function pesquisarDeNovoAction(id: number, profundidade?: string): Promise<ResultadoDaPesquisa<{ id: number }>> {
  const recusaVerComo = await recusaDoVerComo();
  if (recusaVerComo) return { ok: false, erro: recusaVerComo };
  const sessao = await sessaoDoPainel();
  if (!sessao) throw new ErroAcessoNegado("E preciso entrar de novo.");
  const pesquisaId = idDoBancoOuNulo(id);
  if (pesquisaId === null) return { ok: false, erro: textosPesquisa.tela.erroGenerico };
  try {
    const cliente = await clienteDaSessaoAtual();
    // A pesquisa tem de ser desta marca (`pesquisarDeNovo` lê com o escopo da marca).
    if (!(await lerPesquisa(cliente.id, pesquisaId))) return { ok: false, erro: textosPesquisa.tela.erroGenerico };
    const nova = await pesquisarDeNovo(cliente.id, pesquisaId, { profundidade: profundidade === "normal" ? "normal" : undefined });
    return { ok: true, dado: { id: nova.id } };
  } catch (falha) {
    if (falha instanceof ErroPesquisa) return recusa(falha);
    throw falha;
  }
}
