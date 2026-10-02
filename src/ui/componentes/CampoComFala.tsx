"use client";

import { CircleAlert, Mic, Square } from "lucide-react";
import { useState, type Ref, type TextareaHTMLAttributes } from "react";

import { textosComuns } from "@/textos/comuns";

import { AreaTexto } from "./AreaTexto";
import styles from "./CampoComFala.module.css";
import { LIMITE_SEGUNDOS_PADRAO, useGravadorDeAudio } from "./useGravadorDeAudio";

const t = textosComuns.campoComFala;

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "rows" | "value" | "onChange"> & {
  rotulo: string;
  rotuloOculto?: boolean;
  ajuda?: string;
  erro?: string;
  contador?: string;
  linhasMin?: number;
  caixaAlta?: "padrao" | "longa";
  ref?: Ref<HTMLTextAreaElement>;
  value: string;
  onChange: (valor: string) => void;
  /** Vira o nome do arquivo enviado para a transcrição ("reprovar.webm", "objetivo.webm"...). */
  nomeArquivo: string;
};

/**
 * A1, "falar em todo campo" (pedido do Gustavo em 01/10, 21:50, `PROXIMO.md`): o campo de texto
 * livre mais o botão de falar, para todo campo fora do briefing e do momento (que já tinham o
 * próprio, com a fala reorganizada pela IA). Aqui a transcrição entra exatamente como a pessoa
 * falou, sem reescrita nenhuma: campo vazio, ela substitui; campo com texto, ela soma numa linha
 * nova (mesma regra de `PerguntaCampo.tsx`, mas sem o passo de organizar).
 *
 * `onMouseDown` com `preventDefault` no botão de falar, mesmo raciocínio de `PerguntaCampo.tsx`:
 * sem isso, tocar o microfone com o campo em foco desfoca a área de texto antes do clique.
 */
export function CampoComFala({ value, onChange, nomeArquivo, disabled, ...resto }: Props) {
  const [aviso, setAviso] = useState<"substituido" | "somado" | null>(null);

  const gravador = useGravadorDeAudio({
    nomeArquivo,
    onTranscrito(textoFalado) {
      if (value.trim()) {
        onChange(`${value}\n${textoFalado}`);
        setAviso("somado");
      } else {
        onChange(textoFalado);
        setAviso("substituido");
      }
    },
  });

  const gravando = gravador.fase === "gravando";
  const transcrevendo = gravador.fase === "transcrevendo";

  const erroFala = gravador.semMicrofone
    ? t.semMicrofone
    : gravador.erro === "audioVazio"
      ? t.audioVazio
      : gravador.erro === "falhaTranscricao"
        ? t.falhaTranscricao
        : null;

  return (
    <div>
      <div className={styles.linhaComMicrofone}>
        <AreaTexto
          value={value}
          onChange={(evento) => {
            onChange(evento.target.value);
            setAviso(null);
          }}
          disabled={disabled || gravador.fase !== "inicial"}
          {...resto}
        />
      </div>
      <div className={styles.acoesCampo}>
        <button
          type="button"
          className={[styles.botaoFalar, gravando ? styles.botaoFalarGravando : ""].filter(Boolean).join(" ")}
          onClick={() => {
            setAviso(null);
            if (gravando) gravador.pararGravacao();
            else void gravador.iniciarGravacao();
          }}
          onMouseDown={(evento) => evento.preventDefault()}
          disabled={disabled || transcrevendo}
        >
          {gravando ? <Square size={16} strokeWidth={1.75} aria-hidden="true" /> : <Mic size={16} strokeWidth={1.75} aria-hidden="true" />}
          {gravando ? t.pararDeFalar : t.falar}
        </button>
      </div>
      {gravando ? (
        <p className={styles.dicaFalar}>{t.contagemGravando(gravador.segundos, LIMITE_SEGUNDOS_PADRAO)}</p>
      ) : transcrevendo ? (
        <p className={styles.dicaFalar}>{t.ouvindo}</p>
      ) : erroFala ? (
        <p className={styles.erroInline} role="alert">
          <CircleAlert size={16} strokeWidth={1.5} aria-hidden="true" />
          {erroFala}
        </p>
      ) : aviso ? (
        <p className={styles.aviso} role="status">
          {aviso === "substituido" ? t.textoSubstituido : t.textoSomado}
        </p>
      ) : (
        <p className={styles.dicaFalar}>{t.dica}</p>
      )}
      {(gravando || transcrevendo) && gravador.previa.trim().length > 0 ? (
        <p className={styles.previaFala} aria-live="off">
          {gravador.previa}
        </p>
      ) : null}
      {gravando && gravador.previaPorReconhecimentoDoAparelho ? (
        <p className={styles.previaAviso}>{textosComuns.previaUsaReconhecimentoDoAparelho}</p>
      ) : null}
      {gravador.avisoPreviaComoReserva ? (
        <p className={styles.previaAviso} role="status">
          {textosComuns.previaUsadaComoResposta}
        </p>
      ) : null}
    </div>
  );
}
