"use client";

import { CircleAlert, Download, Send, Upload } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { LIMITES_DA_EDICAO } from "@/config/edicao";
import { tipoDeVideoAceito } from "@/config/publicacao";
import { ehFalhaDeRede } from "@/lib/offline";
import type { VisaoDeEditar, VistaCompletaDaEdicao } from "@/servicos/edicao-tela";
import { fraseDaEdicao, textosEdicao } from "@/textos/edicao";
import { AreaTexto } from "@/ui/componentes/AreaTexto";
import { Botao } from "@/ui/componentes/Botao";
import { useTratarFalha } from "@/ui/ConexaoContext";

import { aprovarEdicaoAction, refazerEdicaoAction } from "./edicao-acoes";
import styles from "./EditarMeuVideo.module.css";
import { lerDuracao, megasDoArquivo } from "./PublicarNoInstagram";

const t = textosEdicao.tela;

/** Perguntar de novo a cada 3 segundos enquanto a edição anda (a prévia leva de dezenas de segundos a alguns minutos). */
const ESPERA_DA_CONSULTA_MS = 3000;
const ESTADOS_PARADOS = new Set(["previa_pronta", "pronta", "falhou", "para_revisao", "expirada"]);
/** Os passos antes de o plano existir: o servidor ouve o vídeo e decide o que fica. */
const ESTADOS_DE_PREPARO = new Set(["guardado", "transcrevendo", "transcrito", "decidindo", "decidido"]);

type Props = {
  roteiroId: number;
  visao: VisaoDeEditar;
  /** Enquanto o vídeo sobe, a folha não fecha. */
  aoEnviando: (enviando: boolean) => void;
  semConexao: boolean;
  /** O vídeo pronto vai para a folha de publicar no Instagram (que reaproveita a conta, a legenda e as conferências da E56). */
  aoPublicar: (edicaoId: number, duracaoS: number | null) => void;
  /** A folha de publicar diz ao pai qual edição está pronta para publicar. */
  aoMudarEdicao?: (edicao: VistaCompletaDaEdicao | null) => void;
};

function diaDoPrazo(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "numeric", month: "long" });
}

/** A vista de uma edição que acabou de ser aberta, antes de o servidor responder de novo. */
function vistaNova(id: number, roteiroId: number): VistaCompletaDaEdicao {
  return {
    id,
    roteiroId,
    estado: "guardado",
    motivo: null,
    progresso: null,
    aFrente: null,
    esperaMin: null,
    avisos: [],
    duracaoDoVideoS: null,
    temPrevia: false,
    temVideoPronto: false,
    refazeresRestantes: 3,
    prontoAte: null,
  };
}

/**
 * O corpo da folha "Editar o meu vídeo" do roteiro (E47 PR 4). Mostra, do começo ao fim: escolher e enviar o vídeo (com o andamento), a espera (ouvindo o vídeo, na vez, montando a prévia, com a
 * posição na fila), a prévia para assistir com Aprovar e "Pedir ajuste" (o motivo entra na próxima decisão), o vídeo final montando, e por fim baixar o vídeo e a legenda ou publicar no Instagram.
 * A tela pergunta ao servidor de tempos em tempos enquanto a edição anda; fechar a folha não perde nada (o trabalho é do servidor). Usa as peças da tela do roteiro: botão e área de texto.
 */
export function EditarMeuVideo({ roteiroId, visao, aoEnviando, semConexao, aoPublicar, aoMudarEdicao }: Props) {
  const tratarFalha = useTratarFalha();
  const idArquivo = useId();
  const [edicao, setEdicao] = useState<VistaCompletaDaEdicao | null>(visao.edicao);
  const [usadas, setUsadas] = useState(visao.uso.usadas);
  const [novoEnvio, setNovoEnvio] = useState(false);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [duracao, setDuracao] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [comecando, setComecando] = useState(false);
  const [porcento, setPorcento] = useState<number | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [pedindoAjuste, setPedindoAjuste] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [refeito, setRefeito] = useState(false);
  const [videoQuebrou, setVideoQuebrou] = useState(false);
  const requisicao = useRef<XMLHttpRequest | null>(null);
  const aoMudarEdicaoRef = useRef(aoMudarEdicao);
  useEffect(() => {
    aoMudarEdicaoRef.current = aoMudarEdicao;
  }, [aoMudarEdicao]);

  const enviando = comecando || porcento !== null;
  useEffect(() => {
    aoEnviando(enviando);
    return () => aoEnviando(false);
  }, [enviando, aoEnviando]);

  useEffect(() => {
    aoMudarEdicaoRef.current?.(edicao);
  }, [edicao]);

  useEffect(() => {
    let vigente = true;
    setDuracao(null);
    if (arquivo) void lerDuracao(arquivo).then((d) => vigente && setDuracao(d));
    return () => {
      vigente = false;
    };
  }, [arquivo]);

  // Fechar a página no meio do envio interrompe o envio (o servidor solta o roteiro depois de um tempo).
  useEffect(() => () => requisicao.current?.abort(), []);

  // Enquanto a edição anda, a folha pergunta ao servidor, uma consulta de cada vez.
  const idEmAndamento = edicao && !ESTADOS_PARADOS.has(edicao.estado) && edicao.estado !== "subindo" && !enviando ? edicao.id : undefined;
  useEffect(() => {
    if (idEmAndamento === undefined) return;
    let vigente = true;
    let espera: ReturnType<typeof setTimeout> | undefined;
    async function consultar() {
      try {
        const resposta = await fetch(`/api/edicao/${idEmAndamento}`, { cache: "no-store" });
        if (!vigente) return;
        if (resposta.ok) {
          const dados = (await resposta.json()) as VistaCompletaDaEdicao & { uso?: { usadas: number } };
          if (!vigente) return;
          setEdicao((atual) => (atual && atual.id === dados.id ? { ...atual, ...dados } : atual));
          if (dados.uso) setUsadas(dados.uso.usadas);
          if (ESTADOS_PARADOS.has(dados.estado)) return;
        }
      } catch {
        // Sem rede ou erro passageiro: pergunta de novo daqui a pouco.
      }
      if (vigente) espera = setTimeout(() => void consultar(), ESPERA_DA_CONSULTA_MS);
    }
    espera = setTimeout(() => void consultar(), 1500);
    return () => {
      vigente = false;
      if (espera) clearTimeout(espera);
    };
  }, [idEmAndamento]);

  const problemaDeDuracao =
    duracao === null || arquivo === null
      ? null
      : duracao < LIMITES_DA_EDICAO.duracaoMinS
        ? fraseDaEdicao("curto")
        : duracao > LIMITES_DA_EDICAO.duracaoMaxS + LIMITES_DA_EDICAO.duracaoToleranciaS
          ? fraseDaEdicao("longo")
          : null;

  function escolherArquivo(lista: FileList | null) {
    const novo = lista?.[0] ?? null;
    setErro(null);
    if (!novo) return;
    if (!tipoDeVideoAceito(novo.type, novo.name)) {
      setArquivo(null);
      setErro(fraseDaEdicao("arquivo-tipo"));
      return;
    }
    if (novo.size > LIMITES_DA_EDICAO.bytesMax) {
      setArquivo(null);
      setErro(fraseDaEdicao("arquivo-grande"));
      return;
    }
    setArquivo(novo);
  }

  function enviarBytes(id: number, video: File): Promise<void> {
    return new Promise((resolver, rejeitar) => {
      const xhr = new XMLHttpRequest();
      requisicao.current = xhr;
      xhr.open("PUT", `/api/edicao/${id}/video`);
      xhr.setRequestHeader("Content-Type", video.type || "video/mp4");
      xhr.upload.onprogress = (evento) => {
        if (evento.lengthComputable) setPorcento(Math.min(99, Math.floor((evento.loaded / evento.total) * 100)));
      };
      xhr.onload = () => {
        requisicao.current = null;
        if (xhr.status >= 200 && xhr.status < 300) return resolver();
        let frase: string = t.erroGenerico;
        try {
          const corpo = JSON.parse(xhr.responseText) as { erro?: unknown };
          if (typeof corpo.erro === "string" && corpo.erro) frase = corpo.erro;
        } catch {
          // A resposta não era a nossa: fica a frase geral.
        }
        rejeitar(new Error(frase));
      };
      xhr.onerror = () => {
        requisicao.current = null;
        rejeitar(new TypeError("Failed to fetch"));
      };
      xhr.onabort = () => {
        requisicao.current = null;
        rejeitar(new Error(fraseDaEdicao("envio-interrompido")));
      };
      xhr.send(video);
    });
  }

  async function enviar() {
    if (comecando || enviando || semConexao) return;
    if (!arquivo) {
      setErro(t.escolherVideo);
      return;
    }
    if (problemaDeDuracao) {
      setErro(problemaDeDuracao);
      return;
    }
    setErro(null);
    setComecando(true);
    setPorcento(0);
    try {
      const abriu = await fetch("/api/edicao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roteiroId, tamanhoBytes: arquivo.size, tipoDoArquivo: arquivo.type, nomeDoArquivo: arquivo.name }),
      });
      const corpo = (await abriu.json().catch(() => ({}))) as { id?: number; usadas?: number; erro?: string };
      if (!abriu.ok || typeof corpo.id !== "number") {
        setErro(corpo.erro ?? t.erroGenerico);
        return;
      }
      setComecando(false);
      if (typeof corpo.usadas === "number") setUsadas(corpo.usadas);
      await enviarBytes(corpo.id, arquivo);
      setPorcento(100);
      setNovoEnvio(false);
      setArquivo(null);
      setPedindoAjuste(false);
      setRefeito(false);
      setEdicao(vistaNova(corpo.id, roteiroId));
    } catch (falha) {
      setErro(falha instanceof Error && !ehFalhaDeRede(falha) ? falha.message : tratarFalha(falha, t.erroGenerico, t.semConexao));
    } finally {
      setComecando(false);
      setPorcento(null);
    }
  }

  function cancelarEnvio() {
    requisicao.current?.abort();
  }

  const aprovar = useCallback(async () => {
    if (!edicao || ocupado) return;
    setOcupado(true);
    setErro(null);
    try {
      const r = await aprovarEdicaoAction(edicao.id);
      if (!r.ok) {
        setErro(r.erro);
        return;
      }
      setEdicao({ ...edicao, estado: "aprovada", progresso: null, aFrente: null, esperaMin: null });
    } catch (falha) {
      setErro(tratarFalha(falha, t.erroGenerico, t.semConexao));
    } finally {
      setOcupado(false);
    }
  }, [edicao, ocupado, tratarFalha]);

  async function refazer() {
    if (!edicao || ocupado) return;
    if (motivo.trim() === "") {
      setErro(fraseDaEdicao("motivo-vazio"));
      return;
    }
    setOcupado(true);
    setErro(null);
    try {
      const r = await refazerEdicaoAction(edicao.id, motivo);
      if (!r.ok) {
        setErro(r.erro);
        return;
      }
      setEdicao({ ...edicao, estado: "transcrito", temPrevia: false, refazeresRestantes: Math.max(0, edicao.refazeresRestantes - 1), avisos: [] });
      setMotivo("");
      setPedindoAjuste(false);
      setRefeito(true);
      setVideoQuebrou(false);
    } catch (falha) {
      setErro(tratarFalha(falha, t.erroGenerico, t.semConexao));
    } finally {
      setOcupado(false);
    }
  }

  // ---------------------------------------------------------------------------
  // O que a folha mostra
  // ---------------------------------------------------------------------------

  if (visao.verComo) {
    return (
      <section className={styles.corpo} data-parte="ver-como">
        <h2 className={styles.titulo}>{t.titulo}</h2>
        <p className={styles.explica}>{t.verComo}</p>
      </section>
    );
  }

  const barra = (valor: number | null | undefined, rotulo: string) => (
    <progress className={styles.barra} max={100} value={valor ?? undefined} aria-label={rotulo} />
  );

  if (enviando) {
    return (
      <section className={styles.corpo} data-parte="enviando">
        <h2 className={styles.titulo}>{t.titulo}</h2>
        <p className={styles.explica} role="status">
          {porcento === null ? t.enviandoSemNumero : t.enviando(porcento)}
        </p>
        {barra(porcento, t.enviandoSemNumero)}
        <p className={styles.nota}>{t.naoFechar}</p>
        <Botao type="button" variante="ghost" onClick={cancelarEnvio}>
          {t.cancelarEnvio}
        </Botao>
      </section>
    );
  }

  const estado = edicao?.estado;
  const podeMostrarEdicao = edicao !== null && !novoEnvio && estado !== "falhou" && estado !== "expirada";

  if (podeMostrarEdicao && edicao) {
    if (estado === "subindo" || (estado && ESTADOS_DE_PREPARO.has(estado))) {
      return (
        <section className={styles.corpo} data-parte="preparando">
          <h2 className={styles.titulo}>{t.titulo}</h2>
          {refeito ? <p className={styles.sucesso}>{t.refazeu}</p> : null}
          <p className={styles.explica} role="status">
            {t.preparando}
          </p>
          {barra(null, t.preparando)}
        </section>
      );
    }

    if (estado === "verificado" || estado === "aprovada") {
      const ehFinal = estado === "aprovada";
      return (
        <section className={styles.corpo} data-parte={ehFinal ? "fila-do-final" : "fila-da-previa"}>
          <h2 className={styles.titulo}>{t.titulo}</h2>
          <p className={styles.explica} role="status">
            {t.esperandoAVez(edicao.aFrente ?? 0, edicao.esperaMin ?? 1)}
          </p>
          {barra(null, t.montandoSemNumero)}
          <p className={styles.nota}>{t.semMusica}</p>
        </section>
      );
    }

    if (estado === "montando_previa" || estado === "montando_final") {
      const ehFinal = estado === "montando_final";
      const valor = edicao.progresso ?? 0;
      return (
        <section className={styles.corpo} data-parte={ehFinal ? "montando-final" : "montando-previa"}>
          <h2 className={styles.titulo}>{t.titulo}</h2>
          <p className={styles.explica} role="status">
            {ehFinal ? t.montandoFinal(valor) : t.montandoPrevia(valor)}
          </p>
          {barra(valor, t.montandoSemNumero)}
          <p className={styles.nota}>{t.semMusica}</p>
        </section>
      );
    }

    if (estado === "previa_pronta") {
      return (
        <section className={styles.corpo} data-parte="previa-pronta">
          <h2 className={styles.titulo}>{t.previaTitulo}</h2>
          <video className={styles.video} controls playsInline preload="metadata" src={`/api/edicao/${edicao.id}/previa`} onError={() => setVideoQuebrou(true)} data-previa />
          {videoQuebrou ? <p className={styles.erro}>{t.videoNaoAbriu}</p> : null}
          <p className={styles.nota}>{t.previaAjuda}</p>
          {edicao.avisos.length > 0 ? (
            <div className={styles.avisos} data-parte="avisos">
              <p className={styles.avisosTitulo}>{t.avisosTitulo}</p>
              <ul>
                {edicao.avisos.map((aviso) => (
                  <li key={aviso}>{aviso}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className={styles.nota}>{t.semMusica}</p>

          {erro ? (
            <p className={styles.erro} role="alert">
              <CircleAlert size={18} strokeWidth={1.75} aria-hidden="true" />
              {erro}
            </p>
          ) : null}

          {pedindoAjuste ? (
            <div className={styles.ajuste} data-parte="pedir-ajuste">
              <AreaTexto rotulo={t.refazerRotulo} ajuda={t.refazerAjuda} value={motivo} onChange={(e) => setMotivo(e.target.value)} linhasMin={3} maxLength={300} />
              <p className={styles.nota}>{t.refazerRestantes(edicao.refazeresRestantes)}</p>
              <div className={styles.botoes}>
                <Botao type="button" precisaDeRede disabled={ocupado || semConexao || motivo.trim() === ""} carregando={ocupado} onClick={refazer}>
                  {t.refazerEnviar}
                </Botao>
                <Botao
                  type="button"
                  variante="ghost"
                  onClick={() => {
                    setPedindoAjuste(false);
                    setErro(null);
                  }}
                >
                  {t.refazerVoltar}
                </Botao>
              </div>
            </div>
          ) : (
            <div className={styles.botoes}>
              <Botao type="button" precisaDeRede disabled={ocupado || semConexao} carregando={ocupado} onClick={aprovar}>
                {t.aprovar}
              </Botao>
              {edicao.refazeresRestantes > 0 ? (
                <Botao type="button" variante="secundario" onClick={() => setPedindoAjuste(true)}>
                  {t.refazer}
                </Botao>
              ) : null}
            </div>
          )}
        </section>
      );
    }

    if (estado === "pronta") {
      return (
        <section className={styles.corpo} data-parte="pronta">
          <h2 className={styles.titulo}>{t.prontoTitulo}</h2>
          <video className={styles.video} controls playsInline preload="metadata" src={`/api/edicao/${edicao.id}/pronto`} onError={() => setVideoQuebrou(true)} data-pronto />
          {videoQuebrou ? <p className={styles.erro}>{t.videoNaoAbriu}</p> : null}
          {edicao.prontoAte ? <p className={styles.nota}>{t.prontoAjuda(diaDoPrazo(edicao.prontoAte))}</p> : null}
          <p className={styles.nota}>{t.semMusica}</p>
          <div className={styles.botoes}>
            <a className={styles.botaoLink} href={`/api/edicao/${edicao.id}/pronto?baixar=1`} download="video-editado.mp4" data-baixar-video>
              <Download size={18} strokeWidth={1.75} aria-hidden="true" />
              {t.baixarVideo}
            </a>
            <a className={styles.botaoLinkSecundario} href={`/api/edicao/${edicao.id}/legenda`} download="legenda.srt" data-baixar-legenda>
              <Download size={18} strokeWidth={1.75} aria-hidden="true" />
              {t.baixarLegenda}
            </a>
          </div>
          <p className={styles.nota}>{t.legendaAjuda}</p>
          {visao.podePublicar ? (
            <Botao type="button" variante="secundario" onClick={() => aoPublicar(edicao.id, edicao.duracaoDoVideoS)} data-publicar-edicao>
              <Send size={18} strokeWidth={1.75} aria-hidden="true" />
              {t.publicar}
            </Botao>
          ) : null}
          <Botao
            type="button"
            variante="ghost"
            onClick={() => {
              setNovoEnvio(true);
              setVideoQuebrou(false);
            }}
          >
            {t.novoVideo}
          </Botao>
        </section>
      );
    }

    // `para_revisao`: não segue sozinha.
    return (
      <section className={styles.corpo} data-parte="para-revisao">
        <h2 className={styles.titulo}>{t.revisaoTitulo}</h2>
        <p className={styles.explica}>{edicao.motivo ?? fraseDaEdicao("em-revisao")}</p>
        <Botao type="button" variante="ghost" onClick={() => setNovoEnvio(true)}>
          {t.novoVideo}
        </Botao>
      </section>
    );
  }

  // O formulário de enviar: sem edição, com uma que falhou ou que já saiu do servidor, ou quando a pessoa quer enviar outro vídeo.
  const motivoDaFalha = !novoEnvio && estado === "falhou" ? edicao?.motivo : null;
  return (
    <section className={styles.corpo} data-parte="formulario">
      <h2 className={styles.titulo}>{t.titulo}</h2>
      <p className={styles.explica}>{t.explica}</p>
      {motivoDaFalha ? (
        <p className={styles.erro} role="alert" data-parte="motivo-da-falha">
          <CircleAlert size={18} strokeWidth={1.75} aria-hidden="true" />
          {motivoDaFalha}
        </p>
      ) : null}
      <p className={styles.nota}>{t.regras}</p>
      <p className={styles.nota}>{t.semMusica}</p>

      <div className={styles.arquivo}>
        <input id={idArquivo} className={styles.inputArquivo} type="file" accept="video/mp4,video/quicktime,.mp4,.mov" onChange={(evento) => escolherArquivo(evento.target.files)} />
        <label htmlFor={idArquivo} className={styles.botaoArquivo}>
          <Upload size={18} strokeWidth={1.75} aria-hidden="true" />
          {arquivo ? t.trocarVideo : t.escolherVideo}
        </label>
        {arquivo ? <span className={styles.nomeDoArquivo}>{t.videoEscolhido(arquivo.name, megasDoArquivo(arquivo.size))}</span> : null}
      </div>

      {erro ?? problemaDeDuracao ? (
        <p className={styles.erro} role="alert">
          <CircleAlert size={18} strokeWidth={1.75} aria-hidden="true" />
          {erro ?? problemaDeDuracao}
        </p>
      ) : null}

      <Botao type="button" precisaDeRede disabled={!arquivo || semConexao} onClick={enviar}>
        {t.enviar}
      </Botao>
      <p className={styles.nota}>{t.usadas(usadas)}</p>
    </section>
  );
}
