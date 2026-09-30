"use client";

import { useEffect, useRef, useState } from "react";

/**
 * P2, item 1: o que estava dentro de `FolhaGravarAgora.tsx` (pedir o microfone, gravar, contar os
 * segundos, parar no limite, mandar para a rota, os estados sem microfone e erro de áudio) virou
 * este gancho, para `FolhaGravarAgora`, `FolhaPlanejarDias` e `PerguntaCampo` (o "responder
 * falando" do briefing) usarem o mesmo mecanismo. Devolve só o texto transcrito; separar esse
 * texto em campos, dias de agenda ou organizar a fala é responsabilidade de quem chama, via
 * `onTranscrito`.
 */

/** webm/opus no Chrome e no Android, mp4/aac no Safari (`MediaRecorder.isTypeSupported`). */
function tipoMimeSuportado(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  if (MediaRecorder.isTypeSupported("audio/webm")) return "audio/webm";
  if (MediaRecorder.isTypeSupported("audio/mp4")) return "audio/mp4";
  return null;
}

export type FaseGravador = "inicial" | "gravando" | "transcrevendo";
export type ErroGravador = "audioVazio" | "falhaTranscricao" | null;

const LIMITE_SEGUNDOS_PADRAO = 120;

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
  iniciarGravacao: () => Promise<void>;
  pararGravacao: () => void;
};

export function useGravadorDeAudio({ nomeArquivo = "audio", limiteSegundos = LIMITE_SEGUNDOS_PADRAO, onTranscrito }: Props): ResultadoUseGravadorDeAudio {
  const [fase, setFase] = useState<FaseGravador>("inicial");
  const [segundos, setSegundos] = useState(0);
  const [semMicrofone, setSemMicrofone] = useState(false);
  const [erro, setErro] = useState<ErroGravador>(null);

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

  // Sai gravando (troca de tela, fechar a folha) sem deixar o microfone ligado no fundo.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((faixa) => faixa.stop());
    };
  }, []);

  async function transcrever(blob: Blob, tipoMime: string) {
    setFase("transcrevendo");
    setErro(null);
    const forma = new FormData();
    forma.append("audio", blob, `${nomeArquivo}.${tipoMime.includes("mp4") ? "mp4" : "webm"}`);
    forma.append("duracaoS", String(segundosRef.current));

    try {
      const resposta = await fetch("/api/transcrever", { method: "POST", body: forma });
      const dados = (await resposta.json().catch(() => null)) as { transcricao: string } | { erro: string } | null;
      if (!resposta.ok || !dados || "erro" in dados) {
        setErro("falhaTranscricao");
        setFase("inicial");
        return;
      }
      setFase("inicial");
      await onTranscritoRef.current(dados.transcricao, segundosRef.current);
    } catch {
      setErro("falhaTranscricao");
      setFase("inicial");
    }
  }

  async function iniciarGravacao() {
    setErro(null);
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
    gravadorRef.current?.stop();
  }

  return { fase, segundos, semMicrofone, erro, iniciarGravacao, pararGravacao };
}
