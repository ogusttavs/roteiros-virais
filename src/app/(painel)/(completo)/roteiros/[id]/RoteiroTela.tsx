"use client";

import {
  ArrowLeft,
  Copy,
  Download,
  Ellipsis,
  Eye,
  History,
  Music,
  RotateCcw,
  Scissors,
  Type,
  Video,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type MouseEvent as EventoMouse,
} from "react";

import { MOTIVOS_REPROVACAO, type IdMotivoReprovacao } from "@/config/motivos-reprovacao";
import type { ConteudoRoteiro } from "@/db/schema";
import { ROTULO_OBJETIVO_TRAVADO, ROTULO_TEMA_CARTAO } from "@/ia/enums";
import { classificarMultiplo, formatarMultiplo, rotuloMultiploConta } from "@/lib/formatarNumero";
import { ehFalhaDeRede } from "@/lib/offline";
import type { VideoParaEmbed } from "@/servicos/pesquisa";
import type { RoteiroLinha, VersaoRoteiro } from "@/servicos/roteiro";
import { textosComuns } from "@/textos/comuns";
import { textosConexao } from "@/textos/conexao";
import { textosRoteiro } from "@/textos/roteiro";
import { AreaTexto } from "@/ui/componentes/AreaTexto";
import { BarraTopo } from "@/ui/componentes/BarraTopo";
import { BlocoCenas } from "@/ui/componentes/BlocoCenas";
import { BlocoEdicao, type ItemEdicao } from "@/ui/componentes/BlocoEdicao";
import { CartaoDeOndeVeio } from "@/ui/componentes/CartaoDeOndeVeio";
import chipStyles from "@/ui/componentes/Chips.module.css";
import { MotivoSemRede } from "@/ui/componentes/MotivoSemRede";
import { PainelFlutuante } from "@/ui/componentes/PainelFlutuante";
import { RoteiroTexto } from "@/ui/componentes/RoteiroTexto";
import { Toast } from "@/ui/componentes/Toast";
import { ID_FAIXA_SEM_CONEXAO, useConexao, useTratarFalha } from "@/ui/ConexaoContext";
import { useFolhaNoHistorico } from "@/ui/useFolhaNoHistorico";

import { SeletorMarcaCelular, type MarcaResumo } from "../../../_casca/SeletorMarcaCelular";

import { marcarGravadoAction, marcarPostadoAction, reprovarERescreverAction } from "./acoes";
import styles from "./RoteiroTela.module.css";

function splitParagrafos(texto: string): string[] {
  return texto
    .split("\n")
    .map((linha) => linha.trim())
    .filter(Boolean);
}

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

function textoParaCopiar(corpo: ConteudoRoteiro): string {
  return [corpo.gancho, corpo.corpo, corpo.fechamento, corpo.chamadaFinal].join("\n\n");
}

/** "O que funcionou ali:" mais a análise, que vem de um campo com maiúscula (design v2, achado do iPad, item 2). */
function comInicialMinuscula(texto: string): string {
  return texto.length > 0 ? texto[0].toLowerCase() + texto.slice(1) : texto;
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
  video: VideoParaEmbed | null;
  versoes: VersaoRoteiro[];
  /** O seletor de marca na barra do topo, só no celular (V3, item 3, Roteiro.dc.html). */
  marcaAtiva: MarcaResumo;
  marcas: MarcaResumo[];
  nomePessoa: string;
};

/**
 * `/roteiros/[id]` (design v2, `entrega/telas/Roteiro.dc.html`; `PROXIMO.md`,
 * D2 parte 1, item 6). Modo gravação virou rota própria
 * (`/roteiros/[id]/gravar`, item 7): o botão daqui só navega.
 */
export function RoteiroTela({ roteiro, corpo, video, versoes, marcaAtiva, marcas, nomePessoa }: Props) {
  const router = useRouter();
  const [gravadoEm, setGravadoEm] = useState(roteiro.gravadoEm);
  const [postado, setPostado] = useState(roteiro.status === "postado");
  const [urlPostado, setUrlPostado] = useState(roteiro.urlPostado ?? "");
  const [painel, setPainel] = useState<Painel>(null);
  const botaoMenuRef = useRef<HTMLButtonElement>(null);
  const [urlDigitada, setUrlDigitada] = useState("");
  const [erroPostei, setErroPostei] = useState<string | null>(null);
  const [motivosSelecionados, setMotivosSelecionados] = useState<Set<IdMotivoReprovacao>>(new Set());
  const [motivoTexto, setMotivoTexto] = useState("");
  const [erroReprovar, setErroReprovar] = useState<string | null>(null);
  const [demorando, setDemorando] = useState(false);
  const [versoesDesatualizadas, setVersoesDesatualizadas] = useState(false);
  const [toast, setToast] = useState(false);
  /** A frase de falha de uma ação sem painel aberto ("Já gravei", o PDF da barra do tablet): sai num Toast de erro. */
  const [erroToast, setErroToast] = useState<string | null>(null);
  /** A frase de falha de "Copiar texto" e "Baixar em PDF" quando o menu está aberto: sai dentro dele. */
  const [erroMenu, setErroMenu] = useState<string | null>(null);
  const [baixandoPdf, setBaixandoPdf] = useState(false);
  // Uma transição por ação (V7, item 4 do PROXIMO.md): com uma só, "Já gravei" ficava morto e sem motivo
  // durante os até 3 minutos de uma reescrita, e o rótulo "Salvando" aparecia nele sem ser dele.
  const [gravando, iniciarGravacao] = useTransition();
  const [salvandoLink, iniciarSalvarLink] = useTransition();
  const [reescrevendo, iniciarReescrita] = useTransition();
  const { semConexao, avisarRedeOk } = useConexao();
  const tratarFalha = useTratarFalha();
  /** Igual a `reescrevendo`, mas lido na hora nos fechamentos e solto antes de navegar (o estado só solta no fim). */
  const reescritaEmCursoRef = useRef(false);
  /** Qual painel está aberto agora: uma ação que termina depois precisa saber se o painel dela ainda está na tela. */
  const painelAbertoRef = useRef<Painel>(null);
  useEffect(() => {
    painelAbertoRef.current = painel;
  });

  const versaoAtual = versoes.find((v) => v.id === roteiro.id);
  const idVersaoAtual = versoes.find((v) => v.atual)?.id;
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
  const { fechar, fecharEDepois } = useFolhaNoHistorico(painel !== null, fecharPainel);

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
        setErroToast(tratarFalha(erro, textosRoteiro.erroMarcarGravado, textosRoteiro.erroMarcarGravadoSemRede));
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
        setErroPostei(tratarFalha(erro, textosRoteiro.erroSalvarLink, textosConexao.conexaoCaiuNoMeio));
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
        // Fecha o painel e só então navega (sem entrada fantasma no histórico), e só se a pessoa ainda está neste
        // roteiro: se ela saiu enquanto a reescrita rodava, o roteiro novo está na lista de versões e no Histórico.
        fecharEDepois(() => {
          if (window.location.pathname === `/roteiros/${roteiro.id}`) router.push(`/roteiros/${id}`);
        });
      } catch (erro) {
        reescritaEmCursoRef.current = false;
        // Reescrever CRIA a versão nova: se a conexão caiu, ela pode já existir.
        setErroReprovar(tratarFalha(erro, textosRoteiro.reprovar.erro, textosConexao.conexaoCaiuNoMeio));
        if (ehFalhaDeRede(erro)) setVersoesDesatualizadas(true);
      }
    });
  }

  /** A lista de versões navega para outro roteiro: fecha o painel antes, para o Voltar não pedir dois toques. */
  function irParaVersao(evento: EventoMouse<HTMLAnchorElement>, id: number) {
    // Com Ctrl, Cmd, Shift, Alt ou o botão do meio a pessoa quer outra aba: deixa o navegador fazer.
    if (evento.metaKey || evento.ctrlKey || evento.shiftKey || evento.altKey || evento.button !== 0) return;
    evento.preventDefault();
    fecharEDepois(() => router.push(`/roteiros/${id}`));
  }

  async function copiarTexto() {
    setErroMenu(null);
    try {
      // A cópia é do aparelho e não chama o servidor: funciona sem rede, e um erro aqui nunca é de rede
      // (por isso a frase fixa em vez de `tratarFalha`, que trataria "sem rede" como falha de conexão).
      await navigator.clipboard.writeText(textoParaCopiar(corpo));
      fechar();
      setToast(true);
    } catch {
      setErroMenu(textosRoteiro.erroCopiar);
    }
  }

  async function baixarPdf() {
    if (baixandoPdf || semConexao) return;
    setBaixandoPdf(true);
    setErroMenu(null);
    setErroToast(null);
    try {
      const resposta = await fetch(`/api/roteiros/${roteiro.id}/pdf`);
      // Login vencido volta como a página de entrada com status 200: só serve o que veio como PDF de verdade.
      if (!resposta.ok || !resposta.headers.get("content-type")?.includes("application/pdf")) {
        throw new Error("o pdf nao veio");
      }
      const endereco = URL.createObjectURL(await resposta.blob());
      const link = document.createElement("a");
      link.href = endereco;
      // Mesmo nome que a rota manda em `Content-Disposition`.
      link.download = `roteiro-${roteiro.data}.pdf`;
      document.body.append(link);
      link.click();
      link.remove();
      // Soltar o endereço logo depois do clique cancela o download em alguns navegadores (o Safari, por exemplo).
      setTimeout(() => URL.revokeObjectURL(endereco), 10000);
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

        <div className={styles.cabecalhoTela}>
          <h1>{corpo.titulo}</h1>
          <p className={styles.metaRoteiro}>
            <span>{ROTULO_TEMA_CARTAO[roteiro.objetivo]}</span>
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
        </div>

        <article className={styles.blocos}>
          <RoteiroTexto
            blocos={[
              { rotulo: textosRoteiro.blocos.abertura, paragrafos: [corpo.gancho] },
              { rotulo: textosRoteiro.blocos.meio, paragrafos: splitParagrafos(corpo.corpo) },
              {
                rotulo: textosRoteiro.blocos.fechamento,
                paragrafos: splitParagrafos(corpo.fechamento),
              },
              { rotulo: textosRoteiro.blocos.chamada, paragrafos: [corpo.chamadaFinal] },
            ]}
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

        <BlocoCenas titulo={textosRoteiro.ondeGravar} cenas={corpo.cenas} />

        <BlocoEdicao titulo={textosRoteiro.comoEditar} itens={itensEdicao(corpo.edicao)} />

        {referencia && video ? (
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
            botao={{ rotulo: textosRoteiro.abrirReferencia, href: video.url }}
            forca={corpo.forcaEvidencia ? textosRoteiro.forcaEvidencia[corpo.forcaEvidencia] : null}
          />
        ) : corpo.semEvidencia ? (
          <section className={styles.referenciaVazia}>
            <h2>{textosRoteiro.referencia}</h2>
            <p>{roteiro.origem === "momento" ? textosRoteiro.semEvidenciaMomento : textosRoteiro.semEvidencia}</p>
          </section>
        ) : null}

        {/* Outras versões deste tema (design v2): a comparação com nota é a E26, ainda não construída.
            Só a marcação, no estado vazio (PROXIMO.md, D2 parte 1, item 6). */}
        <section className={styles.versoesVazio}>
          <h2>{textosRoteiro.outrasVersoes}</h2>
          <p>{textosRoteiro.outrasVersoesEmBreve}</p>
        </section>
      </div>

      {/* `data-barra-acoes-propria`, sem valor: o gancho para a cápsula de abas (layout.module.css)
          sumir aqui (V5, item 5, IDENTIDADE.md item 8), para uma não flutuar sobre a outra. */}
      <div className={styles.barraAcoes} data-barra-acoes-propria="">
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
          className={[styles.motivoBarra, postado ? styles.motivoSoTablet : ""].filter(Boolean).join(" ")}
        />
      </div>

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

      <PainelFlutuante
        titulo={reescrevendo ? textosRoteiro.reprovar.reescrevendo : textosRoteiro.reprovar.tituloFolha}
        aberto={painel === "reprovar"}
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
              {reescrevendo ? textosRoteiro.reprovar.reescrevendo : textosRoteiro.reprovar.reescrever}
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
        <h2 className={styles.tituloPainel}>
          {reescrevendo ? textosRoteiro.reprovar.reescrevendo : textosRoteiro.reprovar.tituloFolha}
        </h2>
        <p className={styles.ajudaReprovar}>{textosRoteiro.reprovar.ajudaMotivos}</p>
        <div role="group" aria-label={textosRoteiro.reprovar.rotuloMotivos} className={chipStyles.grupo}>
          {MOTIVOS_REPROVACAO.map((motivo) => {
            const ativo = motivosSelecionados.has(motivo.id);
            return (
              <button
                key={motivo.id}
                type="button"
                aria-pressed={ativo}
                onClick={() => alternarMotivo(motivo.id)}
                className={[chipStyles.chip, ativo ? chipStyles.ativo : ""].filter(Boolean).join(" ")}
              >
                {motivo.rotulo}
              </button>
            );
          })}
        </div>
        <AreaTexto
          rotulo={textosRoteiro.reprovar.rotuloTextoLivre}
          value={motivoTexto}
          onChange={(evento) => setMotivoTexto(evento.target.value)}
          placeholder={textosRoteiro.reprovar.textoLivrePlaceholder}
          linhasMin={3}
        />
        <p className={styles.objetivoTravado}>
          {textosRoteiro.reprovar.objetivoContinua(ROTULO_OBJETIVO_TRAVADO[roteiro.objetivo])}
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
                    <span className={styles.etiquetaReprovada}>{textosRoteiro.reprovar.etiqueta}</span>
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
      <Toast texto={erroToast ?? ""} variante="erro" aberto={erroToast !== null} onFechar={fecharToastErro} />
    </div>
  );
}
