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
import { faixaMeta } from "@/ui/componentes/notaFaixaMeta";
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
  /** Meta da nota geral (design v2, `base.css`, ".analise"): pinta a analise e a linha do briefing vivo. */
  meta: number;
  /**
   * wizard (/comecar, Comecar.dc.html): fechado mostra a nota e a analise
   * inteira, com "ajustar resposta". vivo (/briefing, Briefing.dc.html):
   * linha com pergunta, nota e texto, que abre para editar ao tocar.
   */
  variante?: "wizard" | "vivo";
};

const t = textosBriefing.pergunta;

function Chip({ pergunta }: { pergunta: PerguntaBriefing }) {
  return (
    <p className={styles.campoPergunta}>
      {pergunta.enunciado}
      {/* So o numero da pergunta, sem o peso (PROXIMO.md, D2 parte 2, item 2). */}
      <span className={styles.peso}>{pergunta.id.toUpperCase()}</span>
    </p>
  );
}

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
  meta,
  variante = "wizard",
}: Props) {
  const [texto, setTexto] = useState(resposta);
  const [textoAvaliado, setTextoAvaliado] = useState<string | null>(avaliacao ? resposta : null);
  const [editando, setEditando] = useState(!avaliacao);
  const [avaliando, setAvaliando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [rascunhoSalvo, setRascunhoSalvo] = useState(true);
  const [rascunhoComErro, setRascunhoComErro] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const caixaAlta = pergunta.peso === 2 ? "longa" : "padrao";

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
      setErro(t.erroAviso);
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
    if (editando) {
      return (
        <div className={styles.linhaVivo}>
          <p className={styles.enunciado}>{pergunta.enunciado}</p>
          <AreaTexto
            rotulo={pergunta.enunciado}
            rotuloOculto
            value={texto}
            onChange={(evento) => aoMudarTexto(evento.target.value)}
            caixaAlta={caixaAlta}
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
      );
    }

    if (avaliando) {
      return (
        <div className={styles.linhaVivo}>
          <p className={styles.enunciado}>{pergunta.enunciado}</p>
          <p className={styles.respostaEsmaecida}>{texto}</p>
          <Progresso mensagem={t.avaliando} />
          <Skeleton variante="numero" largura="72px" />
        </div>
      );
    }

    if (erro) {
      return (
        <div className={styles.linhaVivo}>
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
      );
    }

    const legenda = textosBriefing.faixaMeta[faixaMeta(avaliacao.nota, meta)];
    return (
      <button type="button" className={styles.resposta} onClick={() => setEditando(true)}>
        <span className={styles.pergunta}>{pergunta.enunciado}</span>
        <Nota valor={avaliacao.nota} tamanho="lista" meta={meta} />
        <span className={styles.textoResposta}>{textoAvaliado ?? resposta}</span>
        <span className={styles.faixaVivo}>
          {legenda}
          <span className={styles.editarAfordancia}>{t.botaoEditar}</span>
        </span>
      </button>
    );
  }

  if (!editando && avaliacao) {
    return (
      <div className={styles.cartaoFechado}>
        <Chip pergunta={pergunta} />
        <AnaliseQuatroPartes
          avaliacao={avaliacao}
          rotulos={textosBriefing.analiseRotulos}
          meta={meta}
          rotulosFaixa={textosBriefing.faixaMeta}
        />
        <p className={styles.fraseAjuste}>{t.fraseAjuste}</p>
        <Botao variante="ghost" onClick={() => setEditando(true)}>
          {t.botaoAjustarResposta}
        </Botao>
      </div>
    );
  }

  return (
    <div className={styles.cartaoAberto}>
      <Chip pergunta={pergunta} />
      {pergunta.ajuda ? <p className={styles.campoDica}>{pergunta.ajuda}</p> : null}
      <AreaTexto
        rotulo={pergunta.enunciado}
        rotuloOculto
        value={texto}
        onChange={(evento) => aoMudarTexto(evento.target.value)}
        onBlur={aoSairDoCampo}
        caixaAlta={caixaAlta}
        disabled={avaliando}
      />
      <div className={styles.rodapeAberto}>
        <span className={rascunhoComErro ? styles.rascunhoComErro : styles.indicadorSalvo}>
          {rascunhoComErro ? t.rascunhoComErro : rascunhoSalvo ? t.rascunhoSalvo : t.rascunhoAindaNao}
        </span>
        <span className={styles.contador}>{t.contador(texto.length)}</span>
      </div>
      {avaliando ? (
        <Progresso mensagem={t.avaliando} />
      ) : erro ? (
        <div className={styles.blocoErro}>
          <p className={styles.erroInline} role="alert">
            <CircleAlert size={16} strokeWidth={1.5} aria-hidden="true" />
            {erro}
          </p>
          <p className={styles.erroExplicacao}>{t.erroExplicacao}</p>
          <Botao onClick={() => void avaliar()}>{t.botaoTentarDeNovo}</Botao>
        </div>
      ) : (
        <Botao onClick={() => void avaliar()} disabled={texto.trim().length === 0}>
          {t.botaoAvaliar}
        </Botao>
      )}
    </div>
  );
}
