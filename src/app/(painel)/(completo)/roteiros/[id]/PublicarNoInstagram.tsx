"use client";

import { Check, CircleAlert, ExternalLink, Upload } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { LIMITES_DA_LEGENDA, LIMITES_DA_PUBLICACAO, tipoDeVideoAceito } from "@/config/publicacao";
import type { TipoDePublicacao } from "@/db/schema";
import { problemaDaLegenda } from "@/lib/legenda-do-instagram";
import { ehFalhaDeRede } from "@/lib/offline";
import type { VisaoDePublicar, VistaDaPublicacao } from "@/servicos/publicar-instagram";
import { fraseDeFalha, fraseDeRecusa, textosPublicar } from "@/textos/publicar";
import { AreaTexto } from "@/ui/componentes/AreaTexto";
import { Botao } from "@/ui/componentes/Botao";
import { Chips } from "@/ui/componentes/Chips";
import { useTratarFalha } from "@/ui/ConexaoContext";

import { cancelarEnvioAction, conferirPublicacaoAction, iniciarPublicacaoAction } from "./publicar-acoes";
import styles from "./PublicarNoInstagram.module.css";

const t = textosPublicar.tela;
/** De quanto em quanto tempo a folha pergunta se o vídeo já foi publicado, enquanto está aberta. */
const INTERVALO_DA_CONFERENCIA_MS = 6000;

const OPCOES: TipoDePublicacao[] = ["reels", "story"];
const ROTULOS = [t.reels, t.story];

function megasDoArquivo(bytes: number): string {
  return (bytes / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
}

function duracaoPorExtenso(segundos: number): string {
  if (segundos >= 120 && segundos % 60 === 0) return `${segundos / 60} minutos`;
  return `${segundos} segundos`;
}

/** A duração do vídeo, lida no próprio aparelho (o navegador só lê o cabeçalho). `null` quando ele não consegue (alguns formatos de celular em computador): a Meta confere do mesmo jeito. */
function lerDuracao(arquivo: File): Promise<number | null> {
  return new Promise((resolver) => {
    const endereco = URL.createObjectURL(arquivo);
    const video = document.createElement("video");
    const terminar = (valor: number | null) => {
      URL.revokeObjectURL(endereco);
      video.removeAttribute("src");
      resolver(valor);
    };
    const prazo = setTimeout(() => terminar(null), 4000);
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      clearTimeout(prazo);
      terminar(Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null);
    };
    video.onerror = () => {
      clearTimeout(prazo);
      terminar(null);
    };
    video.src = endereco;
  });
}

type Props = {
  roteiroId: number;
  visao: VisaoDePublicar;
  /** A publicação mais recente deste roteiro (o pai guarda; a folha pode fechar e abrir sem perder). */
  publicacao: VistaDaPublicacao | null;
  aoMudar: (vista: VistaDaPublicacao) => void;
  /** Enquanto o vídeo sobe, a folha não fecha. */
  aoEnviando: (enviando: boolean) => void;
  semConexao: boolean;
};

/**
 * O conteúdo da folha "Publicar no Instagram" do roteiro (E56 PR 1). Reels ou Story, o vídeo que a pessoa já gravou, a legenda do roteiro já preenchida e editável. O vídeo sobe pelo aplicativo
 * direto para a Meta (`PUT /api/publicar/<id>/video`), com o andamento; depois a Meta prepara e o aplicativo publica, e a folha pergunta de tempos em tempos até terminar (o worker também
 * confere, então fechar a folha não perde nada). Usa as peças da tela do roteiro: folha, chips, área de texto e botão.
 */
export function PublicarNoInstagram({ roteiroId, visao, publicacao, aoMudar, aoEnviando, semConexao }: Props) {
  const tratarFalha = useTratarFalha();
  const idArquivo = useId();
  const [tipo, setTipo] = useState<TipoDePublicacao>(visao.tipoInicial);
  const [legenda, setLegenda] = useState(visao.legenda);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [duracao, setDuracao] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [comecando, setComecando] = useState(false);
  const [porcento, setPorcento] = useState<number | null>(null);
  const requisicao = useRef<XMLHttpRequest | null>(null);
  const publicacaoRef = useRef(publicacao);
  useEffect(() => {
    publicacaoRef.current = publicacao;
  }, [publicacao]);

  const estado = publicacao?.estado;
  // Subindo agora, por esta folha; ou um envio de antes (a página recarregou no meio) que só dá para cancelar.
  const enviando = comecando || (estado === "enviando" && porcento !== null);
  const envioOrfao = estado === "enviando" && porcento === null && !comecando;
  const esperando = estado === "processando" || estado === "publicando";

  useEffect(() => {
    aoEnviando(enviando);
    return () => aoEnviando(false);
  }, [enviando, aoEnviando]);

  // Quanto mais cedo o arquivo é lido, mais cedo a pessoa sabe se a duração não serve.
  useEffect(() => {
    let vigente = true;
    setDuracao(null);
    if (arquivo) void lerDuracao(arquivo).then((d) => vigente && setDuracao(d));
    return () => {
      vigente = false;
    };
  }, [arquivo]);

  // Enquanto o Instagram prepara o vídeo, a folha pergunta (e a pergunta é o que publica, se o worker ainda não o fez).
  const conferir = useCallback(
    async (id: number) => {
      try {
        const resultado = await conferirPublicacaoAction(id);
        if (resultado.ok) aoMudar(resultado.dado.vista);
      } catch {
        // Sem rede ou erro passageiro: pergunta de novo na próxima volta.
      }
    },
    [aoMudar],
  );
  const idEmEspera = esperando ? publicacao?.id : undefined;
  useEffect(() => {
    if (idEmEspera === undefined) return;
    void conferir(idEmEspera);
    const volta = setInterval(() => void conferir(idEmEspera), INTERVALO_DA_CONFERENCIA_MS);
    return () => clearInterval(volta);
  }, [idEmEspera, conferir]);

  // Fechar a página no meio do envio: o envio é interrompido (a Meta nunca recebe o vídeo inteiro) e o servidor libera o roteiro depois de um tempo.
  useEffect(() => () => requisicao.current?.abort(), []);

  const limites = LIMITES_DA_PUBLICACAO[tipo];
  const problemaDeDuracao =
    duracao === null || arquivo === null
      ? null
      : duracao < limites.segundosMin
        ? t.duracaoCurta(limites.segundosMin)
        : duracao > limites.segundosMax
          ? t.duracaoLonga(tipo, duracaoPorExtenso(limites.segundosMax))
          : null;

  function escolherArquivo(lista: FileList | null) {
    const novo = lista?.[0] ?? null;
    setErro(null);
    if (!novo) return;
    if (!tipoDeVideoAceito(novo.type, novo.name)) {
      setArquivo(null);
      setErro(fraseDeRecusa("arquivo-tipo", tipo));
      return;
    }
    setArquivo(novo);
  }

  function enviarBytes(id: number, video: File): Promise<void> {
    return new Promise((resolver, rejeitar) => {
      const xhr = new XMLHttpRequest();
      requisicao.current = xhr;
      xhr.open("PUT", `/api/publicar/${id}/video`);
      xhr.setRequestHeader("Content-Type", video.type || "video/mp4");
      xhr.upload.onprogress = (evento) => {
        if (evento.lengthComputable) setPorcento(Math.min(99, Math.floor((evento.loaded / evento.total) * 100)));
      };
      xhr.onload = () => {
        requisicao.current = null;
        if (xhr.status >= 200 && xhr.status < 300) return resolver();
        let frase = t.erroGenerico;
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
        rejeitar(new Error(fraseDeFalha("envio-interrompido", tipo)));
      };
      xhr.send(video);
    });
  }

  async function publicar() {
    if (comecando || enviando || semConexao) return;
    if (!arquivo) {
      setErro(t.escolherVideo);
      return;
    }
    const problemaLegenda = tipo === "reels" ? problemaDaLegenda(legenda) : null;
    if (problemaLegenda) {
      setErro(fraseDeRecusa(problemaLegenda, tipo));
      return;
    }
    if (problemaDeDuracao) {
      setErro(problemaDeDuracao);
      return;
    }
    setErro(null);
    setComecando(true);
    setPorcento(0);
    let id: number | null = null;
    try {
      const inicio = await iniciarPublicacaoAction(roteiroId, { tipo, legenda, tamanhoBytes: arquivo.size, tipoDoArquivo: arquivo.type, nomeDoArquivo: arquivo.name });
      if (!inicio.ok) {
        setErro(inicio.erro);
        return;
      }
      id = inicio.dado.publicacaoId;
      aoMudar({ id, tipo, estado: "enviando", motivo: null, permalink: null });
      setComecando(false);
      await enviarBytes(id, arquivo);
      setPorcento(100);
      aoMudar({ id, tipo, estado: "processando", motivo: null, permalink: null });
    } catch (falha) {
      // O servidor já marcou a falha (e a frase); a folha mostra a mesma e deixa tentar de novo.
      const frase = falha instanceof Error && !ehFalhaDeRede(falha) ? falha.message : tratarFalha(falha, t.erroGenerico, t.semConexao);
      setErro(frase);
      if (id !== null) aoMudar({ id, tipo, estado: "falhou", motivo: frase, permalink: null });
    } finally {
      setComecando(false);
      setPorcento(null);
    }
  }

  async function cancelar() {
    requisicao.current?.abort();
    const id = publicacaoRef.current?.id;
    if (id === undefined) return;
    try {
      const resultado = await cancelarEnvioAction(id);
      if (resultado.ok) aoMudar(resultado.dado.vista);
    } catch {
      // O servidor também solta o roteiro sozinho depois de um tempo.
    }
  }

  // ---------------------------------------------------------------------------
  // O que a folha mostra
  // ---------------------------------------------------------------------------

  if (estado === "publicada" && publicacao) {
    return (
      <section className={styles.corpo} data-parte="publicada">
        <h2 className={styles.titulo}>{t.titulo}</h2>
        <p className={styles.sucesso} role="status">
          <Check size={20} strokeWidth={1.75} aria-hidden="true" />
          {publicacao.permalink ? t.publicada : t.publicadaSemLink}
        </p>
        {publicacao.permalink ? (
          <a href={publicacao.permalink} target="_blank" rel="noreferrer" className={styles.link}>
            <ExternalLink size={18} strokeWidth={1.75} aria-hidden="true" />
            {t.verNoInstagram}
          </a>
        ) : null}
        <p className={styles.nota}>{t.marcadoComoPostado}</p>
      </section>
    );
  }

  if (!visao.situacao.pode) {
    const levaAConta = ["sem-conta", "sem-permissao", "acesso-perdido"].includes(visao.situacao.codigo);
    return (
      <section className={styles.corpo} data-parte="sem-condicao" data-motivo={visao.situacao.codigo}>
        <h2 className={styles.titulo}>{t.titulo}</h2>
        <p className={styles.explica}>{visao.situacao.frase}</p>
        {levaAConta ? (
          <Link href="/conta" className={styles.link}>
            {t.irParaConta}
          </Link>
        ) : null}
      </section>
    );
  }

  if (envioOrfao) {
    return (
      <section className={styles.corpo} data-parte="envio-anterior">
        <h2 className={styles.titulo}>{t.titulo}</h2>
        <p className={styles.explica}>{t.envioAnterior}</p>
        <Botao type="button" variante="secundario" precisaDeRede onClick={cancelar}>
          {t.cancelar}
        </Botao>
      </section>
    );
  }

  if (enviando) {
    return (
      <section className={styles.corpo} data-parte="enviando">
        <h2 className={styles.titulo}>{t.titulo}</h2>
        <p className={styles.explica} role="status">
          {porcento === null ? t.enviandoSemNumero : t.enviando(porcento)}
        </p>
        <progress className={styles.barra} max={100} value={porcento ?? undefined} aria-label={t.enviandoSemNumero} />
        <p className={styles.nota}>{t.naoFechar}</p>
        <Botao type="button" variante="ghost" onClick={cancelar}>
          {t.cancelar}
        </Botao>
      </section>
    );
  }

  if (esperando) {
    return (
      <section className={styles.corpo} data-parte="processando">
        <h2 className={styles.titulo}>{t.titulo}</h2>
        <p className={styles.explica} role="status">
          {estado === "publicando" ? t.publicando : t.processando}
        </p>
        <progress className={styles.barra} max={100} aria-label={t.processando} />
      </section>
    );
  }

  const motivoDaFalha = estado === "falhou" ? publicacao?.motivo : null;
  const contador = tipo === "reels" ? t.contador([...legenda].length) : undefined;
  return (
    <section className={styles.corpo} data-parte="formulario">
      <h2 className={styles.titulo}>{t.titulo}</h2>
      <p className={styles.explica}>{t.sai(visao.situacao.conta)}</p>
      {motivoDaFalha ? (
        <p className={styles.erro} role="alert" data-parte="motivo-da-falha">
          <CircleAlert size={18} strokeWidth={1.75} aria-hidden="true" />
          {motivoDaFalha}
        </p>
      ) : null}

      <Chips rotuloGrupo={t.ondeRotulo} rotuloVisivel={t.ondeRotulo} opcoes={ROTULOS} selecionado={OPCOES.indexOf(tipo)} onChange={(i) => setTipo(OPCOES[i])} />
      <p className={styles.nota}>{tipo === "story" ? t.ajudaStory(visao.megas.story) : t.ajudaReels(visao.megas.reels)}</p>

      {tipo === "reels" ? (
        <AreaTexto
          rotulo={t.legenda}
          ajuda={t.legendaAjuda}
          value={legenda}
          onChange={(evento) => {
            setLegenda(evento.target.value);
            setErro(null);
          }}
          contador={contador}
          linhasMin={5}
          maxLength={LIMITES_DA_LEGENDA.caracteres * 2}
        />
      ) : null}

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

      <Botao type="button" precisaDeRede disabled={!arquivo || semConexao} onClick={publicar}>
        {motivoDaFalha ? t.tentarDeNovo : t.publicar}
      </Botao>
      <p className={styles.nota}>{t.avisoFinal}</p>
    </section>
  );
}
