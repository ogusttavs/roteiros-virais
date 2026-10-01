"use client";

import { CircleAlert, Mic, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import type { PerguntaBriefing } from "@/config/briefing";
import type { AvaliacaoResposta } from "@/db/schema";
import { ehFalhaDeRede } from "@/lib/offline";
import { textosBriefing } from "@/textos/briefing";
import { textosComuns } from "@/textos/comuns";
import { AnaliseQuatroPartes } from "@/ui/componentes/AnaliseQuatroPartes";
import { AreaTexto } from "@/ui/componentes/AreaTexto";
import { Botao } from "@/ui/componentes/Botao";
import { Nota } from "@/ui/componentes/Nota";
import { faixaMeta } from "@/ui/componentes/notaFaixaMeta";
import { Progresso } from "@/ui/componentes/Progresso";
import { Toast } from "@/ui/componentes/Toast";
import { LIMITE_SEGUNDOS_PADRAO, useGravadorDeAudio, type ResultadoUseGravadorDeAudio } from "@/ui/componentes/useGravadorDeAudio";
import { useConexao, useTratarFalha } from "@/ui/ConexaoContext";

import { useTrocaMarcaOpcional } from "../_casca/TrocaMarcaContext";

import { organizarFalaBriefingAction } from "./acoes";
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
  /**
   * Precisa ter identidade estavel (a action do servidor, ou um useCallback): o salvamento depende
   * dela. `transcricaoBruta` (P2, item 3): só quando a resposta veio pelo microfone.
   */
  onSalvarRascunho: (perguntaId: string, resposta: string, transcricaoBruta?: string) => Promise<void>;
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
 * P2, item 2: "Responder falando" ao lado do campo, nas duas variantes (vivo e wizard, as duas já
 * editando quando o botão aparece). Alvo redondo provisório: o desenho definitivo é do Opus (mesmo
 * espírito da nota da P1, item 8, quando o `Briefing.dc.html` não tinha o estado ainda).
 */
function CampoComMicrofone({
  gravador,
  erroFala,
  children,
}: {
  gravador: ResultadoUseGravadorDeAudio;
  erroFala: string | null;
  children: ReactNode;
}) {
  const gravando = gravador.fase === "gravando";
  const rotulo = gravando ? t.botaoPararDeFalar : t.botaoResponderFalando;
  return (
    <>
      <div className={styles.linhaComMicrofone}>
        {children}
        <button
          type="button"
          className={[styles.botaoFalar, gravando ? styles.botaoFalarGravando : ""].filter(Boolean).join(" ")}
          onClick={() => (gravando ? gravador.pararGravacao() : void gravador.iniciarGravacao())}
          /**
           * Sem isto, tocar o microfone com o campo em foco (uma segunda gravação, por exemplo)
           * desfoca a área de texto antes do clique, o que dispara `aoSairDoCampo` e avalia a
           * resposta em paralelo com a gravação nova; se a avaliação terminar primeiro, o cartão
           * fecha e o botão "Parar" some com a gravação ainda rodando (achado nesta rodada,
           * `briefing-audio.spec.ts` intermitente). `preventDefault` no `mousedown` mantém o foco
           * no campo; o `onClick` continua disparando normalmente.
           */
          onMouseDown={(evento) => evento.preventDefault()}
          disabled={gravador.fase === "transcrevendo"}
          aria-label={rotulo}
          title={rotulo}
        >
          {gravando ? <Square size={18} strokeWidth={1.75} aria-hidden="true" /> : <Mic size={18} strokeWidth={1.75} aria-hidden="true" />}
        </button>
      </div>
      {gravando ? (
        <p className={styles.dicaFalar}>{t.contagemGravando(gravador.segundos, LIMITE_SEGUNDOS_PADRAO)}</p>
      ) : gravador.fase === "transcrevendo" ? (
        <p className={styles.dicaFalar}>{t.organizandoFala}</p>
      ) : erroFala ? (
        <p className={styles.erroInline} role="alert">
          <CircleAlert size={16} strokeWidth={1.5} aria-hidden="true" />
          {erroFala}
        </p>
      ) : (
        <p className={styles.dicaFalar}>{t.dicaResponderFalando}</p>
      )}
      {/* P2b, item 1 e 3: a prévia ao vivo, abaixo do campo, enquanto grava ou enquanto organiza a fala. */}
      {(gravando || gravador.fase === "transcrevendo") && gravador.previa.trim().length > 0 ? (
        <p className={styles.previaFala} aria-live="polite">
          {gravador.previa}
        </p>
      ) : null}
      {gravando && gravador.previaPorReconhecimentoDoAparelho ? (
        <p className={styles.previaAviso}>{textosComuns.previaUsaReconhecimentoDoAparelho}</p>
      ) : null}
    </>
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
  /**
   * P1, item 8: guarda o texto de antes de "Usar esta sugestão" ou de "Responder falando", para o
   * "desfazer" do toast. `tipo` escolhe o texto do toast (a sugestão e a fala usam frases diferentes).
   */
  const [sugestaoAplicada, setSugestaoAplicada] = useState<{ anterior: string; tipo: "sugestao" | "fala" | "falaSomada" } | null>(null);
  const areaRef = useRef<HTMLTextAreaElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * O texto de agora e o ultimo que o servidor confirmou (V7, item 4 do PROXIMO.md). Em ref porque quem
   * precisa deles roda fora de um render (o debounce, a aba que esconde, a rede que volta, o desmontar)
   * e nao pode ler o estado de um render antigo.
   */
  const textoRef = useRef(resposta);
  const salvoRef = useRef(resposta);
  /**
   * P2, item 3: a fala bruta de "Responder falando", para ir junto do rascunho quando ele salvar. Só
   * existe entre o momento em que a fala organizada entra no campo e o rascunho salvar; uma edição
   * manual depois (`aoMudarTexto` sem o segundo argumento) limpa, porque o texto deixou de ser o que
   * a pessoa falou.
   */
  const transcricaoBrutaPendenteRef = useRef<string | undefined>(undefined);
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
    const transcricaoBruta = transcricaoBrutaPendenteRef.current;
    if (valor === salvoRef.current) {
      setRascunhoSalvo(true);
      setRascunhoComErro(false);
      return true;
    }
    try {
      await onSalvarRascunho(pergunta.id, valor, transcricaoBruta);
      salvoRef.current = valor;
      if (textoRef.current === valor) {
        setRascunhoSalvo(true);
        setRascunhoComErro(false);
        // So limpa depois do sucesso, e so se nada mudou de novo enquanto salvava.
        if (transcricaoBrutaPendenteRef.current === transcricaoBruta) transcricaoBrutaPendenteRef.current = undefined;
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

  /**
   * `transcricaoBruta` (P2, item 3): só quando o texto novo veio do microfone (via
   * `aplicarFalaOrganizada`). Uma edição manual (o `onChange` do campo, "Usar esta sugestão",
   * "desfazer") nunca passa o segundo argumento, e a fala bruta pendente é limpa: o texto deixou de
   * ser exatamente o que a pessoa falou.
   */
  function aoMudarTexto(valor: string, transcricaoBruta?: string) {
    textoRef.current = valor;
    transcricaoBrutaPendenteRef.current = transcricaoBruta;
    setTexto(valor);
    setRascunhoSalvo(false);
    setRascunhoComErro(false);
    setErro(null);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void salvarPendente(), 800);
  }

  /**
   * "Usar esta sugestão" (P1, item 8): copia o exemplo de "como melhorar"
   * para o campo, substituindo o que estava, abre a edição (o cartão fechado
   * só mostra a resposta, só leitura) e leva o foco para lá, para a pessoa
   * editar em cima em vez de ler o exemplo como se fosse a resposta dela.
   * Guarda o texto de antes para o "desfazer" do toast.
   */
  function usarSugestaoEAbrirEdicao(exemplo: string) {
    setSugestaoAplicada({ anterior: textoRef.current, tipo: "sugestao" });
    aoMudarTexto(exemplo);
    setEditando(true);
    requestAnimationFrame(() => areaRef.current?.focus());
  }

  function desfazerSugestao() {
    if (!sugestaoAplicada) return;
    aoMudarTexto(sugestaoAplicada.anterior);
    setSugestaoAplicada(null);
  }

  /**
   * "Responder falando" (P2, item 2; M4, item 0a da revisão do PR #77): a transcrição organizada
   * (`organizarFalaBriefing`) entra no campo, editável, com "desfazer" pelo toast, igual à "Usar
   * esta sugestão". Campo vazio: substitui. Campo com texto: a fala entra numa linha nova, depois
   * do que já estava (a pessoa gravou em duas partes, por exemplo, pelo limite de 2 minutos); a
   * fala bruta pendente acumula do mesmo jeito, para `transcricoes_brutas` guardar as duas. Ao
   * contrário da sugestão, o campo já está aberto quando o microfone aparece (nas duas variantes),
   * então não precisa de `setEditando(true)`.
   */
  function aplicarFalaOrganizada(textoOrganizado: string, textoFalado: string) {
    const anterior = textoRef.current;
    const somando = anterior.trim().length > 0;
    const novoTexto = somando ? `${anterior}\n${textoOrganizado}` : textoOrganizado;
    const novaTranscricaoBruta = transcricaoBrutaPendenteRef.current
      ? `${transcricaoBrutaPendenteRef.current}\n${textoFalado}`
      : textoFalado;
    setSugestaoAplicada({ anterior, tipo: somando ? "falaSomada" : "fala" });
    aoMudarTexto(novoTexto, novaTranscricaoBruta);
    requestAnimationFrame(() => areaRef.current?.focus());
  }

  const gravador = useGravadorDeAudio({
    nomeArquivo: "briefing",
    async onTranscrito(textoFalado) {
      const textoOrganizado = await organizarFalaBriefingAction(pergunta.enunciado, textoFalado);
      aplicarFalaOrganizada(textoOrganizado, textoFalado);
    },
  });
  const erroFala = gravador.semMicrofone
    ? t.semMicrofone
    : gravador.erro === "audioVazio"
      ? t.audioVazioFala
      : gravador.erro === "falhaTranscricao"
        ? t.erroTranscricaoFala
        : null;

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

  /** M4, item 0a: texto do toast por tipo (a sugestão, a fala que substituiu, a fala que somou). */
  const textoToast =
    sugestaoAplicada?.tipo === "falaSomada"
      ? t.respostaFaladaSomada
      : sugestaoAplicada?.tipo === "fala"
        ? t.respostaFaladaAplicada
        : t.sugestaoAplicada;

  if (variante === "vivo" && avaliacao) {
    if (editando) {
      return (
        <div className={styles.linhaVivo}>
          <p className={styles.enunciado}>{pergunta.enunciado}</p>
          <CampoComMicrofone gravador={gravador} erroFala={erroFala}>
            <AreaTexto
              rotulo={pergunta.enunciado}
              rotuloOculto
              value={texto}
              onChange={(evento) => aoMudarTexto(evento.target.value)}
              caixaAlta={caixaAlta}
              erro={erro?.frase}
              disabled={avaliando || gravador.fase !== "inicial"}
            />
          </CampoComMicrofone>
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

  /** Variavel local para o closure de `onUsar` abaixo nao perder o estreitamento de tipo do optional. */
  const exemploDaAvaliacao = avaliacao?.exemplo;
  const sugestaoDaAnalise = exemploDaAvaliacao
    ? {
        rotulo: t.rotuloSugestao,
        botaoUsar: t.usarEstaSugestao,
        onUsar: () => usarSugestaoEAbrirEdicao(exemploDaAvaliacao),
      }
    : undefined;

  /**
   * P1, item 8 (achado do Gustavo: o Bruno leu o exemplo de "como melhorar"
   * como se fosse a própria resposta dele, porque o cartão fechado nunca
   * mostrava a resposta de verdade, só o enunciado e a análise): a resposta
   * vem sempre primeiro, no mesmo campo usado para editar (aqui, só leitura,
   * até "ajustar resposta"); a análise em quatro partes, com a nota no
   * próprio topo dela, vem abaixo do campo, nunca acima.
   */
  if (!editando && avaliacao) {
    return (
      <div className={styles.cartaoFechado}>
        <Chip pergunta={pergunta} />
        <AreaTexto
          rotulo={pergunta.enunciado}
          rotuloOculto
          value={textoAvaliado ?? resposta}
          readOnly
          caixaAlta={caixaAlta}
        />
        <AnaliseQuatroPartes
          avaliacao={avaliacao}
          rotulos={textosBriefing.analiseRotulos}
          meta={meta}
          rotulosFaixa={textosBriefing.faixaMeta}
          sugestao={sugestaoDaAnalise}
        />
        <p className={styles.fraseAjuste}>{t.fraseAjuste}</p>
        <Botao variante="ghost" onClick={() => setEditando(true)}>
          {t.botaoAjustarResposta}
        </Botao>
        <Toast
          texto={textoToast}
          aberto={sugestaoAplicada !== null}
          onFechar={() => setSugestaoAplicada(null)}
          acao={{ rotulo: t.desfazerSugestao, onClique: desfazerSugestao }}
        />
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
      <CampoComMicrofone gravador={gravador} erroFala={erroFala}>
        <AreaTexto
          ref={areaRef}
          rotulo={pergunta.enunciado}
          rotuloOculto
          value={texto}
          onChange={(evento) => aoMudarTexto(evento.target.value)}
          onBlur={aoSairDoCampo}
          caixaAlta={caixaAlta}
          disabled={avaliando || gravador.fase !== "inicial"}
        />
      </CampoComMicrofone>
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
      <Toast
        texto={textoToast}
        aberto={sugestaoAplicada !== null}
        onFechar={() => setSugestaoAplicada(null)}
        acao={{ rotulo: t.desfazerSugestao, onClique: desfazerSugestao }}
      />
    </div>
  );
}
