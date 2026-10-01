"use client";

import { useEffect, useRef, useState } from "react";

/**
 * P2, item 1: o que estava dentro de `FolhaGravarAgora.tsx` (pedir o microfone, gravar, contar os
 * segundos, parar no limite, mandar para a rota, os estados sem microfone e erro de áudio) virou
 * este gancho, para `FolhaGravarAgora`, `FolhaPlanejarDias` e `PerguntaCampo` (o "responder
 * falando" do briefing) usarem o mesmo mecanismo. Devolve só o texto transcrito; separar esse
 * texto em campos, dias de agenda ou organizar a fala é responsabilidade de quem chama, via
 * `onTranscrito`.
 *
 * P2b: enquanto grava, uma prévia ao vivo (`previa`) vai aparecendo, em duas camadas, nunca por
 * nome de navegador (decisão do Gustavo em 01/10/2026, "hoje espera falar tudo para depois
 * aparecer o texto embaixo; isso é ruim"). (a) O reconhecimento de fala do próprio navegador
 * (`SpeechRecognition`/`webkitSpeechRecognition`), quando existir: roda junto do gravador
 * principal, nunca interfere nele. Erro, parada sozinha ou silêncio por 5s sem nenhum resultado
 * cai para (b) sem avisar (a gravação de verdade nunca dependeu dele). (b) Sem reconhecimento do
 * navegador: um segundo `MediaRecorder`, na mesma faixa de áudio, reiniciado a cada 5 segundos,
 * manda cada pedaço para `/api/transcrever` e a prévia soma os pedaços em ordem. A prévia nunca é
 * gravada nem vira resposta: só o texto definitivo, do áudio inteiro, ao parar.
 */

/** webm/opus no Chrome e no Android, mp4/aac no Safari (`MediaRecorder.isTypeSupported`). */
function tipoMimeSuportado(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  if (MediaRecorder.isTypeSupported("audio/webm")) return "audio/webm";
  if (MediaRecorder.isTypeSupported("audio/mp4")) return "audio/mp4";
  return null;
}

/**
 * Tipos mínimos da Web Speech API (não padronizada em todo navegador, por isso nunca em
 * `lib.dom.d.ts`): só o que a prévia usa. Detecção por recurso (`window.SpeechRecognition` ou o
 * prefixo `webkit`), nunca por nome de navegador.
 */
type ResultadoReconhecimento = { 0: { transcript: string }; isFinal: boolean };
type EventoReconhecimento = { results: ArrayLike<ResultadoReconhecimento> };
type ReconhecimentoDeFala = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((evento: EventoReconhecimento) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
};

function construtorDeReconhecimento(): (new () => ReconhecimentoDeFala) | null {
  const janela = window as unknown as {
    SpeechRecognition?: new () => ReconhecimentoDeFala;
    webkitSpeechRecognition?: new () => ReconhecimentoDeFala;
  };
  return janela.SpeechRecognition ?? janela.webkitSpeechRecognition ?? null;
}

/** Item 0c: sem resultado nenhum do reconhecimento do aparelho nesse tempo, cai para os pedaços. */
const ESPERA_RECONHECIMENTO_MS = 5_000;
/** Item 2b: tamanho do pedaço que vai para `/api/transcrever` enquanto grava. */
const DURACAO_PEDACO_MS = 5_000;

export type FaseGravador = "inicial" | "gravando" | "transcrevendo";
export type ErroGravador = "audioVazio" | "falhaTranscricao" | null;

export const LIMITE_SEGUNDOS_PADRAO = 120;

type Props = {
  /** Vira o nome do arquivo enviado ("momento.webm", "agenda.webm", "briefing.webm"). */
  nomeArquivo?: string;
  /** V9a, item 3: o `MediaRecorder` do navegador para aqui; a rota recusa áudio mais longo. */
  limiteSegundos?: number;
  /** Chamado com o texto transcrito e a duração gravada, depois que a rota responde com sucesso. */
  onTranscrito: (texto: string, duracaoS: number) => void | Promise<void>;
};

export type ResultadoUseGravadorDeAudio = {
  fase: FaseGravador;
  segundos: number;
  semMicrofone: boolean;
  erro: ErroGravador;
  /** P2b: o texto ao vivo, nunca o definitivo; vazio fora da gravação. */
  previa: string;
  /** P2b, item 4: só true quando a prévia vem do reconhecimento do navegador (camada a). */
  previaPorReconhecimentoDoAparelho: boolean;
  /**
   * M4, item 0c: true quando o áudio definitivo voltou vazio ou com erro e a prévia virou a
   * resposta no lugar dele (a única situação em que isso acontece). Quem chama mostra um aviso
   * curto e deixa a pessoa conferir.
   */
  avisoPreviaComoReserva: boolean;
  iniciarGravacao: () => Promise<void>;
  pararGravacao: () => void;
};

export function useGravadorDeAudio({ nomeArquivo = "audio", limiteSegundos = LIMITE_SEGUNDOS_PADRAO, onTranscrito }: Props): ResultadoUseGravadorDeAudio {
  const [fase, setFase] = useState<FaseGravador>("inicial");
  const [segundos, setSegundos] = useState(0);
  const [semMicrofone, setSemMicrofone] = useState(false);
  const [erro, setErro] = useState<ErroGravador>(null);
  const [previa, setPrevia] = useState("");
  const [previaPorReconhecimentoDoAparelho, setPreviaPorReconhecimentoDoAparelho] = useState(false);
  const [avisoPreviaComoReserva, setAvisoPreviaComoReserva] = useState(false);
  // Espelha `previa` para `transcrever` ler o valor mais recente (a função é recriada a cada
  // render, mas `onstop` guarda a referência de quando a gravação começou).
  const previaRef = useRef("");

  const streamRef = useRef<MediaStream | null>(null);
  const gravadorRef = useRef<MediaRecorder | null>(null);
  const pedacosRef = useRef<Blob[]>([]);
  const segundosRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Chamador mais recente de onTranscrito (a pergunta pode trocar entre uma gravação e a próxima).
  const onTranscritoRef = useRef(onTranscrito);
  useEffect(() => {
    onTranscritoRef.current = onTranscrito;
  });

  // P2b, camada (a): reconhecimento de fala do navegador.
  const reconhecimentoRef = useRef<ReconhecimentoDeFala | null>(null);
  const semResultadoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trocouParaPedacosRef = useRef(false);
  /**
   * M4, item 0a: o que já apareceu em sessões anteriores do reconhecimento, antes de um "parou
   * sozinho e recomeçou" (ou de uma troca para os pedaços no meio do caminho). Prefixo estável,
   * nunca apagado por uma sessão nova.
   */
  const previaConfirmadaRef = useRef("");

  // P2b, camada (b): segundo MediaRecorder, por pedaços de 5s, na mesma faixa de áudio.
  const pedacoGravadorRef = useRef<MediaRecorder | null>(null);
  const pedacoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pedacoPararTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pedacoIndiceRef = useRef(0);
  const pedacoTextosRef = useRef<string[]>([]);

  function atualizarPrevia(texto: string) {
    previaRef.current = texto;
    setPrevia(texto);
  }

  /** Soma o prefixo confirmado (sessões de reconhecimento anteriores) ao texto da camada ativa. */
  function previaMontada(textoDaCamada: string): string {
    const prefixo = previaConfirmadaRef.current;
    if (!prefixo) return textoDaCamada;
    if (!textoDaCamada) return prefixo;
    return `${prefixo} ${textoDaCamada}`;
  }

  function limparPrevia() {
    if (semResultadoTimerRef.current) {
      clearTimeout(semResultadoTimerRef.current);
      semResultadoTimerRef.current = null;
    }
    if (reconhecimentoRef.current) {
      const reconhecimento = reconhecimentoRef.current;
      reconhecimento.onresult = null;
      reconhecimento.onerror = null;
      reconhecimento.onend = null;
      reconhecimento.abort();
      reconhecimentoRef.current = null;
    }
    if (pedacoIntervalRef.current) {
      clearInterval(pedacoIntervalRef.current);
      pedacoIntervalRef.current = null;
    }
    if (pedacoPararTimerRef.current) {
      clearTimeout(pedacoPararTimerRef.current);
      pedacoPararTimerRef.current = null;
    }
    if (pedacoGravadorRef.current && pedacoGravadorRef.current.state !== "inactive") {
      pedacoGravadorRef.current.ondataavailable = null;
      pedacoGravadorRef.current.stop();
    }
    pedacoGravadorRef.current = null;
  }

  function enviarPedaco(blob: Blob, tipoMime: string, indice: number) {
    if (blob.size === 0) return;
    const forma = new FormData();
    forma.append("audio", blob, `previa.${tipoMime.includes("mp4") ? "mp4" : "webm"}`);
    forma.append("duracaoS", String(Math.max(1, Math.round(DURACAO_PEDACO_MS / 1000))));
    // M4, item 0b: marca o pedaço de prévia, para a rota contar isto num limite de taxa à parte do
    // áudio definitivo (sem isto, duas pessoas gravando na mesma conta podem fazer a chamada
    // definitiva tomar o 429 no lugar de um pedaço, perdendo a fala).
    forma.append("previa", "1");
    fetch("/api/transcrever", { method: "POST", body: forma })
      .then((resposta) => resposta.json().catch(() => null))
      .then((dados: { transcricao: string } | { erro: string } | null) => {
        if (!dados || "erro" in dados || !dados.transcricao) return;
        pedacoTextosRef.current[indice] = dados.transcricao;
        atualizarPrevia(previaMontada(pedacoTextosRef.current.filter(Boolean).join(" ")));
      })
      .catch(() => {
        // Pedaço perdido: a prévia segue sem ele, o áudio definitivo não depende disto.
      });
  }

  function gravarProximoPedaco(stream: MediaStream, tipoMime: string) {
    if (pedacoPararTimerRef.current) {
      clearTimeout(pedacoPararTimerRef.current);
      pedacoPararTimerRef.current = null;
    }
    // Rede de segurança contra deriva do timer (o pedaço anterior ainda não se fechou sozinho): o
    // `ondataavailable` continua de pé, para o pedaço ainda mandar o que gravou antes de trocar.
    if (pedacoGravadorRef.current && pedacoGravadorRef.current.state !== "inactive") {
      pedacoGravadorRef.current.stop();
    }
    const indice = pedacoIndiceRef.current;
    pedacoIndiceRef.current += 1;
    const gravadorDoPedaco = new MediaRecorder(stream, { mimeType: tipoMime });
    gravadorDoPedaco.ondataavailable = (evento) => {
      if (evento.data.size > 0) enviarPedaco(evento.data, tipoMime, indice);
    };
    gravadorDoPedaco.start();
    pedacoGravadorRef.current = gravadorDoPedaco;
    pedacoPararTimerRef.current = setTimeout(() => {
      if (gravadorDoPedaco.state !== "inactive") gravadorDoPedaco.stop();
    }, DURACAO_PEDACO_MS);
  }

  function iniciarPreviaPorPedacos(stream: MediaStream, tipoMime: string) {
    pedacoIndiceRef.current = 0;
    pedacoTextosRef.current = [];
    gravarProximoPedaco(stream, tipoMime);
    pedacoIntervalRef.current = setInterval(() => gravarProximoPedaco(stream, tipoMime), DURACAO_PEDACO_MS);
  }

  function trocarParaPedacos(stream: MediaStream, tipoMime: string) {
    if (trocouParaPedacosRef.current) return;
    trocouParaPedacosRef.current = true;
    if (semResultadoTimerRef.current) {
      clearTimeout(semResultadoTimerRef.current);
      semResultadoTimerRef.current = null;
    }
    if (reconhecimentoRef.current) {
      const reconhecimento = reconhecimentoRef.current;
      reconhecimento.onresult = null;
      reconhecimento.onerror = null;
      reconhecimento.onend = null;
      reconhecimento.abort();
      reconhecimentoRef.current = null;
    }
    setPreviaPorReconhecimentoDoAparelho(false);
    // O que já tinha aparecido no reconhecimento não some ao trocar de camada.
    atualizarPrevia(previaConfirmadaRef.current);
    iniciarPreviaPorPedacos(stream, tipoMime);
  }

  function iniciarReconhecimento(stream: MediaStream, tipoMime: string) {
    const Construtor = construtorDeReconhecimento();
    if (!Construtor) {
      trocarParaPedacos(stream, tipoMime);
      return;
    }
    const reconhecimento = new Construtor();
    reconhecimento.continuous = true;
    reconhecimento.interimResults = true;
    reconhecimento.lang = "pt-BR";
    let recebeuResultado = false;
    let textoDaSessao = "";
    reconhecimento.onresult = (evento) => {
      recebeuResultado = true;
      if (semResultadoTimerRef.current) {
        clearTimeout(semResultadoTimerRef.current);
        semResultadoTimerRef.current = null;
      }
      setPreviaPorReconhecimentoDoAparelho(true);
      let texto = "";
      for (let i = 0; i < evento.results.length; i += 1) {
        texto += `${evento.results[i][0].transcript} `;
      }
      textoDaSessao = texto.trim();
      atualizarPrevia(previaMontada(textoDaSessao));
    };
    reconhecimento.onerror = () => {
      if (!recebeuResultado) trocarParaPedacos(stream, tipoMime);
    };
    /**
     * M4, item 0a: no celular, o reconhecimento costuma parar sozinho depois de uma pausa na fala,
     * mesmo com `continuous`. Antes disto, a prévia congelava ali (a gravação de verdade seguia,
     * mas o `onend` não fazia nada quando já tinha chegado algum resultado). Agora, se já tinha
     * resultado, o texto da sessão vira prefixo confirmado e o reconhecimento recomeça; se o
     * recomeço falhar (sem `Construtor` ou `.start()` erra), cai para os pedaços sem perder o que
     * já apareceu (`previaConfirmadaRef` já está atualizado antes da troca).
     */
    reconhecimento.onend = () => {
      if (!recebeuResultado) {
        trocarParaPedacos(stream, tipoMime);
        return;
      }
      previaConfirmadaRef.current = previaMontada(textoDaSessao);
      reconhecimentoRef.current = null;
      iniciarReconhecimento(stream, tipoMime);
    };
    reconhecimentoRef.current = reconhecimento;
    semResultadoTimerRef.current = setTimeout(() => {
      if (!recebeuResultado) trocarParaPedacos(stream, tipoMime);
    }, ESPERA_RECONHECIMENTO_MS);
    try {
      reconhecimento.start();
    } catch {
      trocarParaPedacos(stream, tipoMime);
    }
  }

  function iniciarPrevia(stream: MediaStream, tipoMime: string) {
    trocouParaPedacosRef.current = false;
    previaConfirmadaRef.current = "";
    if (!construtorDeReconhecimento()) {
      iniciarPreviaPorPedacos(stream, tipoMime);
      return;
    }
    iniciarReconhecimento(stream, tipoMime);
  }

  // Sai gravando (troca de tela, fechar a folha) sem deixar o microfone ligado no fundo.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      limparPrevia();
      streamRef.current?.getTracks().forEach((faixa) => faixa.stop());
    };
  }, []);

  /**
   * M4, item 0b da revisão do PR #77: `setFase("inicial")` saía antes de `onTranscrito` terminar,
   * então no briefing (onde `onTranscrito` ainda chama `organizarFalaBriefingAction`, alguns
   * segundos de IA) o campo e o microfone ficavam liberados durante essa espera, e o texto chegava
   * por cima do que a pessoa tivesse digitado nesse meio tempo. A fase só volta para "inicial"
   * depois que `onTranscrito` resolve, com `finally` para o erro também sair do estado "transcrevendo".
   */
  /**
   * M4, item 0c: em alguns celulares o reconhecimento do navegador e o `MediaRecorder` disputam o
   * microfone e um fica mudo; se for o gravador, a transcrição definitiva volta vazia (ou falha) e
   * a pessoa perde o que falou, com o texto já na tela. Nesse caso, e só nesse caso, a prévia
   * (`previaRef`, o valor mais recente, não o da renderização em que a gravação começou) vale como
   * transcrição e segue o caminho normal; `avisoPreviaComoReserva` avisa quem chama para mostrar um
   * aviso curto e deixar a pessoa conferir.
   */
  async function transcrever(blob: Blob, tipoMime: string) {
    setFase("transcrevendo");
    setErro(null);
    const forma = new FormData();
    forma.append("audio", blob, `${nomeArquivo}.${tipoMime.includes("mp4") ? "mp4" : "webm"}`);
    forma.append("duracaoS", String(segundosRef.current));

    try {
      const resposta = await fetch("/api/transcrever", { method: "POST", body: forma });
      const dados = (await resposta.json().catch(() => null)) as { transcricao: string } | { erro: string } | null;
      const transcricao = resposta.ok && dados && "transcricao" in dados ? dados.transcricao.trim() : "";
      if (!transcricao) {
        const previaDeReserva = previaRef.current.trim();
        if (previaDeReserva) {
          setAvisoPreviaComoReserva(true);
          await onTranscritoRef.current(previaDeReserva, segundosRef.current);
          return;
        }
        setErro("falhaTranscricao");
        return;
      }
      await onTranscritoRef.current(transcricao, segundosRef.current);
    } catch {
      const previaDeReserva = previaRef.current.trim();
      if (previaDeReserva) {
        setAvisoPreviaComoReserva(true);
        await onTranscritoRef.current(previaDeReserva, segundosRef.current);
      } else {
        setErro("falhaTranscricao");
      }
    } finally {
      setFase("inicial");
    }
  }

  async function iniciarGravacao() {
    setErro(null);
    setAvisoPreviaComoReserva(false);
    atualizarPrevia("");
    setPreviaPorReconhecimentoDoAparelho(false);
    const tipoMime = tipoMimeSuportado();
    if (!navigator.mediaDevices?.getUserMedia || !tipoMime) {
      setSemMicrofone(true);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const gravador = new MediaRecorder(stream, { mimeType: tipoMime });
      pedacosRef.current = [];
      gravador.ondataavailable = (evento) => {
        if (evento.data.size > 0) pedacosRef.current.push(evento.data);
      };
      gravador.onstop = () => {
        stream.getTracks().forEach((faixa) => faixa.stop());
        const blob = new Blob(pedacosRef.current, { type: tipoMime });
        if (blob.size === 0) {
          setErro("audioVazio");
          setFase("inicial");
          return;
        }
        void transcrever(blob, tipoMime);
      };
      gravadorRef.current = gravador;
      segundosRef.current = 0;
      setSegundos(0);
      gravador.start();
      setFase("gravando");
      iniciarPrevia(stream, tipoMime);
      timerRef.current = setInterval(() => {
        segundosRef.current += 1;
        setSegundos(segundosRef.current);
        if (segundosRef.current >= limiteSegundos) pararGravacao();
      }, 1000);
    } catch {
      setSemMicrofone(true);
    }
  }

  function pararGravacao() {
    if (timerRef.current) clearInterval(timerRef.current);
    limparPrevia();
    gravadorRef.current?.stop();
  }

  return {
    fase,
    segundos,
    semMicrofone,
    erro,
    previa,
    previaPorReconhecimentoDoAparelho,
    avisoPreviaComoReserva,
    iniciarGravacao,
    pararGravacao,
  };
}
