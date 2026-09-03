"use client";

import { CircleAlert } from "lucide-react";
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
import { Skeleton } from "@/ui/componentes/Skeleton";

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
  /**
   * wizard (/comecar, BriefingTela.dc.html): fechado mostra nota, analise
   * inteira e "ajustar resposta". vivo (/briefing, BriefingVivoTela.dc.html):
   * linha com resposta truncada em 3 linhas, nota ao lado, analise atras de
   * um <details> "ver a analise", e "cancelar" para sair da edicao sem
   * salvar (o wizard nao tem esse botao: toda pergunta comeca aberta).
   */
  variante?: "wizard" | "vivo";
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
  variante = "wizard",
}: Props) {
  const [texto, setTexto] = useState(resposta);
  const [textoAvaliado, setTextoAvaliado] = useState<string | null>(avaliacao ? resposta : null);
  const [editando, setEditando] = useState(!avaliacao);
  const [avaliando, setAvaliando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [rascunhoSalvo, setRascunhoSalvo] = useState(true);
  const [rascunhoComErro, setRascunhoComErro] = useState(false);
  const [expandido, setExpandido] = useState(false);
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
    setRascunhoComErro(false);
    setErro(null);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      onSalvarRascunho(pergunta.id, valor)
        .then(() => setRascunhoSalvo(true))
        /**
         * Antes, uma falha aqui nao aparecia em lugar nenhum (achado no code
         * review desta rodada): o indicador so ficava sem o "salvo", igual a
         * um rascunho que ainda nao tentou salvar. Se a pessoa saisse da
         * tela nesse meio tempo, o texto digitado se perdia sem aviso.
         */
        .catch(() => setRascunhoComErro(true));
    }, 800);
  }

  async function avaliar() {
    /**
     * Sem isto, um clique no botao "avaliar" que tambem tira o foco da area
     * de texto dispara aoSairDoCampo e o onClick quase juntos, antes do
     * primeiro re-render desabilitar o campo (achado no code review desta
     * rodada): as duas chamadas avaliam a mesma resposta em paralelo, cada
     * uma pagando a IA de novo.
     */
    if (avaliando) return;
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

  function cancelarEdicao() {
    setTexto(textoAvaliado ?? resposta);
    setErro(null);
    setEditando(false);
  }

  if (variante === "vivo" && avaliacao) {
    const legenda = textosBriefing.notaFaixa[faixaDeNota(avaliacao.nota)];

    if (editando) {
      return (
        <div className={styles.linhaVivo}>
          <div className={styles.colunaVivo}>
            <p className={styles.enunciado}>{pergunta.enunciado}</p>
            <AreaTexto
              rotulo={pergunta.enunciado}
              rotuloOculto
              value={texto}
              onChange={(evento) => aoMudarTexto(evento.target.value)}
              linhasMin={5}
              erro={erro ?? undefined}
            />
            <div className={styles.acoesVivo}>
              <Botao variante="secundario" onClick={() => void avaliar()} disabled={texto.trim().length === 0}>
                {t.botaoAvaliarDeNovo}
              </Botao>
              <Botao variante="ghost" onClick={cancelarEdicao}>
                {t.botaoCancelar}
              </Botao>
            </div>
          </div>
          <Nota valor={avaliacao.nota} legenda={legenda} tamanho="lista" />
        </div>
      );
    }

    if (avaliando) {
      return (
        <div className={styles.linhaVivo}>
          <div className={styles.colunaVivo}>
            <p className={styles.enunciado}>{pergunta.enunciado}</p>
            <p className={styles.respostaEsmaecida}>{texto}</p>
            <Progresso mensagem={t.avaliando} />
          </div>
          <Skeleton variante="numero" largura="72px" />
        </div>
      );
    }

    if (erro) {
      return (
        <div className={styles.linhaVivo}>
          <div className={styles.colunaVivo}>
            <p className={styles.enunciado}>{pergunta.enunciado}</p>
            <p className={styles.respostaEsmaecida}>{texto}</p>
            <p className={styles.erroInline} role="alert">
              <CircleAlert size={16} strokeWidth={1.5} aria-hidden="true" />
              {erro}
            </p>
            <Botao variante="secundario" onClick={() => void avaliar()}>
              {t.botaoTentarDeNovo}
            </Botao>
          </div>
        </div>
      );
    }

    return (
      <div className={styles.linhaVivo}>
        <div className={styles.colunaVivo}>
          <p className={styles.enunciado}>{pergunta.enunciado}</p>
          <p className={[styles.resposta, expandido ? "" : styles.respostaTruncada].filter(Boolean).join(" ")}>
            {textoAvaliado ?? resposta}
          </p>
          <div className={styles.acoesVivo}>
            {!expandido ? (
              <Botao variante="ghost" onClick={() => setExpandido(true)}>
                {t.botaoVerTudo}
              </Botao>
            ) : null}
            <Botao variante="ghost" onClick={() => setEditando(true)}>
              {t.botaoEditar}
            </Botao>
          </div>
          <details className={styles.detalhesAnalise}>
            <summary>{t.botaoVerAnalise}</summary>
            <AnaliseQuatroPartes avaliacao={avaliacao} rotulos={textosBriefing.analiseRotulos} />
          </details>
        </div>
        <Nota valor={avaliacao.nota} legenda={legenda} tamanho="lista" />
      </div>
    );
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
        rotulo={pergunta.enunciado}
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
          <span className={styles.indicadorSalvo}>
            {rascunhoComErro ? t.rascunhoComErro : rascunhoSalvo ? t.rascunhoSalvo : ""}
          </span>
          <Botao variante="secundario" onClick={() => void avaliar()} disabled={texto.trim().length === 0}>
            {erro ? t.botaoTentarDeNovo : t.botaoAvaliar}
          </Botao>
        </div>
      )}
    </div>
  );
}
