"use client";

import {
  ArrowLeft,
  Copy,
  Check,
  Download,
  Ellipsis,
  Eye,
  HelpCircle,
  History,
  ImageDown,
  Mic,
  Music,
  Newspaper,
  Pencil,
  Play,
  RotateCcw,
  Scissors,
  Search,
  Sparkles,
  TrendingUp,
  Type,
  Video,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type MouseEvent as EventoMouse,
} from "react";

import { COMPLEMENTO_PARA_QUE, fichaDoRoteiro, ROTULO_PARA_QUE } from "@/config/fichas";
import { seloDoTipo } from "@/config/formatos";
import { MOTIVOS_REPROVACAO, type IdMotivoReprovacao } from "@/config/motivos-reprovacao";
import type { CartaoStory, ConteudoRoteiro } from "@/db/schema";
import { ROTULO_FIGURINHA } from "@/ia/enums";
import { baixarArquivo, guardarImagens, pedirImagensDoRoteiro, pedirPdfDoRoteiro } from "@/lib/exportar-roteiro";
import { classificarMultiplo, formatarMultiplo, rotuloMultiploConta } from "@/lib/formatarNumero";
import { BLOCOS_FALADOS, marcadoParaOsParagrafos, paragrafosMarcados, type FalaDoRoteiro } from "@/lib/marcas-de-fala";
import { ehFalhaDeRede } from "@/lib/offline";
import type { MomentoDoRoteiro } from "@/servicos/em-alta";
import type { VideoParaEmbed } from "@/servicos/pesquisa";
import type { RoteiroLinha, VersaoRoteiro } from "@/servicos/roteiro";
import { textosComuns } from "@/textos/comuns";
import { textosConexao } from "@/textos/conexao";
import { textosGravacao } from "@/textos/gravacao";
import { textosMarcasDeFala } from "@/textos/marcas-de-fala";
import { textosRoteiro } from "@/textos/roteiro";
import { AreaTexto } from "@/ui/componentes/AreaTexto";
import { BarraTopo } from "@/ui/componentes/BarraTopo";
import { BlocoCenas } from "@/ui/componentes/BlocoCenas";
import { BlocoEdicao, type ItemEdicao } from "@/ui/componentes/BlocoEdicao";
import { CampoComFala } from "@/ui/componentes/CampoComFala";
import { CartaoDeOndeVeio } from "@/ui/componentes/CartaoDeOndeVeio";
import { TrilhoDaChave } from "@/ui/componentes/ChaveLiga";
import chipStyles from "@/ui/componentes/Chips.module.css";
import { ConviteInstalar } from "@/ui/componentes/ConviteInstalar";
import { LinhaMarcasDeFala } from "@/ui/componentes/LinhaMarcasDeFala";
import { MotivoSemRede } from "@/ui/componentes/MotivoSemRede";
import { PainelFlutuante } from "@/ui/componentes/PainelFlutuante";
import { RoteiroTexto, type BlocoRoteiro } from "@/ui/componentes/RoteiroTexto";
import { TelaReescrevendo } from "@/ui/componentes/TelaReescrevendo";
import { Toast } from "@/ui/componentes/Toast";
import { VideoEmbed } from "@/ui/componentes/VideoEmbed";
import { ID_FAIXA_SEM_CONEXAO, useConexao, useTratarFalha } from "@/ui/ConexaoContext";
import { useFolhaNoHistorico } from "@/ui/useFolhaNoHistorico";

import { SeletorMarcaCelular, type MarcaResumo } from "../../../_casca/SeletorMarcaCelular";

import {
  marcarGravadoAction,
  marcarPostadoAction,
  reprovarERescreverAction,
  salvarEdicaoAction,
} from "./acoes";
import styles from "./RoteiroTela.module.css";
import { useMarcasDeFala } from "./useMarcasDeFala";

function formatarData(dataISO: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "numeric",
    month: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(`${dataISO}T12:00:00`));
}

function formatarHora(data: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(data);
}

function formatarSegundo(segundo: number): string {
  const minutos = Math.floor(segundo / 60);
  const restante = Math.floor(segundo % 60);
  return `${minutos}:${String(restante).padStart(2, "0")}`;
}

/** "7 de setembro" (E27, parte 1, bloco de versões: "você reprovou por... em D de mês"). */
function formatarDataPorExtenso(data: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "numeric",
    month: "long",
    timeZone: "America/Sao_Paulo",
  }).format(data);
}

/** "X e Y" com dois itens, "X, Y e Z" com três ou mais (E27, parte 1, motivos da reprovação). */
function listaComE(itens: string[]): string {
  if (itens.length <= 1) return itens[0] ?? "";
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

function itensEdicao(edicao: ConteudoRoteiro["edicao"]): ItemEdicao[] {
  const textoNaTela =
    edicao.textoNaTela.length > 0
      ? edicao.textoNaTela.map((item) => `${item.quando}, "${item.oQue}", ${item.onde}`).join("; ")
      : textosRoteiro.edicao.semTexto;
  const recursos =
    edicao.recursos.length > 0 ? edicao.recursos.join("; ") : textosRoteiro.edicao.semRecurso;

  return [
    { icone: Type, rotulo: textosRoteiro.edicao.texto, texto: textoNaTela },
    { icone: Scissors, rotulo: textosRoteiro.edicao.corte, texto: edicao.ritmoDeCorte },
    { icone: Eye, rotulo: textosRoteiro.edicao.recursos, texto: recursos },
    {
      icone: Music,
      rotulo: textosRoteiro.edicao.audio,
      texto: edicao.audio ?? textosRoteiro.edicao.semAudio,
    },
  ];
}

/** "a, b e c" (os rótulos dos motivos, com a primeira letra em minúscula, no meio de uma frase). */
function juntarMotivos(motivos: string[]): string {
  const minusculos = motivos.map((m) => m.charAt(0).toLowerCase() + m.slice(1));
  if (minusculos.length <= 1) return minusculos.join("");
  return `${minusculos.slice(0, -1).join(", ")} e ${minusculos[minusculos.length - 1]}`;
}

function textoParaCopiar(blocos: BlocoRoteiro[]): string {
  return blocos.map((bloco) => bloco.paragrafos.join("\n")).join("\n\n");
}

/** V9c, item 4: o que mostrar, o texto na tela e a figurinha de um cartão, no lugar do "Como editar" de Reels. */
function itensCartaoStory(cartao: CartaoStory): ItemEdicao[] {
  return [
    { icone: Eye, rotulo: textosRoteiro.cartaoStory.oQueMostrar, texto: cartao.oQueMostrar },
    { icone: Type, rotulo: textosRoteiro.cartaoStory.textoNaTela, texto: cartao.textoNaTela },
    {
      icone: Sparkles,
      rotulo: textosRoteiro.cartaoStory.figurinha,
      texto:
        cartao.figurinha === "nenhuma"
          ? textosRoteiro.cartaoStory.semFigurinha
          : ROTULO_FIGURINHA[cartao.figurinha],
    },
  ];
}

/** M4, item 5: o que mostrar e o texto na tela de uma cena sem fala; nunca "o que falar" nem figurinha. */
function itensCartaoSemFala(cartao: CartaoStory): ItemEdicao[] {
  return [
    { icone: Eye, rotulo: textosRoteiro.cartaoSemFala.oQueMostrar, texto: cartao.oQueMostrar },
    { icone: Type, rotulo: textosRoteiro.cartaoSemFala.textoNaTela, texto: cartao.textoNaTela },
  ];
}

/** V9c, item 4: "Por que assim", uma linha por regra que o modelo seguiu (`corpo.porQueAssim`). */
function itensPorQueAssim(porQueAssim: ConteudoRoteiro["porQueAssim"]): ItemEdicao[] {
  return porQueAssim.map((item) => ({
    icone: HelpCircle,
    rotulo: "",
    texto: item.motivo,
    mono: item.regra,
  }));
}

/** "O que funcionou ali:" mais a análise, que vem de um campo com maiúscula (design v2, achado do iPad, item 2). */
function comInicialMinuscula(texto: string): string {
  return texto.length > 0 ? texto[0].toLowerCase() + texto.slice(1) : texto;
}

/** E40, item 1: o rascunho de edição, um campo por bloco; `cartoes` fica vazio em Reels falado. */
type DraftEdicao = {
  gancho: string;
  corpo: string;
  fechamento: string;
  chamadaFinal: string;
  cartoes: { oQueFalar: string; oQueMostrar: string; textoNaTela: string }[];
  legenda: string;
};

function draftDoConteudo(corpo: ConteudoRoteiro): DraftEdicao {
  return {
    gancho: corpo.gancho,
    corpo: corpo.corpo,
    fechamento: corpo.fechamento,
    chamadaFinal: corpo.chamadaFinal,
    cartoes: (corpo.cartoes ?? []).map((cartao) => ({
      oQueFalar: cartao.oQueFalar,
      oQueMostrar: cartao.oQueMostrar,
      textoNaTela: cartao.textoNaTela,
    })),
    legenda: corpo.legenda ?? "",
  };
}

/**
 * O link do vídeo postado como vai para o banco (V7, item 4 do PROXIMO.md): sem
 * `https://` no começo (link colado pela metade) ele vira `<a href>` relativo e
 * abre uma página que não existe, então o começo é acrescentado; e só passa o que
 * tem cara de endereço de site (com ponto no nome, sem usuário e senha). Devolve
 * `null` quando não dá para aproveitar. O servidor não confere nada disto.
 */
function normalizarLink(texto: string): string | null {
  const limpo = texto.trim();
  if (!limpo) return null;
  const comEsquema = /^https?:\/\//i.test(limpo) ? limpo : `https://${limpo}`;
  try {
    const url = new URL(comEsquema);
    if (!url.hostname.includes(".") || url.username || url.password) return null;
    return comEsquema;
  } catch {
    return null;
  }
}

/** Depois de quanto tempo escrevendo o painel "reprovar" avisa que ainda trabalha (mesmo limiar de `ObjetivoTela`). */
const LIMIAR_DEMORANDO_MS = 10000;
const ID_ERRO_POSTEI = "erro-postei";

type Painel = "menu" | "postei" | "reprovar" | "versoes" | null;

type Props = {
  roteiro: RoteiroLinha;
  corpo: ConteudoRoteiro;
  /** Os blocos de leitura, já montados no servidor (`blocosParaLeitura`, `servicos/roteiro.ts`): reels ou story. */
  blocos: BlocoRoteiro[];
  video: VideoParaEmbed | null;
  versoes: VersaoRoteiro[];
  /** E55 PR 2b: o assunto em alta de onde o roteiro nasceu (nulo nos outros): o selo, a linha de prazo ou o aviso de que passou, e o "De onde veio" próprio. */
  momento?: MomentoDoRoteiro | null;
  /** E26 4b: o grupo de versões de que o roteiro nasceu (e quantas tinha); nulo nos que não vieram de uma comparação. */
  grupoDeVersoes?: { grupo: string; total: number } | null;
  /** E53 (parte 3): a notícia de onde o roteiro veio (do setor ou de um assunto da marca), com o link revalidado; nula nos outros. */
  noticiaDeOrigem?: { titulo: string; veiculo: string; url: string | null; dia: string | null } | null;
  /**
   * E41 parte 2b: a fala marcada. `podeMarcar` é falso em Story e em vídeo sem fala (nada para marcar); `somenteLeitura` é o "ver como" (mostra as marcas que já existem, não escreve);
   * `marcas` são as que já existem e ainda valem para o texto de agora.
   */
  fala: FalaDoRoteiro;
  /** O seletor de marca na barra do topo, só no celular (V3, item 3, Roteiro.dc.html). */
  marcaAtiva: MarcaResumo;
  marcas: MarcaResumo[];
  nomePessoa: string;
  /** E48 PR 1: o servidor diz que o convite de instalar o aplicativo pode aparecer (não instalou e o "agora não" não vale mais). */
  conviteInstalarPodeAparecer: boolean;
};

/**
 * `/roteiros/[id]` (design v2, `entrega/telas/Roteiro.dc.html`; `PROXIMO.md`,
 * D2 parte 1, item 6). Modo gravação virou rota própria
 * (`/roteiros/[id]/gravar`, item 7): o botão daqui só navega.
 */
export function RoteiroTela({
  roteiro,
  corpo,
  blocos,
  video,
  versoes,
  momento = null,
  grupoDeVersoes = null,
  noticiaDeOrigem = null,
  fala,
  marcaAtiva,
  marcas,
  nomePessoa,
  conviteInstalarPodeAparecer,
}: Props) {
  const router = useRouter();
  const [gravadoEm, setGravadoEm] = useState(roteiro.gravadoEm);
  const [postado, setPostado] = useState(roteiro.status === "postado");
  const [urlPostado, setUrlPostado] = useState(roteiro.urlPostado ?? "");
  const [painel, setPainel] = useState<Painel>(null);
  const botaoMenuRef = useRef<HTMLButtonElement>(null);
  const [urlDigitada, setUrlDigitada] = useState("");
  const [erroPostei, setErroPostei] = useState<string | null>(null);
  const [motivosSelecionados, setMotivosSelecionados] = useState<Set<IdMotivoReprovacao>>(
    new Set(),
  );
  const [motivoTexto, setMotivoTexto] = useState("");
  const [erroReprovar, setErroReprovar] = useState<string | null>(null);
  // O momento que volta preenchido: só para o roteiro que nasceu do que a pessoa contou e ainda tem o texto guardado.
  const reescreverMomentoHref = roteiro.origem === "momento" && roteiro.momento ? `/criar?momento=${roteiro.id}` : null;
  const [demorando, setDemorando] = useState(false);
  const [versoesDesatualizadas, setVersoesDesatualizadas] = useState(false);
  const [toast, setToast] = useState(false);
  /** V11, item 5: "Terminei de gravar" no modo gravação manda para cá com `?gravado=1` (o roteiro já vem gravado do servidor; isto é só o toast). */
  const [toastGravado, setToastGravado] = useState(false);
  /** E40, item 1: depois de salvar uma edição manual. */
  const [toastSalvo, setToastSalvo] = useState(false);
  /** A frase de falha de uma ação sem painel aberto ("Já gravei", o PDF da barra do tablet): sai num Toast de erro. */
  const [erroToast, setErroToast] = useState<string | null>(null);
  /** A frase de falha de "Copiar texto" e "Baixar em PDF" quando o menu está aberto: sai dentro dele. */
  const [erroMenu, setErroMenu] = useState<string | null>(null);
  const [baixandoPdf, setBaixandoPdf] = useState(false);
  /** E26 (passo 23): o PDF pronto, com o endereço para "Abrir" (a pessoa que não viu o download cair, no iPad), e a imagem 9:16 sendo gerada ou já guardada. */
  const [toastPdf, setToastPdf] = useState(false);
  const enderecoDoPdf = useRef<string | null>(null);
  const [guardandoImagem, setGuardandoImagem] = useState(false);
  const [imagemPronta, setImagemPronta] = useState(false);
  /** As imagens prontas que esperam o segundo toque ("Guardar"), quando o aparelho só deixa compartilhar logo depois de um toque (o iPhone). */
  const [imagensParaGuardar, setImagensParaGuardar] = useState<File[] | null>(null);
  // O endereço do PDF pronto vive enquanto a tela estiver aberta (o "Abrir" do toast pode ser tocado depois do download) e é solto ao sair.
  useEffect(
    () => () => {
      if (enderecoDoPdf.current) URL.revokeObjectURL(enderecoDoPdf.current);
    },
    [],
  );
  /** E40, item 1: liga o modo de edição; `draft` só existe enquanto ele está ligado. */
  const [editando, setEditando] = useState(false);
  /** "Como editar" (e, junto dele, "Por que assim") na caixa do lado: só no Reels falado em leitura; em Story, sem fala e em edição, "Por que assim" fica sozinho depois da legenda. */
  const comoEditarNoLado = !editando && !(roteiro.estilo === "sem_fala" && corpo.cartoes) && !(roteiro.formato === "story" && corpo.cartoes);
  const [draft, setDraft] = useState<DraftEdicao | null>(null);
  const [erroEdicao, setErroEdicao] = useState<string | null>(null);
  // Uma transição por ação (V7, item 4 do PROXIMO.md): com uma só, "Já gravei" ficava morto e sem motivo
  // durante os até 3 minutos de uma reescrita, e o rótulo "Salvando" aparecia nele sem ser dele.
  const [gravando, iniciarGravacao] = useTransition();
  const [salvandoLink, iniciarSalvarLink] = useTransition();
  const [reescrevendo, iniciarReescrita] = useTransition();
  const [salvandoEdicao, iniciarSalvarEdicao] = useTransition();
  const { semConexao, avisarRedeOk } = useConexao();
  const tratarFalha = useTratarFalha();

  // E41 parte 2b: as marcas de fala. Desligadas por padrão no roteiro (a chave do aparelho); ao abrir, o pedido das marcas corre em segundo plano para o modo gravação encontrá-las
  // prontas, sem a pessoa esperar nada. Ligar a chave sem as marcas prontas mostra a claquete e "Marcando a fala", com o texto à vista.
  const [marcasLigadas, setMarcasLigadas] = useState(false);
  const chaveDoTexto = [corpo.gancho, corpo.corpo, corpo.fechamento, corpo.chamadaFinal].join("\u0001");
  const { marcas: marcasProntas, estado: estadoMarcas, erro: erroMarcas, pedir: pedirMarcas } = useMarcasDeFala(roteiro.id, fala, chaveDoTexto);
  useEffect(() => {
    pedirMarcas({ emSegundoPlano: true });
  }, [pedirMarcas, chaveDoTexto]);
  function trocarMarcas(ligar: boolean) {
    setMarcasLigadas(ligar);
    if (ligar) pedirMarcas();
  }
  const mostrarMarcas = marcasLigadas && marcasProntas !== null;
  const blocosVisiveis: BlocoRoteiro[] = mostrarMarcas
    ? blocos.map((bloco, indice) => {
        const nome = BLOCOS_FALADOS[indice];
        const marcado = nome ? marcadoParaOsParagrafos(bloco.paragrafos, paragrafosMarcados(marcasProntas, nome)) : null;
        return marcado ? { ...bloco, marcado, tom: marcasProntas.blocos.find((b) => b.bloco === nome)?.tom } : bloco;
      })
    : blocos;
  const temChaveDeMarcas = fala.podeMarcar && (!fala.somenteLeitura || fala.marcas !== null);
  // E41 2c: "No PDF e na imagem, com as marcas de fala", no menu "Mais opções": desligada por padrão, vale para o PDF e para a imagem (as marcas que ainda não existem são escritas na hora do pedido).
  const [exportarComMarcas, setExportarComMarcas] = useState(false);
  /** O PDF ou a imagem saíram sem as marcas que a pessoa pediu: a frase de um toque só, no lugar do "pronto". */
  const [avisoSemMarcas, setAvisoSemMarcas] = useState<{ texto: string; abrirPdf: boolean } | null>(null);
  const pedirComMarcas = exportarComMarcas && temChaveDeMarcas;
  /** Igual a `reescrevendo`, mas lido na hora nos fechamentos e solto antes de navegar (o estado só solta no fim). */
  const reescritaEmCursoRef = useRef(false);
  /** Qual painel está aberto agora: uma ação que termina depois precisa saber se o painel dela ainda está na tela. */
  const painelAbertoRef = useRef<Painel>(null);
  useEffect(() => {
    painelAbertoRef.current = painel;
  });

  /**
   * V15, achado da revisão do Fable: "De onde veio" e "Como editar" são dois blocos do
   * lado com altura própria, cada um; a grade de CSS tem um único cursor de linha
   * compartilhado entre coluna e lado (`RoteiroTela.module.css`, comentário de
   * `.corpoComLado`), e não existe jeito puro de CSS de empilhar os dois sem acoplar a
   * altura de um deles à coluna de leitura (testado e medido: ou a coluna espera "De
   * onde veio" terminar antes do primeiro parágrafo, ou "Como editar" sobrepõe "De onde
   * veio"). Mede a altura real de "De onde veio" para "Como editar" começar exatamente
   * ali, nem sobrepondo nem deixando vazio; `ResizeObserver`, não só no primeiro render,
   * porque o texto de "De onde veio" pode mudar de altura (reescrever, trocar versão).
   */
  // Callback, não objeto: o bloco de "De onde veio" é uma <div> (o cartão) ou uma <section>
  // (sem evidência), e os dois tipos de ref do React não se misturam num RefObject só.
  const refDeOndeVeio = useRef<HTMLElement | null>(null);
  const definirRefDeOndeVeio = useCallback((elemento: HTMLElement | null) => {
    refDeOndeVeio.current = elemento;
  }, []);
  const refCorpoComLado = useRef<HTMLDivElement>(null);
  /**
   * R1, acabamento (achado do Gustavo, repassado pela Fable): "Como editar" começava rente a "De
   * onde veio", sem respiro nenhum entre os dois. `margin-top` aqui é sempre a altura medida de
   * "De onde veio" (nunca a margem de verdade, que não entra em nenhuma medida de caixa); o
   * espaço do design, `--espaco-6`, soma na altura só quando "De onde veio" de fato existe, senão
   * "Como editar" ganharia um respiro do nada no caso sem referência nenhuma
   * (`corpo.semEvidencia` falso e `edicao.referencia` nulo, mais comum desde a H4).
   * `getComputedStyle` devolve o texto do token ("1.5rem"), não o pixel resolvido: o cálculo lê
   * o tamanho de fonte da raiz e transforma rem em pixel, o jeito padrão de resolver isso em
   * tempo de execução.
   */
  const espacoLadoPx = useCallback(() => {
    const remPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const espacamento = getComputedStyle(document.documentElement).getPropertyValue("--espaco-6");
    const emRem = parseFloat(espacamento);
    return Number.isFinite(emRem) ? emRem * remPx : 0;
  }, []);
  useLayoutEffect(() => {
    const corpo = refCorpoComLado.current;
    const elemento = refDeOndeVeio.current;
    if (!corpo) return;
    if (!elemento) {
      corpo.style.setProperty("--altura-de-onde-veio", "0px");
      return;
    }
    const observador = new ResizeObserver(([entrada]) => {
      corpo.style.setProperty("--altura-de-onde-veio", `${entrada.contentRect.height + espacoLadoPx()}px`);
    });
    observador.observe(elemento);
    return () => observador.disconnect();
  });

  /**
   * V11, item 5: "Terminei de gravar" chega aqui com `?gravado=1` na URL; o `gravadoEm` já veio
   * certo do servidor (a página é nova, não uma navegação suave), isto só mostra o toast e limpa
   * a marca da URL, para um F5 depois não mostrar de novo.
   */
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("gravado") !== "1") return;
    setToastGravado(true);
    router.replace(`/roteiros/${roteiro.id}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só na primeira renderização, a URL de chegada.
  }, []);

  const versaoAtual = versoes.find((v) => v.id === roteiro.id);
  const idVersaoAtual = versoes.find((v) => v.atual)?.id;
  /** A versão anterior, se foi reprovada com motivos: é por causa dela que este roteiro foi refeito. */
  const versaoReprovada = versoes.find((v) => v.versao === roteiro.versao - 1 && v.reprovadoEm !== null && v.motivos && v.motivos.length > 0) ?? null;
  const descricaoSemRede = semConexao ? ID_FAIXA_SEM_CONEXAO : undefined;

  /**
   * O que fecha o painel (só o estado): o gancho do histórico chama daqui, e o Voltar do aparelho já desfez a
   * entrada dele (V7, item 1 do PROXIMO.md). Devolve o foco ao botão que abriu o painel, do jeito que um menu ou
   * uma folha deve fechar.
   */
  function fecharPainel() {
    // Voltar do aparelho com a reescrita rodando: o painel fica, porque só ele mostra o andamento. Devolver
    // `false` faz o gancho pôr de volta a entrada do histórico, e o próximo Voltar continua fechando.
    if (reescritaEmCursoRef.current) return false;
    setPainel(null);
    botaoMenuRef.current?.focus();
  }
  const { fechar, fecharENavegar } = useFolhaNoHistorico(painel !== null, fecharPainel);

  /** O que os painéis recebem para fechar: com a reescrita rodando, véu, Esc, Cancelar e arrastar não fecham. */
  function fecharSeLivre() {
    if (reescritaEmCursoRef.current) return;
    fechar();
  }

  const fecharToastErro = useCallback(() => setErroToast(null), []);

  useEffect(() => {
    if (!reescrevendo) {
      setDemorando(false);
      return;
    }
    const id = setTimeout(() => setDemorando(true), LIMIAR_DEMORANDO_MS);
    return () => clearTimeout(id);
  }, [reescrevendo]);

  // A reescrita caiu por rede: a versão nova pode ter sido criada mesmo assim. A lista de versões só é recarregada
  // quando a conexão volta, porque sem rede o `refresh` do Next cai para recarregar a página inteira, e o que a
  // pessoa marcou no painel se perderia.
  // Com o painel aberto também espera: a lista de versões só aparece com ele fechado, então nada fica
  // desatualizado à vista, e o `refresh` não mexe no histórico com a folha aberta.
  useEffect(() => {
    if (!versoesDesatualizadas || semConexao || painel !== null) return;
    setVersoesDesatualizadas(false);
    router.refresh();
  }, [versoesDesatualizadas, semConexao, painel, router]);

  function gravei() {
    setErroToast(null);
    iniciarGravacao(async () => {
      try {
        await marcarGravadoAction(roteiro.id);
        setGravadoEm(new Date());
        avisarRedeOk();
      } catch (erro) {
        setErroToast(
          tratarFalha(
            erro,
            textosRoteiro.erroMarcarGravado,
            textosRoteiro.erroMarcarGravadoSemRede,
          ),
        );
      }
    });
  }

  function salvarPostado(evento: FormEvent<HTMLFormElement>) {
    // O formulário existe para o Enter do teclado do celular salvar; quem confere o link é `normalizarLink`.
    evento.preventDefault();
    if (salvandoLink || semConexao) return;
    if (!urlDigitada.trim()) {
      setErroPostei(textosRoteiro.linkVazio);
      return;
    }
    const link = normalizarLink(urlDigitada);
    if (!link) {
      setErroPostei(textosRoteiro.linkInvalido);
      return;
    }
    setErroPostei(null);
    iniciarSalvarLink(async () => {
      try {
        await marcarPostadoAction(roteiro.id, link);
        setPostado(true);
        setGravadoEm((atual) => atual ?? new Date());
        setUrlPostado(link);
        avisarRedeOk();
        // Só fecha se o painel do "Postei" ainda está na tela (a pessoa pode ter aberto outro enquanto salvava).
        if (painelAbertoRef.current === "postei") fechar();
      } catch (erro) {
        // Salvar CRIA a linha do vídeo: se a conexão caiu, o servidor pode ter gravado antes de a resposta chegar.
        setErroPostei(
          tratarFalha(erro, textosRoteiro.erroSalvarLink, textosConexao.conexaoCaiuNoMeio),
        );
      }
    });
  }

  function alternarMotivo(id: IdMotivoReprovacao) {
    setMotivosSelecionados((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return proximo;
    });
  }

  function reprovarRoteiro() {
    if (motivosSelecionados.size === 0 || semConexao) return;
    setErroReprovar(null);
    reescritaEmCursoRef.current = true;
    iniciarReescrita(async () => {
      try {
        const { id } = await reprovarERescreverAction(
          roteiro.id,
          [...motivosSelecionados],
          motivoTexto.trim() || undefined,
        );
        reescritaEmCursoRef.current = false;
        avisarRedeOk();
        // Fecha o painel e só então navega, trocando a entrada empurrada pelo destino (sem entrada fantasma no
        // histórico, sem `history.back()` competindo com o `router.replace`), e só se a pessoa ainda está neste
        // roteiro: se ela saiu enquanto a reescrita rodava, o roteiro novo está na lista de versões e no Histórico.
        fecharENavegar(() => {
          if (window.location.pathname === `/roteiros/${roteiro.id}`)
            router.replace(`/roteiros/${id}`);
        });
      } catch (erro) {
        reescritaEmCursoRef.current = false;
        // Reescrever CRIA a versão nova: se a conexão caiu, ela pode já existir.
        setErroReprovar(
          tratarFalha(erro, textosRoteiro.reprovar.erro, textosConexao.conexaoCaiuNoMeio),
        );
        if (ehFalhaDeRede(erro)) setVersoesDesatualizadas(true);
      }
    });
  }

  /** E40, item 1: libera o texto de cada bloco para edição, sem chamar IA. */
  function iniciarEdicao() {
    setDraft(draftDoConteudo(corpo));
    setErroEdicao(null);
    setEditando(true);
  }

  function cancelarEdicao() {
    setEditando(false);
    setDraft(null);
    setErroEdicao(null);
  }

  function salvarEdicao() {
    if (!draft || salvandoEdicao || semConexao) return;
    setErroEdicao(null);
    iniciarSalvarEdicao(async () => {
      try {
        await salvarEdicaoAction(roteiro.id, {
          gancho: draft.gancho,
          corpo: draft.corpo,
          fechamento: draft.fechamento,
          chamadaFinal: draft.chamadaFinal,
          cartoes: corpo.cartoes ? draft.cartoes : undefined,
          legenda: corpo.legenda !== undefined ? draft.legenda : undefined,
        });
        avisarRedeOk();
        setEditando(false);
        setDraft(null);
        setToastSalvo(true);
        router.refresh();
      } catch (erro) {
        setErroEdicao(
          tratarFalha(erro, textosRoteiro.editando.erro, textosConexao.conexaoCaiuNoMeio),
        );
      }
    });
  }

  /** A lista de versões navega para outro roteiro: fecha o painel antes, para o Voltar não pedir dois toques. */
  function irParaVersao(evento: EventoMouse<HTMLAnchorElement>, id: number) {
    // Com Ctrl, Cmd, Shift, Alt ou o botão do meio a pessoa quer outra aba: deixa o navegador fazer.
    if (evento.metaKey || evento.ctrlKey || evento.shiftKey || evento.altKey || evento.button !== 0)
      return;
    evento.preventDefault();
    fecharENavegar(() => router.replace(`/roteiros/${id}`));
  }

  async function copiarTexto() {
    setErroMenu(null);
    try {
      // A cópia é do aparelho e não chama o servidor: funciona sem rede, e um erro aqui nunca é de rede
      // (por isso a frase fixa em vez de `tratarFalha`, que trataria "sem rede" como falha de conexão).
      await navigator.clipboard.writeText(textoParaCopiar(blocos));
      fechar();
      setToast(true);
    } catch {
      setErroMenu(textosRoteiro.erroCopiar);
    }
  }

  /** M4, item 5: copia só a legenda do post (o cartão próprio, fora do menu); mesmo toast de `copiarTexto`. */
  async function copiarLegenda() {
    if (!corpo.legenda) return;
    try {
      await navigator.clipboard.writeText(corpo.legenda);
      setToast(true);
    } catch {
      setErroToast(textosRoteiro.erroCopiar);
    }
  }

  async function baixarPdf() {
    if (baixandoPdf || semConexao) return;
    setBaixandoPdf(true);
    setErroMenu(null);
    setErroToast(null);
    try {
      // Login vencido volta como a página de entrada com status 200: só serve o que veio como PDF de verdade.
      let semMarcas = false;
      const pdf = await pedirPdfDoRoteiro(roteiro.id, { comMarcas: pedirComMarcas, aoNaoDarParaMarcar: () => (semMarcas = true) });
      // Mesmo nome que a rota manda em `Content-Disposition`.
      baixarArquivo(pdf, `roteiro-${roteiro.data}.pdf`);
      // E26 (passo 23): o toast "PDF do roteiro pronto, Abrir" fica para quem não viu o download cair (o iPad abre o arquivo em outra aba).
      if (enderecoDoPdf.current) URL.revokeObjectURL(enderecoDoPdf.current);
      enderecoDoPdf.current = URL.createObjectURL(pdf);
      // Sem as marcas pedidas: a frase com o "Abrir" no lugar do "PDF pronto".
      if (semMarcas) setAvisoSemMarcas({ texto: textosMarcasDeFala.erros.pdfSemMarcas, abrirPdf: true });
      else setToastPdf(true);
      avisarRedeOk();
      if (painelAbertoRef.current === "menu") fechar();
    } catch (erro) {
      const frase = tratarFalha(erro, textosRoteiro.erroPdf, textosRoteiro.erroPdfSemRede);
      // Dentro do menu se ele ainda está aberto (foi de lá que a pessoa tocou); senão num Toast.
      if (painelAbertoRef.current === "menu") setErroMenu(frase);
      else setErroToast(frase);
    } finally {
      setBaixandoPdf(false);
    }
  }

  /** E26 (passo 23): "Guardar como imagem no celular", o roteiro inteiro em 9:16 (a rota `/imagem` gera, o aparelho decide entre a folha de compartilhar e o download). */
  async function guardarImagem() {
    if (guardandoImagem || semConexao) return;
    setGuardandoImagem(true);
    setErroMenu(null);
    setErroToast(null);
    try {
      let semMarcas = false;
      const arquivos = await pedirImagensDoRoteiro(roteiro.id, { comMarcas: pedirComMarcas, aoNaoDarParaMarcar: () => (semMarcas = true) });
      avisarRedeOk();
      if (painelAbertoRef.current === "menu") fechar();
      // O "gerando" acaba aqui: a folha de compartilhar pode ficar aberta o quanto a pessoa quiser, e o menu não deve dizer "Gerando a imagem" enquanto isso.
      setGuardandoImagem(false);
      // Compartilhar: a própria folha do aparelho é o aviso; só o download pede o toast, e o aparelho que exige um toque novo recebe o toast com "Guardar".
      const resultado = await guardarImagens(arquivos);
      if (resultado === "precisaDeToque") setImagensParaGuardar(arquivos);
      else if (semMarcas) setAvisoSemMarcas({ texto: textosMarcasDeFala.erros.imagemSemMarcas, abrirPdf: false });
      else if (resultado === "baixado") setImagemPronta(true);
    } catch (erro) {
      const frase = tratarFalha(erro, textosRoteiro.erroImagem, textosRoteiro.erroImagemSemRede);
      if (painelAbertoRef.current === "menu") setErroMenu(frase);
      else setErroToast(frase);
    } finally {
      setGuardandoImagem(false);
    }
  }

  const referencia = corpo.edicao.referencia;

  return (
    <div className={[styles.pagina, semConexao ? styles.semRede : ""].filter(Boolean).join(" ")}>
      <BarraTopo
        titulo={textosRoteiro.tituloTela}
        esquerda={
          <Link href="/hoje" aria-label={textosComuns.voltar} className={styles.botaoBarra}>
            <ArrowLeft size={20} strokeWidth={1.75} aria-hidden="true" />
          </Link>
        }
        direita={
          <>
            <SeletorMarcaCelular marcaAtiva={marcaAtiva} marcas={marcas} nomePessoa={nomePessoa} />
            {/* Some no celular, fica no tablet e no desktop (design v2, Roteiro.dc.html mostra
                nos dois lugares; PROXIMO.md, revisão do PR #31, item 7: "sai da barra do topo
                no celular"). O rodapé sempre tem o botão, em toda largura. */}
            <Link
              href={`/roteiros/${roteiro.id}/gravar`}
              className={`${styles.botaoBarra} ${styles.somenteTablet}`}
            >
              <Video size={18} strokeWidth={1.75} aria-hidden="true" />
              <span>{textosRoteiro.modoGravacao}</span>
            </Link>
            <button
              ref={botaoMenuRef}
              type="button"
              aria-label={textosRoteiro.maisOpcoes}
              aria-haspopup="menu"
              aria-expanded={painel === "menu"}
              onClick={() => {
                if (painel === "menu") {
                  fechar();
                } else {
                  setErroMenu(null);
                  setPainel("menu");
                }
              }}
              className={styles.botaoBarra}
            >
              <Ellipsis size={20} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </>
        }
      />

      <div className={styles.miolo}>
        {versaoAtual && !versaoAtual.atual ? (
          <div className={styles.avisoVersao}>
            <span>
              {textosRoteiro.versaoAntiga(
                versaoAtual.versao,
                versoes.find((v) => v.atual)?.versao ?? versaoAtual.versao,
              )}
            </span>
            {idVersaoAtual ? (
              <Link href={`/roteiros/${idVersaoAtual}`} className={styles.linkVersaoAtual}>
                {textosRoteiro.verAtual}
              </Link>
            ) : null}
          </div>
        ) : null}

        <div className={styles.corpoComLado} ref={refCorpoComLado} data-reprovando={painel === "reprovar" ? "" : undefined}>
        <div className={styles.cabecalhoTela}>
          <div className={styles.topoRoteiro}>
            <h1>{corpo.titulo}</h1>
            {!editando ? (
              <button type="button" onClick={iniciarEdicao} className={styles.botaoEditar}>
                {textosRoteiro.editar}
              </button>
            ) : null}
          </div>
          <p className={styles.metaRoteiro}>
            {/* E55 PR 2b (passo 21): "Assunto do momento", vivo enquanto o assunto está em alta e neutro ("O assunto já passou") depois. */}
            {momento ? (
              <span className={[styles.seloMomento, momento.estado === "vivo" ? "" : styles.seloMomentoPassou].filter(Boolean).join(" ")} data-selo-momento={momento.estado}>
                {momento.estado === "vivo" ? <TrendingUp size={14} strokeWidth={1.75} aria-hidden="true" /> : <History size={14} strokeWidth={1.75} aria-hidden="true" />}
                {momento.estado === "vivo" ? textosRoteiro.doMomento.selo : momento.estado === "outroDia" ? textosRoteiro.doMomento.seloOutroDia : textosRoteiro.doMomento.seloPassou}
              </span>
            ) : null}
            {/* E44 PR 2: "Tipo: erro comum", o tipo do vídeo de referência (não aparece em Story nem sem referência classificada). */}
            {seloDoTipo(video?.formatoCatalogo) && roteiro.formato !== "story" ? <span className={styles.seloTipo} data-selo-tipo>{seloDoTipo(video?.formatoCatalogo)}</span> : null}
            {/* E49 PR 1: "Para que te chamem" ao lado do tipo; no Story a linha sai (ele não pergunta para que é o vídeo). */}
            {roteiro.formato !== "story" ? <span data-ficha-do-roteiro>{ROTULO_PARA_QUE[fichaDoRoteiro(roteiro)]}</span> : null}
            <span className={styles.num}>{corpo.duracaoS} s</span>
            <span className={styles.num}>{formatarData(roteiro.data)}</span>
            {versoes.length > 1 ? (
              <button
                type="button"
                className={styles.linkVersoes}
                onClick={() => setPainel("versoes")}
              >
                {textosRoteiro.versao(roteiro.versao, Math.max(...versoes.map((v) => v.versao)))}
              </button>
            ) : null}
          </p>
          {/* E55 PR 2b: a linha de onde o assunto veio e por que gravar hoje; depois que ele passa, o aviso (o roteiro continua da pessoa). */}
          {momento && momento.estado === "vivo" ? (
            <p className={styles.linhaMomento} data-linha-momento>
              <TrendingUp size={16} strokeWidth={1.75} aria-hidden="true" />
              <span>
                <b>{momento.assunto}</b>
                {textosRoteiro.doMomento.linhaDepois(momento.desde, momento.fonteGoogle !== null, momento.doYoutube)}
              </span>
            </p>
          ) : null}
          {momento && momento.estado !== "vivo" ? (
            <div className={styles.avisoPassou} role="status" data-aviso-passou>
              <History size={20} strokeWidth={1.75} aria-hidden="true" />
              <div>
                <strong>{momento.estado === "outroDia" ? textosRoteiro.doMomento.avisoOutroDiaTitulo(momento.assunto) : textosRoteiro.doMomento.avisoTitulo(momento.assunto)}</strong>
                <p>{momento.estado === "outroDia" ? textosRoteiro.doMomento.avisoOutroDiaTexto : textosRoteiro.doMomento.avisoTexto(momento.saiuEm)}</p>
              </div>
              <Link href="/criar/temas" className={styles.avisoPassouBotao}>
                {textosRoteiro.doMomento.verTemas}
              </Link>
            </div>
          ) : null}
          {/* E53 (parte 3): de qual notícia o roteiro veio (do setor ou de um assunto que a marca acompanha), com o veículo e o dia; o título abre o original numa aba. */}
          {noticiaDeOrigem ? (
            <p className={styles.linhaNoticia} data-noticia-de-origem>
              <Newspaper size={16} strokeWidth={1.75} aria-hidden="true" />
              <span>
                {textosRoteiro.daNoticia.veio}{" "}
                {noticiaDeOrigem.url ? (
                  <a href={noticiaDeOrigem.url} target="_blank" rel="noopener noreferrer">
                    {noticiaDeOrigem.titulo}
                  </a>
                ) : (
                  noticiaDeOrigem.titulo
                )}
                {noticiaDeOrigem.veiculo || noticiaDeOrigem.dia ? <span className={styles.dadoDaNoticia}>{[noticiaDeOrigem.veiculo, noticiaDeOrigem.dia].filter(Boolean).join(", ")}</span> : null}
              </span>
            </p>
          ) : null}
          {/* Passo 19 do Opus, estado `refeito`: o roteiro novo diz por que foi refeito (os motivos da versão anterior e, se a pessoa escreveu, o que ela disse). */}
          {versaoReprovada ? (
            <p className={styles.refeitoPorque} data-refeito-porque>
              <Check size={16} strokeWidth={1.5} aria-hidden="true" />
              <span>
                {textosRoteiro.reprovar.refeitoPorque} <strong>{juntarMotivos(versaoReprovada.motivos ?? [])}</strong>.
                {versaoReprovada.motivoTexto ? ` ${textosRoteiro.reprovar.voceDisse} “${versaoReprovada.motivoTexto}”` : ""}
              </span>
            </p>
          ) : null}
        </div>

        {roteiro.objetivoDoVideo ? (
          <p className={styles.recado}>
            <span className={styles.rotulo}>{textosRoteiro.recado}</span>
            {roteiro.objetivoDoVideo}
          </p>
        ) : null}

        {editando && draft ? (
          <div className={styles.camposEdicao}>
            <span className={styles.avisoOriginal}>{textosRoteiro.editando.avisoOriginal}</span>
            {blocos.map((bloco, indice) =>
              corpo.cartoes ? null : (
                <AreaTexto
                  key={bloco.rotulo}
                  rotulo={bloco.rotulo}
                  value={
                    indice === 0
                      ? draft.gancho
                      : indice === 1
                        ? draft.corpo
                        : indice === 2
                          ? draft.fechamento
                          : draft.chamadaFinal
                  }
                  onChange={(evento) => {
                    const valor = evento.target.value;
                    setDraft((atual) =>
                      atual
                        ? {
                            ...atual,
                            ...(indice === 0
                              ? { gancho: valor }
                              : indice === 1
                                ? { corpo: valor }
                                : indice === 2
                                  ? { fechamento: valor }
                                  : { chamadaFinal: valor }),
                          }
                        : atual,
                    );
                  }}
                />
              ),
            )}
            {corpo.cartoes
              ? draft.cartoes.map((cartao, indice) => (
                  <div key={indice} className={styles.grupoCartaoEdicao}>
                    <h3>
                      {roteiro.estilo === "sem_fala"
                        ? textosRoteiro.blocos.cena(indice + 1, draft.cartoes.length)
                        : textosRoteiro.blocos.story(indice + 1, draft.cartoes.length)}
                    </h3>
                    {roteiro.estilo === "sem_fala" ? null : (
                      <AreaTexto
                        rotulo={textosRoteiro.blocos.story(indice + 1, draft.cartoes.length)}
                        rotuloOculto
                        value={cartao.oQueFalar}
                        onChange={(evento) =>
                          setDraft((atual) =>
                            atual
                              ? {
                                  ...atual,
                                  cartoes: atual.cartoes.map((c, i) =>
                                    i === indice ? { ...c, oQueFalar: evento.target.value } : c,
                                  ),
                                }
                              : atual,
                          )
                        }
                      />
                    )}
                    <AreaTexto
                      rotulo={textosRoteiro.cartaoStory.oQueMostrar}
                      value={cartao.oQueMostrar}
                      onChange={(evento) =>
                        setDraft((atual) =>
                          atual
                            ? {
                                ...atual,
                                cartoes: atual.cartoes.map((c, i) =>
                                  i === indice ? { ...c, oQueMostrar: evento.target.value } : c,
                                ),
                              }
                            : atual,
                        )
                      }
                    />
                    <AreaTexto
                      rotulo={textosRoteiro.cartaoStory.textoNaTela}
                      value={cartao.textoNaTela}
                      onChange={(evento) =>
                        setDraft((atual) =>
                          atual
                            ? {
                                ...atual,
                                cartoes: atual.cartoes.map((c, i) =>
                                  i === indice ? { ...c, textoNaTela: evento.target.value } : c,
                                ),
                              }
                            : atual,
                        )
                      }
                    />
                  </div>
                ))
              : null}
            {corpo.legenda !== undefined ? (
              <AreaTexto
                rotulo={textosRoteiro.legenda}
                value={draft.legenda}
                onChange={(evento) =>
                  setDraft((atual) => (atual ? { ...atual, legenda: evento.target.value } : atual))
                }
              />
            ) : null}
            {erroEdicao ? (
              <p role="alert" className={styles.fraseErroPainel}>
                {erroEdicao}
              </p>
            ) : null}
          </div>
        ) : (
          <>
            <article className={styles.blocos}>
              {temChaveDeMarcas ? (
                <LinhaMarcasDeFala
                  variante="roteiro"
                  ligadas={marcasLigadas}
                  aoTrocar={trocarMarcas}
                  marcando={estadoMarcas === "marcando" && marcasProntas === null}
                  erro={marcasLigadas ? erroMarcas : null}
                  avisos={marcasProntas?.avisos ?? []}
                />
              ) : null}
              <RoteiroTexto
                blocos={blocosVisiveis}
                comCenas={roteiro.formato !== "story" && roteiro.estilo !== "sem_fala"}
                comMarcas={mostrarMarcas}
              />
              {/* Só no celular (design v2, ".julgar"): do tablet para cima "Reprovar" já está na barra de ações. */}
              <p className={styles.julgar}>
                {textosRoteiro.reprovar.naoFicouBom}{" "}
                <button
                  type="button"
                  onClick={() => setPainel("reprovar")}
                  disabled={semConexao}
                  aria-describedby={descricaoSemRede}
                  className={styles.linkReprovar}
                >
                  {textosRoteiro.menu.reprovar}
                </button>
                <MotivoSemRede className={styles.motivoJulgar} />
              </p>
            </article>

            {/* Em Reels falado a cena de cada bloco já está junto da fala (`RoteiroTexto comCenas`); a seção separada só continua onde o bloco não a traz (Story e sem fala). */}
            {roteiro.formato === "story" || roteiro.estilo === "sem_fala" ? <BlocoCenas titulo={textosRoteiro.ondeGravar} cenas={corpo.cenas} /> : null}

            {roteiro.estilo === "sem_fala" && corpo.cartoes ? (
              corpo.cartoes.map((cartao, indice) => (
                <BlocoEdicao
                  key={indice}
                  titulo={textosRoteiro.blocos.cena(indice + 1, corpo.cartoes!.length)}
                  itens={itensCartaoSemFala(cartao)}
                />
              ))
            ) : roteiro.formato === "story" && corpo.cartoes ? (
              corpo.cartoes.map((cartao, indice) => (
                <BlocoEdicao
                  key={indice}
                  titulo={textosRoteiro.blocos.story(indice + 1, corpo.cartoes!.length)}
                  itens={itensCartaoStory(cartao)}
                />
              ))
            ) : (
              /*
               * V15, item 4 (correção pedida pelo Fable): mesma posição de sempre no DOM, logo
               * depois de "Onde gravar" (a ordem no celular não muda); `.ladoGrudado` só move isto
               * visualmente a partir de 1024px, por CSS.
               */
              <div className={styles.ladoGrudado}>
                <div className={styles.pilhaDoLado}>
                  <BlocoEdicao titulo={textosRoteiro.comoEditar} itens={itensEdicao(corpo.edicao)} />
                  {/* Hotfix de 05/10/2026: no Reels falado "Por que assim" vem junto de "Como editar", na MESMA caixa do lado (eram dois `.ladoGrudado` na mesma área da grade, uma por cima da outra). */}
                  {corpo.porQueAssim.length > 0 ? <BlocoEdicao titulo={textosRoteiro.porQueAssim} itens={itensPorQueAssim(corpo.porQueAssim)} /> : null}
                </div>
              </div>
            )}
          </>
        )}

        {!editando && corpo.legenda ? (
          <section className={styles.referenciaVazia}>
            <h2>{textosRoteiro.legenda}</h2>
            <p>{corpo.legenda}</p>
            <button
              type="button"
              onClick={() => void copiarLegenda()}
              className={styles.linkReprovar}
            >
              <Copy size={16} strokeWidth={1.5} aria-hidden="true" />
              {textosRoteiro.menu.copiarLegenda}
            </button>
          </section>
        ) : null}

        {/* V15, item 4: mesma posição de sempre (depois da legenda); sempre que a lista tiver
            item, em qualquer formato e estilo (Reels sem fala com cartões também pode ter). */}
        {corpo.porQueAssim.length > 0 && !comoEditarNoLado ? (
          <div className={styles.ladoGrudado}>
            <BlocoEdicao titulo={textosRoteiro.porQueAssim} itens={itensPorQueAssim(corpo.porQueAssim)} />
          </div>
        ) : null}

        {/* E55 PR 2b (passo 21): o roteiro do momento não veio de um vídeo do banco, veio de um assunto: o "De onde veio" mostra as fontes dele e a ligação com o ramo, que é do sistema. */}
        {momento ? (
          <section className={[styles.referenciaVazia, styles.ladoDeOndeVeio, styles.deOndeVeioMomento].join(" ")} ref={definirRefDeOndeVeio} aria-label={textosRoteiro.doMomento.deOndeVeioAria} data-de-onde-veio-momento>
            <h2>{textosRoteiro.doMomento.deOndeVeioTitulo}</h2>
            <ul className={styles.fontesMomento}>
              {momento.fonteGoogle ? (
                <li>
                  <Search size={20} strokeWidth={1.75} aria-hidden="true" />
                  <span>
                    <b>{textosRoteiro.doMomento.google}</b>
                    <span className={styles.dadoMomento}>{textosRoteiro.doMomento.dadoGoogle(momento.fonteGoogle.termo, momento.fonteGoogle.buscas)}</span>
                  </span>
                </li>
              ) : null}
              {momento.doYoutube ? (
                <li>
                  <Play size={20} strokeWidth={1.75} aria-hidden="true" />
                  <span>
                    <b>{textosRoteiro.doMomento.youtube}</b>
                    <span className={styles.dadoMomento}>{textosRoteiro.doMomento.dadoYoutube}</span>
                  </span>
                </li>
              ) : null}
            </ul>
            {momento.ligacao ? <p className={styles.ligacaoRamo}>{textosRoteiro.doMomento.ligacao(momento.ligacao)}</p> : null}
          </section>
        ) : referencia && video ? (
          <div className={styles.ladoDeOndeVeio} ref={definirRefDeOndeVeio}>
            <CartaoDeOndeVeio
              titulo={textosRoteiro.referencia}
              conta={video.contaNome ?? video.contaHandle}
              multiplo={formatarMultiplo(video.foraDaCurva)}
              texto={`${rotuloMultiploConta(classificarMultiplo(video.foraDaCurva), video.contaMedianaOrigem)}. ${textosRoteiro.oQueFuncionouAli} ${comInicialMinuscula(video.porQueFuncionou ?? "")}`.trim()}
              segundoFormatado={
                referencia.segundo !== null && referencia.segundo > 0
                  ? textosRoteiro.trechoComeca(formatarSegundo(referencia.segundo))
                  : null
              }
              miniatura={
                <VideoEmbed
                  url={video.url}
                  alt={textosRoteiro.embedAlt(video.contaNome ?? video.contaHandle ?? "")}
                  rotuloCarregamento={textosRoteiro.embedCarregando}
                  hrefExterno={video.url}
                  segundoInicial={referencia.segundo ?? undefined}
                  capaUrl={video.capaUrl}
                />
              }
              botao={{ rotulo: textosRoteiro.abrirReferencia, href: video.url }}
              forca={corpo.forcaEvidencia ? textosRoteiro.forcaEvidencia[corpo.forcaEvidencia] : null}
            />
          </div>
        ) : corpo.semEvidencia ? (
          <section
            className={[styles.referenciaVazia, styles.ladoDeOndeVeio].join(" ")}
            ref={definirRefDeOndeVeio}
          >
            <h2>{textosRoteiro.referencia}</h2>
            <p>
              {roteiro.origem === "momento" ? textosRoteiro.semEvidenciaMomento : textosRoteiro.semEvidencia}
            </p>
          </section>
        ) : null}

        {/* Outras versões deste tema (design v2; E26 4b): as que a pessoa não escolheu continuam guardadas, com as notas, na tela de comparar. */}
        <section className={styles.versoesVazio}>
          <h2>{textosRoteiro.outrasVersoes}</h2>
          {grupoDeVersoes ? (
            <>
              <p>{textosRoteiro.outrasVersoesGuardadas(grupoDeVersoes.total)}</p>
              <Link className={styles.linkVersoes} href={`/criar/versoes/${grupoDeVersoes.grupo}`}>
                {textosRoteiro.verAsOutrasVersoes}
              </Link>
            </>
          ) : (
            <p>{textosRoteiro.outrasVersoesSemComparacao}</p>
          )}
        </section>
        </div>
      </div>

      {/* `data-barra-acoes-propria`, sem valor: o gancho para a cápsula de abas (layout.module.css)
          sumir aqui (V5, item 5, IDENTIDADE.md item 8), para uma não flutuar sobre a outra. */}
      {editando ? (
        <div className={styles.barraAcoes} data-barra-acoes-propria="" data-reprovando={painel === "reprovar" ? "" : undefined}>
          <button
            type="button"
            onClick={salvarEdicao}
            disabled={salvandoEdicao || semConexao}
            aria-busy={salvandoEdicao || undefined}
            aria-describedby={descricaoSemRede}
            className={styles.btn}
          >
            {salvandoEdicao ? textosRoteiro.editando.salvando : textosRoteiro.editando.salvar}
          </button>
          <button
            type="button"
            onClick={cancelarEdicao}
            disabled={salvandoEdicao}
            className={styles.btnTextoCancelar}
          >
            {textosRoteiro.editando.cancelar}
          </button>
          <MotivoSemRede className={styles.motivoBarra} />
        </div>
      ) : (
        <div className={styles.barraAcoes} data-barra-acoes-propria="" data-reprovando={painel === "reprovar" ? "" : undefined}>
          <Link href={`/roteiros/${roteiro.id}/gravar`} className={styles.btn}>
            <Video size={18} strokeWidth={1.75} aria-hidden="true" />
            {textosRoteiro.modoGravacao}
          </Link>
          {!gravadoEm ? (
            <button
              type="button"
              onClick={gravei}
              disabled={gravando || semConexao}
              aria-busy={gravando || undefined}
              aria-describedby={descricaoSemRede}
              className={styles.btnVazio}
            >
              {gravando ? textosRoteiro.salvando : textosRoteiro.jaGravei}
            </button>
          ) : !postado ? (
            <button
              type="button"
              onClick={() => setPainel("postei")}
              disabled={semConexao}
              aria-describedby={descricaoSemRede}
              className={styles.btnVazio}
            >
              {textosRoteiro.postei}
            </button>
          ) : (
            <a href={urlPostado} target="_blank" rel="noreferrer" className={styles.btnVazio}>
              {textosRoteiro.postado}
            </a>
          )}
          {/* O momento que volta preenchido: o roteiro nasceu do que a pessoa contou, então ela volta ao Criar com o texto dela. Não precisa de rede para abrir. */}
          {reescreverMomentoHref ? (
            <Link href={reescreverMomentoHref} className={`${styles.btnVazio} ${styles.somenteTablet}`}>
              {textosRoteiro.menu.reescreverMomento}
            </Link>
          ) : null}
          {/* "Reprovar" só do tablet para cima; no celular é a linha .julgar no fim do cartão (design v2). */}
          <button
            type="button"
            onClick={() => setPainel("reprovar")}
            disabled={semConexao}
            aria-describedby={descricaoSemRede}
            className={`${styles.btnVazio} ${styles.somenteTablet}`}
          >
            {textosRoteiro.menu.reprovar}
          </button>
          <button
            type="button"
            onClick={baixarPdf}
            disabled={baixandoPdf || semConexao}
            aria-busy={baixandoPdf || undefined}
            aria-describedby={descricaoSemRede}
            aria-label={baixandoPdf ? textosRoteiro.gerandoPdf : textosRoteiro.baixarPdf}
            className={`${styles.btnVazio} ${styles.btnIcone} ${styles.somenteTablet}`}
          >
            <Download size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
          {/* Sem conexão o motivo ocupa uma linha acima dos botões (CSS). No celular só aparece enquanto a barra
            ainda tem o que precisa de rede ("Já gravei" ou "Postei"); do tablet para cima o PDF e o Reprovar
            estão sempre lá. */}
          <MotivoSemRede
            className={[styles.motivoBarra, postado ? styles.motivoSoTablet : ""]
              .filter(Boolean)
              .join(" ")}
          />
        </div>
      )}

      <PainelFlutuante
        titulo={textosRoteiro.maisOpcoes}
        aberto={painel === "menu"}
        aoFechar={fecharSeLivre}
        role="menu"
      >
        <button
          type="button"
          role="menuitem"
          onClick={() => setPainel("reprovar")}
          disabled={semConexao}
          aria-describedby={descricaoSemRede}
          className={styles.itemMenu}
        >
          <RotateCcw size={20} strokeWidth={1.5} aria-hidden="true" />
          {textosRoteiro.menu.reprovar}
          <MotivoSemRede className={styles.motivoItem} />
        </button>
        {reescreverMomentoHref ? (
          <Link href={reescreverMomentoHref} role="menuitem" className={styles.itemMenu}>
            <Pencil size={20} strokeWidth={1.5} aria-hidden="true" />
            {textosRoteiro.menu.reescreverMomento}
          </Link>
        ) : null}
        <button type="button" role="menuitem" onClick={copiarTexto} className={styles.itemMenu}>
          <Copy size={20} strokeWidth={1.5} aria-hidden="true" />
          {textosRoteiro.menu.copiar}
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={baixarPdf}
          disabled={baixandoPdf || semConexao}
          aria-busy={baixandoPdf || undefined}
          aria-describedby={descricaoSemRede}
          className={styles.itemMenu}
        >
          <Download size={20} strokeWidth={1.5} aria-hidden="true" />
          {baixandoPdf ? textosRoteiro.gerandoPdf : textosRoteiro.menu.baixarPdf}
          <MotivoSemRede className={styles.motivoItem} />
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={guardarImagem}
          disabled={guardandoImagem || semConexao}
          aria-busy={guardandoImagem || undefined}
          aria-describedby={descricaoSemRede}
          className={styles.itemMenu}
          data-guardar-imagem
        >
          <ImageDown size={20} strokeWidth={1.5} aria-hidden="true" />
          {guardandoImagem ? textosRoteiro.gerandoImagem : textosRoteiro.menu.guardarImagem}
          <MotivoSemRede className={styles.motivoItem} />
        </button>
        {temChaveDeMarcas ? (
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={exportarComMarcas}
            onClick={() => setExportarComMarcas((ligada) => !ligada)}
            className={styles.itemMenu}
            data-marcas-no-papel
          >
            <Mic size={20} strokeWidth={1.5} aria-hidden="true" />
            {textosMarcasDeFala.noPdfEImagem}
            <TrilhoDaChave ligada={exportarComMarcas} />
          </button>
        ) : null}
        {versoes.length > 1 ? (
          <button
            type="button"
            role="menuitem"
            onClick={() => setPainel("versoes")}
            className={styles.itemMenu}
          >
            <History size={20} strokeWidth={1.5} aria-hidden="true" />
            {textosRoteiro.menu.versoes}
          </button>
        ) : null}
        {erroMenu ? (
          <p role="alert" className={styles.fraseErroPainel}>
            {erroMenu}
          </p>
        ) : null}
      </PainelFlutuante>

      <PainelFlutuante
        titulo={textosRoteiro.ondePostou}
        aberto={painel === "postei"}
        aoFechar={fecharSeLivre}
      >
        <h2 className={styles.tituloPainel}>{textosRoteiro.ondePostou}</h2>
        {/* `noValidate`: o navegador não barra o envio de um link sem `https://`; `normalizarLink` completa o
            começo ou explica aqui dentro. */}
        <form onSubmit={salvarPostado} noValidate className={styles.formPostei}>
          <label className={styles.campo}>
            <span>{textosRoteiro.coleLink}</span>
            <input
              type="url"
              enterKeyHint="done"
              value={urlDigitada}
              onChange={(evento) => {
                setUrlDigitada(evento.target.value);
                setErroPostei(null);
              }}
              placeholder="https://"
              aria-describedby={erroPostei ? ID_ERRO_POSTEI : undefined}
              className={styles.input}
            />
          </label>
          {erroPostei ? (
            <p id={ID_ERRO_POSTEI} role="alert" className={styles.fraseErroPainel}>
              {erroPostei}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={salvandoLink || semConexao}
            aria-busy={salvandoLink || undefined}
            aria-describedby={descricaoSemRede}
            className={styles.btn}
          >
            {salvandoLink ? textosRoteiro.salvando : textosComuns.salvar}
          </button>
          <MotivoSemRede />
        </form>
      </PainelFlutuante>

      {/* A espera da claquete assume enquanto a reescrita roda (o painel some, e volta com a frase de erro se ela falhar): passo 19 do Opus. */}
      <TelaReescrevendo
        aberto={reescrevendo}
        motivos={MOTIVOS_REPROVACAO.filter((m) => motivosSelecionados.has(m.id)).map((m) => m.rotulo)}
        continuaSendo={roteiro.formato === "story" ? "um Story, para quem já te segue" : `para que ${COMPLEMENTO_PARA_QUE[fichaDoRoteiro(roteiro)]}`}
        aoVoltarDepois={() => router.push("/hoje")}
      />

      <PainelFlutuante
        titulo={textosRoteiro.reprovar.tituloFolha}
        aberto={painel === "reprovar" && !reescrevendo}
        lateral
        aoFechar={fecharSeLivre}
        rodape={
          <>
            {erroReprovar ? (
              <p role="alert" className={styles.fraseErroPainel}>
                {erroReprovar}
              </p>
            ) : null}
            <button
              type="button"
              onClick={reprovarRoteiro}
              disabled={reescrevendo || semConexao || motivosSelecionados.size === 0}
              aria-busy={reescrevendo || undefined}
              aria-describedby={descricaoSemRede}
              className={styles.btn}
            >
              {textosRoteiro.reprovar.reescrever}
            </button>
            <MotivoSemRede />
            <p className={styles.avisoTempoReprovar} aria-live="polite">
              {demorando
                ? textosRoteiro.reprovar.demorando
                : motivosSelecionados.size === 0
                  ? textosRoteiro.reprovar.semMotivoMarcado
                  : textosRoteiro.reprovar.tempoEstimado}
            </p>
            <button
              type="button"
              onClick={fecharSeLivre}
              disabled={reescrevendo}
              className={styles.btnTextoCancelar}
            >
              {textosRoteiro.reprovar.cancelar}
            </button>
          </>
        }
      >
        <div className={styles.cabecaReprovar}>
          <h2 className={styles.tituloPainel}>{textosRoteiro.reprovar.tituloFolha}</h2>
          <button type="button" onClick={fecharSeLivre} disabled={reescrevendo} className={styles.fecharReprovar} aria-label={textosRoteiro.reprovar.fechar}>
            <X size={20} strokeWidth={1.5} aria-hidden="true" />
          </button>
        </div>
        <p className={styles.ajudaReprovar}>{textosRoteiro.reprovar.ajudaMotivos}</p>
        <div
          role="group"
          aria-label={textosRoteiro.reprovar.rotuloMotivos}
          className={[chipStyles.grupo, styles.motivosReprovar].join(" ")}
          data-motivos-reprovar
        >
          {MOTIVOS_REPROVACAO.map((motivo) => {
            const ativo = motivosSelecionados.has(motivo.id);
            return (
              <button
                key={motivo.id}
                type="button"
                aria-pressed={ativo}
                onClick={() => alternarMotivo(motivo.id)}
                className={[chipStyles.chip, styles.motivoChip, ativo ? chipStyles.ativo : ""]
                  .filter(Boolean)
                  .join(" ")}
              >
                {ativo ? <Check size={14} strokeWidth={2.25} className={styles.tiqueMotivo} aria-hidden="true" /> : null}
                {motivo.rotulo}
              </button>
            );
          })}
        </div>
        <CampoComFala
          rotulo={textosRoteiro.reprovar.rotuloTextoLivre}
          value={motivoTexto}
          onChange={setMotivoTexto}
          placeholder={textosRoteiro.reprovar.textoLivrePlaceholder}
          linhasMin={3}
          nomeArquivo="reprovar"
        />
        <p className={styles.objetivoTravado}>
          {roteiro.formato === "story" ? textosRoteiro.reprovar.storyContinua : textosRoteiro.reprovar.objetivoContinua(COMPLEMENTO_PARA_QUE[fichaDoRoteiro(roteiro)])}
        </p>
      </PainelFlutuante>

      <PainelFlutuante
        titulo={textosRoteiro.versoesTitulo}
        aberto={painel === "versoes"}
        aoFechar={fecharSeLivre}
      >
        <h2 className={styles.tituloPainel}>{textosRoteiro.versoesTitulo}</h2>
        <div className={styles.listaVersoes}>
          {versoes.map((v) => (
            <Link
              key={v.id}
              href={`/roteiros/${v.id}`}
              onClick={(evento) => irParaVersao(evento, v.id)}
              className={styles.itemVersao}
            >
              <span className={styles.textoVersao}>
                <span>
                  {textosRoteiro.versao(v.versao, Math.max(...versoes.map((x) => x.versao)))}
                  {v.atual ? `, ${textosRoteiro.atual}` : ""}
                  {v.reprovadoEm ? (
                    <span className={styles.etiquetaReprovada}>
                      {textosRoteiro.reprovar.etiqueta}
                    </span>
                  ) : null}
                </span>
                {v.reprovadoEm && v.motivos ? (
                  <span className={styles.motivosVersao}>
                    {textosRoteiro.reprovar.motivosLinha(
                      listaComE(v.motivos),
                      formatarDataPorExtenso(v.reprovadoEm),
                    )}
                  </span>
                ) : (
                  <span className={styles.horaVersao}>{formatarHora(v.criadoEm)}</span>
                )}
              </span>
            </Link>
          ))}
        </div>
      </PainelFlutuante>

      <Toast texto={textosRoteiro.textoCopiado} aberto={toast} onFechar={() => setToast(false)} />
      {/* E26 (passo 23): o PDF pronto, com "Abrir" (o iPad não mostra o download caindo), e a imagem guardada por download. */}
      <Toast
        texto={textosRoteiro.pdfPronto}
        aberto={toastPdf}
        onFechar={() => setToastPdf(false)}
        duracaoMs={6000}
        acao={{ rotulo: textosRoteiro.abrirPdf, onClique: () => enderecoDoPdf.current && window.open(enderecoDoPdf.current, "_blank", "noopener") }}
      />
      <Toast texto={textosRoteiro.imagemPronta} aberto={imagemPronta} onFechar={() => setImagemPronta(false)} />
      <Toast
        texto={avisoSemMarcas?.texto ?? ""}
        aberto={avisoSemMarcas !== null}
        onFechar={() => setAvisoSemMarcas(null)}
        duracaoMs={7000}
        acao={avisoSemMarcas?.abrirPdf ? { rotulo: textosRoteiro.abrirPdf, onClique: () => enderecoDoPdf.current && window.open(enderecoDoPdf.current, "_blank", "noopener") } : undefined}
      />
      <Toast
        texto={textosRoteiro.imagemParaGuardar}
        aberto={imagensParaGuardar !== null}
        onFechar={() => setImagensParaGuardar(null)}
        duracaoMs={20000}
        acao={{
          rotulo: textosRoteiro.guardarImagemAgora,
          // A folha de compartilhar tem de abrir DENTRO deste toque: nada de `await` antes (o `guardarImagens` chama o `share` na primeira linha).
          onClique: () => {
            if (imagensParaGuardar) void guardarImagens(imagensParaGuardar, true).then((resultado) => resultado === "baixado" && setImagemPronta(true));
          },
        }}
      />
      <Toast
        texto={erroToast ?? ""}
        variante="erro"
        aberto={erroToast !== null}
        onFechar={fecharToastErro}
      />
      <Toast
        texto={textosGravacao.gravadoToast}
        aberto={toastGravado}
        onFechar={() => setToastGravado(false)}
      />
      <Toast
        texto={textosRoteiro.editando.salvo}
        aberto={toastSalvo}
        onFechar={() => setToastSalvo(false)}
      />
      {/* E48 PR 1: o convite de instalar o aplicativo, depois que o roteiro está na tela e só com a tela livre (o modo gravação é outra rota). */}
      <ConviteInstalar podeAparecer={conviteInstalarPodeAparecer} telaLivre={painel === null && !editando && !gravando} />
    </div>
  );
}
