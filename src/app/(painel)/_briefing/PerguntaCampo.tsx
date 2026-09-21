"use client";

import { CircleAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { PerguntaBriefing } from "@/config/briefing";
import type { AvaliacaoResposta } from "@/db/schema";
import { ehFalhaDeRede } from "@/lib/offline";
import { textosBriefing } from "@/textos/briefing";
import { AnaliseQuatroPartes } from "@/ui/componentes/AnaliseQuatroPartes";
import { AreaTexto } from "@/ui/componentes/AreaTexto";
import { Botao } from "@/ui/componentes/Botao";
import { Nota } from "@/ui/componentes/Nota";
import { faixaMeta } from "@/ui/componentes/notaFaixaMeta";
import { Progresso } from "@/ui/componentes/Progresso";
import { useConexao, useTratarFalha } from "@/ui/ConexaoContext";

import { useTrocaMarcaOpcional } from "../_casca/TrocaMarcaContext";

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
  /** Precisa ter identidade estavel (a action do servidor, ou um useCallback): o salvamento depende dela. */
  onSalvarRascunho: (perguntaId: string, resposta: string) => Promise<void>;
  onAvaliar: (perguntaId: string, resposta: string) => Promise<ResultadoAcaoBriefing>;
  onAtualizado: (perguntaId: string, resposta: string, resultado: ResultadoAcaoBriefing) => void;
  /**
   * Avisa o pai quando o campo passa a ter algo que ainda nao esta resolvido no servidor: a avaliacao
   * em curso, uma que falhou ou um rascunho que nao salvou (V7, item 4 do PROXIMO.md). So o /comecar
   * usa, para nao deixar a pessoa sair do bloco sem saber. Identidade estavel (useCallback).
   */
  onPendencia?: (perguntaId: string, pendente: boolean) => void;
  /** Meta da nota geral (design v2, `base.css`, ".analise"): pinta a analise e a linha do briefing vivo. */
  meta: number;
  /**
   * wizard (/comecar, Comecar.dc.html): fechado mostra a nota e a analise
   * inteira, com "ajustar resposta". vivo (/briefing, Briefing.dc.html):
   * linha com pergunta, nota e texto, que abre para editar ao tocar.
   */
  variante?: "wizard" | "vivo";
};

/**
 * O erro de avaliar. `porRede` separa a frase de rede (que ja diz que o texto continua na tela) do
 * resto, para a explicacao "a sua resposta esta salva" so aparecer quando ela e verdade.
 */
type ErroDeAvaliacao = { frase: string; porRede: boolean };

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
  onPendencia,
  meta,
  variante = "wizard",
}: Props) {
  const { semConexao, avisarRedeOk } = useConexao();
  const tratarFalha = useTratarFalha();
  /**
   * Trocando de marca (so no painel, onde ha o provedor): quando a tela desmonta por causa da troca, o texto
   * pendente e da marca de ANTES, e a Server Action grava na marca do cookie, que ja e a nova. Em ref porque
   * o desmontar precisa do valor da ultima renderizacao, nao de uma antiga.
   */
  const troca = useTrocaMarcaOpcional();
  const trocandoRef = useRef(false);
  useEffect(() => {
    trocandoRef.current = troca?.trocando ?? false;
  });
  const [texto, setTexto] = useState(resposta);
  const [textoAvaliado, setTextoAvaliado] = useState<string | null>(avaliacao ? resposta : null);
  const [editando, setEditando] = useState(!avaliacao);
  const [avaliando, setAvaliando] = useState(false);
  const [erro, setErro] = useState<ErroDeAvaliacao | null>(null);
  const [rascunhoSalvo, setRascunhoSalvo] = useState(true);
  const [rascunhoComErro, setRascunhoComErro] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * O texto de agora e o ultimo que o servidor confirmou (V7, item 4 do PROXIMO.md). Em ref porque quem
   * precisa deles roda fora de um render (o debounce, a aba que esconde, a rede que volta, o desmontar)
   * e nao pode ler o estado de um render antigo.
   */
  const textoRef = useRef(resposta);
  const salvoRef = useRef(resposta);
  const caixaAlta = pergunta.peso === 2 ? "longa" : "padrao";

  /**
   * Manda o texto de agora para o servidor se ele ainda nao foi. Um lugar so para o debounce, o
   * "avaliar", a aba que esconde, o desmontar e a rede que volta. So marca "salvo" se o texto nao mudou
   * enquanto a gravacao voltava: em rede lenta a primeira resposta chegava depois de a pessoa digitar
   * mais, e o indicador dizia "salvo" com o texto novo ainda so na tela. Uma falha aparece no indicador
   * (antes ele so ficava sem o "salvo", igual a um rascunho que ainda nao tentou, e quem saisse da
   * tela nesse meio tempo perdia o que digitou sem aviso).
   */
  const salvarPendente = useCallback(async (): Promise<boolean> => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const valor = textoRef.current;
    if (valor === salvoRef.current) {
      setRascunhoSalvo(true);
      setRascunhoComErro(false);
      return true;
    }
    try {
      await onSalvarRascunho(pergunta.id, valor);
      salvoRef.current = valor;
      if (textoRef.current === valor) {
        setRascunhoSalvo(true);
        setRascunhoComErro(false);
      }
      avisarRedeOk();
      return true;
    } catch (falha) {
      // Acende a faixa "Sem conexao" se foi a rede; o indicador ja diz que o texto so esta nesta tela.
      tratarFalha(falha, t.rascunhoComErro);
      if (textoRef.current === valor) setRascunhoComErro(true);
      return false;
    }
  }, [onSalvarRascunho, pergunta.id, avisarRedeOk, tratarFalha]);

  /**
   * O que ainda estava pendente vai antes de a tela sumir: ao esconder a aba, ao desmontar e quando a
   * rede volta (V7, item 4 do PROXIMO.md). No briefing vivo, digitar e trocar de aba em menos de 0,8 s
   * perdia os ultimos caracteres sem aviso.
   */
  useEffect(() => {
    function aoMudarVisibilidade() {
      if (document.visibilityState === "hidden") void salvarPendente();
    }
    function aoVoltarARede() {
      void salvarPendente();
    }
    document.addEventListener("visibilitychange", aoMudarVisibilidade);
    window.addEventListener("online", aoVoltarARede);
    return () => {
      document.removeEventListener("visibilitychange", aoMudarVisibilidade);
      window.removeEventListener("online", aoVoltarARede);
      if (trocandoRef.current) {
        // O rascunho de uma marca nunca vai para a outra: perde o que faltava, no lugar de gravar na marca errada.
        if (timerRef.current) clearTimeout(timerRef.current);
        return;
      }
      void salvarPendente();
    };
  }, [salvarPendente]);

  const pendente = avaliando || erro !== null || rascunhoComErro;
  useEffect(() => {
    onPendencia?.(pergunta.id, pendente);
    return () => onPendencia?.(pergunta.id, false);
  }, [onPendencia, pergunta.id, pendente]);

  function aoMudarTexto(valor: string) {
    textoRef.current = valor;
    setTexto(valor);
    setRascunhoSalvo(false);
    setRascunhoComErro(false);
    setErro(null);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void salvarPendente(), 800);
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
    const textoDoToque = textoRef.current;
    setAvaliando(true);
    setErro(null);
    /**
     * Antes, avaliar cancelava o rascunho pendente e so a IA gravava a resposta: um toque dentro dos
     * 800 ms, sem rede, deixava a tela dizendo "salva" sem estar, e a pessoa saia e perdia o texto (V7,
     * item 4 do PROXIMO.md). Agora o rascunho vai primeiro e o resultado fica em `rascunhoSalvo` e
     * `rascunhoComErro`, que e o que a explicacao do erro consulta.
     */
    await salvarPendente();
    try {
      const resultado = await onAvaliar(pergunta.id, textoDoToque);
      // A avaliacao grava a resposta junto: o texto esta no servidor.
      salvoRef.current = textoDoToque;
      setRascunhoSalvo(true);
      setRascunhoComErro(false);
      setTextoAvaliado(textoDoToque);
      setEditando(false);
      avisarRedeOk();
      onAtualizado(pergunta.id, textoDoToque, resultado);
    } catch (falha) {
      setErro({ frase: tratarFalha(falha, t.erroAviso), porRede: ehFalhaDeRede(falha) });
    } finally {
      setAvaliando(false);
    }
  }

  function aoSairDoCampo() {
    // Sem rede o botao de avaliar fica desabilitado com o motivo escrito; avaliar sozinho ao sair do
    // campo so traria o erro na cara de quem so tocou fora (V7, item 8 do PROXIMO.md).
    if (semConexao) return;
    if (texto.trim().length === 0 || texto === textoAvaliado) return;
    void avaliar();
  }

  function cancelarEdicao() {
    const anterior = textoAvaliado ?? resposta;
    textoRef.current = anterior;
    setTexto(anterior);
    setErro(null);
    setEditando(false);
    // Fecha o que ficou pendente: se um rascunho da edicao ja tinha ido para o servidor, o texto de
    // antes volta para la; se nao, so acerta o indicador.
    void salvarPendente();
  }

  const indicadorRascunho = (
    <span className={rascunhoComErro ? styles.rascunhoComErro : styles.indicadorSalvo}>
      {rascunhoComErro ? t.rascunhoComErro : rascunhoSalvo ? t.rascunhoSalvo : t.rascunhoAindaNao}
    </span>
  );

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
            erro={erro?.frase}
            disabled={avaliando}
          />
          <div className={styles.rodapeAberto}>{indicadorRascunho}</div>
          <div className={styles.acoesVivo}>
            <Botao
              variante="secundario"
              onClick={() => void avaliar()}
              carregando={avaliando}
              disabled={avaliando || texto.trim().length === 0}
              precisaDeRede
            >
              {t.botaoAvaliarDeNovo}
            </Botao>
            <Botao variante="ghost" onClick={cancelarEdicao} disabled={avaliando}>
              {t.botaoCancelar}
            </Botao>
          </div>
          {avaliando ? <Progresso mensagem={t.avaliando} /> : null}
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
            {erro.frase}
          </p>
          <Botao variante="secundario" onClick={() => void avaliar()} precisaDeRede>
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

  /**
   * "A sua resposta esta salva" so quando o rascunho realmente foi (V7, item 4 do PROXIMO.md): o
   * servidor so grava a resposta depois da IA, entao sem rede o texto nem saiu da tela. Na falha de
   * rede a frase de rede ja diz que o texto continua aqui, e a explicacao nao se repete.
   */
  const explicacaoDoErro = erro?.porRede
    ? null
    : rascunhoSalvo && !rascunhoComErro
      ? t.erroExplicacao
      : t.erroExplicacaoSemSalvar;

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
        {indicadorRascunho}
        <span className={styles.contador}>{t.contador(texto.length)}</span>
      </div>
      {avaliando ? (
        <Progresso mensagem={t.avaliando} />
      ) : erro ? (
        <div className={styles.blocoErro}>
          <p className={styles.erroInline} role="alert">
            <CircleAlert size={16} strokeWidth={1.5} aria-hidden="true" />
            {erro.frase}
          </p>
          {explicacaoDoErro ? <p className={styles.erroExplicacao}>{explicacaoDoErro}</p> : null}
          <Botao onClick={() => void avaliar()} precisaDeRede>
            {t.botaoTentarDeNovo}
          </Botao>
        </div>
      ) : (
        <Botao onClick={() => void avaliar()} disabled={texto.trim().length === 0} precisaDeRede>
          {t.botaoAvaliar}
        </Botao>
      )}
    </div>
  );
}
