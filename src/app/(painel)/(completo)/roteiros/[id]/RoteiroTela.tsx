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
import { useRef, useState, useTransition } from "react";

import { MOTIVOS_REPROVACAO, type IdMotivoReprovacao } from "@/config/motivos-reprovacao";
import type { ConteudoRoteiro } from "@/db/schema";
import { ROTULO_OBJETIVO_TRAVADO, ROTULO_TEMA_CARTAO } from "@/ia/enums";
import { classificarMultiplo, formatarMultiplo, rotuloMultiploConta } from "@/lib/formatarNumero";
import type { VideoParaEmbed } from "@/servicos/pesquisa";
import type { RoteiroLinha, VersaoRoteiro } from "@/servicos/roteiro";
import { textosComuns } from "@/textos/comuns";
import { textosRoteiro } from "@/textos/roteiro";
import { AreaTexto } from "@/ui/componentes/AreaTexto";
import { BarraTopo } from "@/ui/componentes/BarraTopo";
import { BlocoCenas } from "@/ui/componentes/BlocoCenas";
import { BlocoEdicao, type ItemEdicao } from "@/ui/componentes/BlocoEdicao";
import { CartaoDeOndeVeio } from "@/ui/componentes/CartaoDeOndeVeio";
import chipStyles from "@/ui/componentes/Chips.module.css";
import { PainelFlutuante } from "@/ui/componentes/PainelFlutuante";
import { RoteiroTexto } from "@/ui/componentes/RoteiroTexto";
import { Toast } from "@/ui/componentes/Toast";

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

type Painel = "menu" | "postei" | "reprovar" | "versoes" | null;

type Props = {
  roteiro: RoteiroLinha;
  corpo: ConteudoRoteiro;
  video: VideoParaEmbed | null;
  versoes: VersaoRoteiro[];
};

/**
 * `/roteiros/[id]` (design v2, `entrega/telas/Roteiro.dc.html`; `PROXIMO.md`,
 * D2 parte 1, item 6). Modo gravação virou rota própria
 * (`/roteiros/[id]/gravar`, item 7): o botão daqui só navega.
 */
export function RoteiroTela({ roteiro, corpo, video, versoes }: Props) {
  const router = useRouter();
  const [gravadoEm, setGravadoEm] = useState(roteiro.gravadoEm);
  const [postado, setPostado] = useState(roteiro.status === "postado");
  const [urlPostado, setUrlPostado] = useState(roteiro.urlPostado ?? "");
  const [painel, setPainel] = useState<Painel>(null);
  const botaoMenuRef = useRef<HTMLButtonElement>(null);
  const [urlDigitada, setUrlDigitada] = useState("");
  const [motivosSelecionados, setMotivosSelecionados] = useState<Set<IdMotivoReprovacao>>(new Set());
  const [motivoTexto, setMotivoTexto] = useState("");
  const [erroReprovar, setErroReprovar] = useState(false);
  const [toast, setToast] = useState(false);
  const [erro, setErro] = useState(false);
  const [pendente, iniciarTransicao] = useTransition();

  const versaoAtual = versoes.find((v) => v.id === roteiro.id);
  const idVersaoAtual = versoes.find((v) => v.atual)?.id;

  /** Devolve o foco ao botão que abriu o painel, do jeito que um menu ou uma folha deve fechar. */
  function fecharPainel() {
    setPainel(null);
    botaoMenuRef.current?.focus();
  }

  function gravei() {
    setErro(false);
    iniciarTransicao(async () => {
      try {
        await marcarGravadoAction(roteiro.id);
        setGravadoEm(new Date());
      } catch {
        setErro(true);
      }
    });
  }

  function salvarPostado() {
    if (!urlDigitada.trim()) return;
    setErro(false);
    iniciarTransicao(async () => {
      try {
        await marcarPostadoAction(roteiro.id, urlDigitada.trim());
        setPostado(true);
        setGravadoEm((atual) => atual ?? new Date());
        setUrlPostado(urlDigitada.trim());
        fecharPainel();
      } catch {
        setErro(true);
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
    if (motivosSelecionados.size === 0) return;
    setErroReprovar(false);
    iniciarTransicao(async () => {
      try {
        const { id } = await reprovarERescreverAction(
          roteiro.id,
          [...motivosSelecionados],
          motivoTexto.trim() || undefined,
        );
        router.push(`/roteiros/${id}`);
      } catch {
        setErroReprovar(true);
      }
    });
  }

  async function copiarTexto() {
    try {
      await navigator.clipboard.writeText(textoParaCopiar(corpo));
      fecharPainel();
      setToast(true);
    } catch {
      setErro(true);
    }
  }

  const referencia = corpo.edicao.referencia;

  return (
    <div className={styles.pagina}>
      <BarraTopo
        titulo={textosRoteiro.tituloTela}
        esquerda={
          <Link href="/hoje" aria-label={textosComuns.voltar} className={styles.botaoBarra}>
            <ArrowLeft size={20} strokeWidth={1.75} aria-hidden="true" />
          </Link>
        }
        direita={
          <>
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
              onClick={() => setPainel(painel === "menu" ? null : "menu")}
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
              className={styles.linkReprovar}
            >
              {textosRoteiro.menu.reprovar}
            </button>
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
          />
        ) : corpo.semEvidencia ? (
          <section className={styles.referenciaVazia}>
            <h2>{textosRoteiro.referencia}</h2>
            <p>{textosRoteiro.semEvidencia}</p>
          </section>
        ) : null}

        {/* Outras versões deste tema (design v2): a comparação com nota é a E26, ainda não construída.
            Só a marcação, no estado vazio (PROXIMO.md, D2 parte 1, item 6). */}
        <section className={styles.versoesVazio}>
          <h2>{textosRoteiro.outrasVersoes}</h2>
          <p>{textosRoteiro.outrasVersoesEmBreve}</p>
        </section>
      </div>

      {erro ? <p className={styles.fraseErro}>{textosRoteiro.erro}</p> : null}

      <div className={styles.barraAcoes}>
        <Link href={`/roteiros/${roteiro.id}/gravar`} className={styles.btn}>
          <Video size={18} strokeWidth={1.75} aria-hidden="true" />
          {textosRoteiro.modoGravacao}
        </Link>
        {!gravadoEm ? (
          <button type="button" onClick={gravei} disabled={pendente} className={styles.btnVazio}>
            {textosRoteiro.jaGravei}
          </button>
        ) : !postado ? (
          <button type="button" onClick={() => setPainel("postei")} className={styles.btnVazio}>
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
          className={`${styles.btnVazio} ${styles.somenteTablet}`}
        >
          {textosRoteiro.menu.reprovar}
        </button>
        <a
          href={`/api/roteiros/${roteiro.id}/pdf`}
          aria-label={textosRoteiro.baixarPdf}
          className={`${styles.btnVazio} ${styles.btnIcone} ${styles.somenteTablet}`}
        >
          <Download size={18} strokeWidth={1.75} aria-hidden="true" />
        </a>
      </div>

      <PainelFlutuante titulo={textosRoteiro.maisOpcoes} aberto={painel === "menu"} aoFechar={fecharPainel} role="menu">
        <button
          type="button"
          role="menuitem"
          onClick={() => setPainel("reprovar")}
          className={styles.itemMenu}
        >
          <RotateCcw size={20} strokeWidth={1.5} aria-hidden="true" />
          {textosRoteiro.menu.reprovar}
        </button>
        <button type="button" role="menuitem" onClick={copiarTexto} className={styles.itemMenu}>
          <Copy size={20} strokeWidth={1.5} aria-hidden="true" />
          {textosRoteiro.menu.copiar}
        </button>
        <a href={`/api/roteiros/${roteiro.id}/pdf`} role="menuitem" className={styles.itemMenu}>
          <Download size={20} strokeWidth={1.5} aria-hidden="true" />
          {textosRoteiro.menu.baixarPdf}
        </a>
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
      </PainelFlutuante>

      <PainelFlutuante
        titulo={textosRoteiro.ondePostou}
        aberto={painel === "postei"}
        aoFechar={fecharPainel}
      >
        <h2 className={styles.tituloPainel}>{textosRoteiro.ondePostou}</h2>
        <label className={styles.campo}>
          <span>{textosRoteiro.coleLink}</span>
          <input
            type="url"
            value={urlDigitada}
            onChange={(evento) => setUrlDigitada(evento.target.value)}
            placeholder="https://"
            className={styles.input}
          />
        </label>
        <button type="button" onClick={salvarPostado} disabled={pendente} className={styles.btn}>
          {textosComuns.salvar}
        </button>
      </PainelFlutuante>

      <PainelFlutuante
        titulo={pendente ? textosRoteiro.reprovar.reescrevendo : textosRoteiro.reprovar.tituloFolha}
        aberto={painel === "reprovar"}
        aoFechar={fecharPainel}
      >
        <h2 className={styles.tituloPainel}>
          {pendente ? textosRoteiro.reprovar.reescrevendo : textosRoteiro.reprovar.tituloFolha}
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
                className={[chipStyles.chip, ativo ? chipStyles.ativo : "", styles.chipToqueGrande]
                  .filter(Boolean)
                  .join(" ")}
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
        {erroReprovar ? <p className={styles.fraseErroPainel}>{textosRoteiro.reprovar.erro}</p> : null}
        <button
          type="button"
          onClick={reprovarRoteiro}
          disabled={pendente || motivosSelecionados.size === 0}
          className={styles.btn}
        >
          {pendente ? textosRoteiro.reprovar.reescrevendo : textosRoteiro.reprovar.reescrever}
        </button>
        <p className={styles.avisoTempoReprovar}>
          {motivosSelecionados.size === 0
            ? textosRoteiro.reprovar.semMotivoMarcado
            : textosRoteiro.reprovar.tempoEstimado}
        </p>
        <button type="button" onClick={fecharPainel} className={styles.btnTextoCancelar}>
          {textosRoteiro.reprovar.cancelar}
        </button>
      </PainelFlutuante>

      <PainelFlutuante
        titulo={textosRoteiro.versoesTitulo}
        aberto={painel === "versoes"}
        aoFechar={fecharPainel}
      >
        <h2 className={styles.tituloPainel}>{textosRoteiro.versoesTitulo}</h2>
        <div className={styles.listaVersoes}>
          {versoes.map((v) => (
            <Link key={v.id} href={`/roteiros/${v.id}`} className={styles.itemVersao}>
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
    </div>
  );
}
