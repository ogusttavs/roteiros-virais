"use client";

import { ArrowLeft, Copy, Ellipsis, Eye, History, Music, Scissors, Type, Video } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import type { ConteudoRoteiro } from "@/db/schema";
import { ROTULO_TEMA_CARTAO } from "@/ia/enums";
import type { VideoParaEmbed } from "@/servicos/pesquisa";
import type { RoteiroLinha, VersaoRoteiro } from "@/servicos/roteiro";
import { textosComuns } from "@/textos/comuns";
import { textosRoteiro } from "@/textos/roteiro";
import { BarraTopo } from "@/ui/componentes/BarraTopo";
import { BlocoCenas } from "@/ui/componentes/BlocoCenas";
import { BlocoEdicao, type ItemEdicao } from "@/ui/componentes/BlocoEdicao";
import { CartaoDeOndeVeio } from "@/ui/componentes/CartaoDeOndeVeio";
import { RoteiroTexto } from "@/ui/componentes/RoteiroTexto";
import { Toast } from "@/ui/componentes/Toast";
import { VideoEmbed } from "@/ui/componentes/VideoEmbed";

import { marcarGravadoAction, marcarPostadoAction, outroAnguloAction } from "./acoes";
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

type Painel = "menu" | "postei" | "angulo" | "versoes" | null;

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
  const [urlDigitada, setUrlDigitada] = useState("");
  const [motivoAngulo, setMotivoAngulo] = useState("");
  const [toast, setToast] = useState(false);
  const [erro, setErro] = useState(false);
  const [pendente, iniciarTransicao] = useTransition();

  const versaoAtual = versoes.find((v) => v.id === roteiro.id);
  const idVersaoAtual = versoes.find((v) => v.atual)?.id;

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
        setPainel(null);
      } catch {
        setErro(true);
      }
    });
  }

  function escreverOutraVersao() {
    setErro(false);
    iniciarTransicao(async () => {
      try {
        const { id } = await outroAnguloAction(roteiro.id, motivoAngulo.trim() || undefined);
        router.push(`/roteiros/${id}`);
      } catch {
        setErro(true);
      }
    });
  }

  async function copiarTexto() {
    try {
      await navigator.clipboard.writeText(textoParaCopiar(corpo));
      setPainel(null);
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
            <Link href={`/roteiros/${roteiro.id}/gravar`} className={styles.botaoBarra}>
              <Video size={18} strokeWidth={1.75} aria-hidden="true" />
              <span>{textosRoteiro.modoGravacao}</span>
            </Link>
            <button
              type="button"
              aria-label={textosRoteiro.maisOpcoes}
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
              <button type="button" className={styles.linkVersoes} onClick={() => setPainel("versoes")}>
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
              { rotulo: textosRoteiro.blocos.fechamento, paragrafos: splitParagrafos(corpo.fechamento) },
              { rotulo: textosRoteiro.blocos.chamada, paragrafos: [corpo.chamadaFinal] },
            ]}
          />
        </article>

        <BlocoCenas titulo={textosRoteiro.ondeGravar} cenas={corpo.cenas} />

        <BlocoEdicao titulo={textosRoteiro.comoEditar} itens={itensEdicao(corpo.edicao)} />

        {referencia && video ? (
          <CartaoDeOndeVeio
            titulo={textosRoteiro.referencia}
            conta={video.contaNome ?? video.contaHandle}
            multiplo={`${video.foraDaCurva.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}x`}
            texto={`${textosRoteiro.acimaDoNormalDessaConta} ${video.porQueFuncionou ?? ""}`.trim()}
            segundoFormatado={
              referencia.segundo !== null ? textosRoteiro.trechoComeca(formatarSegundo(referencia.segundo)) : null
            }
            miniatura={
              <VideoEmbed
                url={video.url}
                alt={textosRoteiro.olhaComo(formatarSegundo(referencia.segundo ?? 0))}
                rotuloCarregamento={textosRoteiro.carregandoVideo}
                falhou={video.plataforma !== "youtube"}
                segundoInicial={referencia.segundo ?? undefined}
                linkExterno={{ rotulo: textosRoteiro.abrirReferencia, href: video.url }}
              />
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
        {!gravadoEm ? (
          <button type="button" onClick={gravei} disabled={pendente} className={styles.btn}>
            {textosRoteiro.gravei}
          </button>
        ) : (
          <span className={styles.rotuloFeito}>{textosRoteiro.gravadoAs(formatarHora(gravadoEm))}</span>
        )}
        {!postado ? (
          <button type="button" onClick={() => setPainel("postei")} className={styles.btnVazio}>
            {textosRoteiro.postei}
          </button>
        ) : (
          <a href={urlPostado} target="_blank" rel="noreferrer" className={styles.btnVazio}>
            {textosRoteiro.postado}
          </a>
        )}
      </div>

      {painel === "menu" ? (
        <div role="menu" className={styles.formularioPainel}>
          <button type="button" role="menuitem" onClick={() => setPainel("angulo")} className={styles.itemMenu}>
            <Video size={20} strokeWidth={1.5} aria-hidden="true" />
            {textosRoteiro.menu.angulo}
          </button>
          <button type="button" role="menuitem" onClick={copiarTexto} className={styles.itemMenu}>
            <Copy size={20} strokeWidth={1.5} aria-hidden="true" />
            {textosRoteiro.menu.copiar}
          </button>
          {versoes.length > 1 ? (
            <button type="button" role="menuitem" onClick={() => setPainel("versoes")} className={styles.itemMenu}>
              <History size={20} strokeWidth={1.5} aria-hidden="true" />
              {textosRoteiro.menu.versoes}
            </button>
          ) : null}
        </div>
      ) : null}

      {painel === "postei" ? (
        <div className={styles.formularioPainel}>
          <h2>{textosRoteiro.ondePostou}</h2>
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
        </div>
      ) : null}

      {painel === "angulo" ? (
        <div className={styles.formularioPainel}>
          <h2>{textosRoteiro.menu.angulo}</h2>
          <label className={styles.campo}>
            <span>
              {textosRoteiro.queDiferente} <span className={styles.opcional}>{textosRoteiro.opcional}</span>
            </span>
            <textarea
              value={motivoAngulo}
              onChange={(evento) => setMotivoAngulo(evento.target.value)}
              rows={3}
              className={styles.textarea}
            />
          </label>
          <button type="button" onClick={escreverOutraVersao} disabled={pendente} className={styles.btn}>
            {textosRoteiro.outraVersao}
          </button>
        </div>
      ) : null}

      {painel === "versoes" ? (
        <div className={styles.formularioPainel}>
          <h2>{textosRoteiro.versoesTitulo}</h2>
          <div className={styles.listaVersoes}>
            {versoes.map((v) => (
              <Link key={v.id} href={`/roteiros/${v.id}`} className={styles.itemVersao}>
                <span className={styles.textoVersao}>
                  <span>
                    {textosRoteiro.versao(v.versao, Math.max(...versoes.map((x) => x.versao)))}
                    {v.atual ? `, ${textosRoteiro.atual}` : ""}
                  </span>
                  <span className={styles.horaVersao}>{formatarHora(v.criadoEm)}</span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      <Toast texto={textosRoteiro.textoCopiado} aberto={toast} onFechar={() => setToast(false)} />
    </div>
  );
}
