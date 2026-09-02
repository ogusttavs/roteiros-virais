"use client";

import { useEffect, useRef, useState } from "react";

import type { PerguntaBriefing } from "@/config/briefing";
import type { AvaliacaoResposta } from "@/db/schema";
import { textosBriefing } from "@/textos/briefing";
import { AnaliseQuatroPartes } from "@/ui/componentes/AnaliseQuatroPartes";
import { AreaTexto } from "@/ui/componentes/AreaTexto";
import { Botao } from "@/ui/componentes/Botao";
import { Nota } from "@/ui/componentes/Nota";
import { faixaDeNota } from "@/ui/componentes/notaFaixa";
import { Progresso } from "@/ui/componentes/Progresso";

import styles from "./PerguntaCampo.module.css";

export type ResultadoAcaoBriefing = {
  avaliacao: AvaliacaoResposta;
  notaGeral: number;
  completo: boolean;
  reusada: boolean;
};

type Props = {
  pergunta: PerguntaBriefing;
  resposta: string;
  avaliacao: AvaliacaoResposta | null;
  onSalvarRascunho: (perguntaId: string, resposta: string) => Promise<void>;
  onAvaliar: (perguntaId: string, resposta: string) => Promise<ResultadoAcaoBriefing>;
  onAtualizado: (perguntaId: string, resposta: string, resultado: ResultadoAcaoBriefing) => void;
};

const t = textosBriefing.pergunta;

/**
 * Uma pergunta do briefing, com os dois estados que /comecar (6.2) e
 * /briefing (6.8) compartilham: fechado (nota, analise em quatro partes,
 * "ajustar resposta") e aberto (area de texto, rascunho com debounce,
 * avaliar ao sair do campo ou pelo botao). Usado pelas duas telas.
 */
export function PerguntaCampo({
  pergunta,
  resposta,
  avaliacao,
  onSalvarRascunho,
  onAvaliar,
  onAtualizado,
}: Props) {
  const [texto, setTexto] = useState(resposta);
  const [textoAvaliado, setTextoAvaliado] = useState<string | null>(avaliacao ? resposta : null);
  const [editando, setEditando] = useState(!avaliacao);
  const [avaliando, setAvaliando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [rascunhoSalvo, setRascunhoSalvo] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  function aoMudarTexto(valor: string) {
    setTexto(valor);
    setRascunhoSalvo(false);
    setErro(null);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      onSalvarRascunho(pergunta.id, valor)
        .then(() => setRascunhoSalvo(true))
        .catch(() => undefined);
    }, 800);
  }

  async function avaliar() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setAvaliando(true);
    setErro(null);
    try {
      const resultado = await onAvaliar(pergunta.id, texto);
      setRascunhoSalvo(true);
      setTextoAvaliado(texto);
      setEditando(false);
      onAtualizado(pergunta.id, texto, resultado);
    } catch {
      setErro(t.erroAvaliacao);
    } finally {
      setAvaliando(false);
    }
  }

  function aoSairDoCampo() {
    if (texto.trim().length === 0 || texto === textoAvaliado) return;
    void avaliar();
  }

  if (!editando && avaliacao) {
    const legenda = textosBriefing.notaFaixa[faixaDeNota(avaliacao.nota)];
    return (
      <div className={styles.fechado}>
        <p className={styles.enunciado}>{pergunta.enunciado}</p>
        <Nota valor={avaliacao.nota} legenda={legenda} />
        <AnaliseQuatroPartes avaliacao={avaliacao} rotulos={textosBriefing.analiseRotulos} />
        <p className={styles.fraseAjuste}>{t.fraseAjuste}</p>
        <Botao variante="ghost" onClick={() => setEditando(true)}>
          {t.botaoAjustarResposta}
        </Botao>
      </div>
    );
  }

  return (
    <div className={styles.aberto}>
      <AreaTexto
        titulo={pergunta.enunciado}
        ajuda={pergunta.ajuda}
        value={texto}
        onChange={(evento) => aoMudarTexto(evento.target.value)}
        onBlur={aoSairDoCampo}
        contador={t.contador(texto.length)}
        erro={erro ?? undefined}
        disabled={avaliando}
      />
      {avaliando ? (
        <Progresso mensagem={t.avaliando} />
      ) : (
        <div className={styles.rodapeAberto}>
          <span className={styles.indicadorSalvo}>{rascunhoSalvo ? t.rascunhoSalvo : ""}</span>
          <Botao variante="secundario" onClick={() => void avaliar()} disabled={texto.trim().length === 0}>
            {erro ? t.botaoTentarDeNovo : t.botaoAvaliar}
          </Botao>
        </div>
      )}
    </div>
  );
}
