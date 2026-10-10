"use client";

import { Check, ChevronLeft, Eye, Mic, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState, useTransition } from "react";

import { marcarGravadoAction } from "@/app/(painel)/(completo)/roteiros/[id]/acoes";
import { useMarcasDeFala } from "@/app/(painel)/(completo)/roteiros/[id]/useMarcasDeFala";
import { iniciaisDe } from "@/lib/iniciais";
import { BLOCOS_FALADOS, marcadoParaOsParagrafos, paragrafosMarcados, type FalaDoRoteiro } from "@/lib/marcas-de-fala";
import { textosConexao } from "@/textos/conexao";
import { textosGravacao } from "@/textos/gravacao";
import { textosMarcasDeFala } from "@/textos/marcas-de-fala";
import { FalaMarcada } from "@/ui/componentes/FalaMarcada";
import { LinhaMarcasDeFala } from "@/ui/componentes/LinhaMarcasDeFala";
import { Toast } from "@/ui/componentes/Toast";
import { useTratarFalha } from "@/ui/ConexaoContext";
import { useSemRede } from "@/ui/useSemRede";

import styles from "./GravacaoTela.module.css";

/** V11, item 6: `mostrar` é opcional (nem todo bloco tem o que mostrar além da fala). */
type Bloco = { rotulo: string; paragrafos: string[]; mostrar?: string[] };

type Props = {
  roteiroId: number;
  titulo: string;
  blocos: Bloco[];
  /** Se o roteiro já estava marcado como gravado ao entrar (revisão do PR #31, item 6). */
  jaGravado: boolean;
  /**
   * Nome da marca ativa, só com mais de uma marca (V3, item 3,
   * Gravacao.dc.html): em linha pequena no topo, sem ação, só para
   * confirmar para qual marca se está gravando.
   */
  nomeMarca?: string;
  /** E41 parte 2b: a fala marcada deste roteiro (se tem fala para marcar, se a conta só olha, e as marcas que já existem). */
  fala: FalaDoRoteiro;
  /** A marca ativa: a escolha de ligar ou desligar as marcas aqui é lembrada por marca, neste aparelho. */
  marcaId: number;
};

/** A escolha da pessoa neste aparelho, por marca (decisão do passo 24: "o modo gravação lembra: se ela desligar as marcas lá, fica desligado na próxima vez"). */
function chaveDaMemoria(marcaId: number): string {
  return `marcas-de-fala:gravacao:${marcaId}`;
}

/**
 * Modo gravação como tela própria, sem navegação (design v2,
 * `entrega/telas/Gravacao.dc.html`; `PROXIMO.md`, D2 parte 1, item 7):
 * substitui o modo gravação que era um estado sobreposto de `/roteiros/[id]`.
 */
export function GravacaoTela({ roteiroId, titulo, blocos, jaGravado, nomeMarca, fala, marcaId }: Props) {
  const router = useRouter();
  const [passo, setPasso] = useState(0);
  const [temWakeLock, setTemWakeLock] = useState(false);
  const [gravado, setGravado] = useState(jaGravado);
  const [marcando, setMarcando] = useState(false);
  const semRede = useSemRede();
  // A frase do aviso de falha (ou null, sem aviso): falha do servidor e queda de conexão dizem coisas diferentes.
  const [avisoErro, setAvisoErro] = useState<string | null>(null);
  /** V11, item 5: o toast "Gravado" de quem marca pelo botão redondo, sem sair da tela. */
  const [avisoSucesso, setAvisoSucesso] = useState(false);
  // Fora do layout do painel não há o provedor `Conexao`: `tratarFalha` só escolhe a frase, não acende faixa.
  const tratarFalha = useTratarFalha();
  const idMotivoSemRede = useId();

  // E41 parte 2b: as marcas de fala aqui vêm LIGADAS por padrão (é onde a marca importa, na letra grande) e a escolha de desligar é lembrada por marca neste aparelho. Sem as marcas
  // prontas, o texto aparece inteiro e a claquete pequena diz que estão sendo escritas (o roteiro costuma já tê-las: a tela do roteiro pede ao abrir).
  const [marcasLigadas, setMarcasLigadas] = useState(true);
  const chaveDoTexto = JSON.stringify(blocos.map((b) => b.paragrafos));
  const { marcas: marcasProntas, estado: estadoMarcas, erro: erroMarcas, pedir: pedirMarcas } = useMarcasDeFala(roteiroId, fala, chaveDoTexto);
  // A memória só vale depois de lida (no navegador): sem isso o pedido das marcas saía com o padrão "ligadas" antes de a escolha lembrada chegar, e gastava uma chamada de quem desligou.
  const [memoriaLida, setMemoriaLida] = useState(false);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(chaveDaMemoria(marcaId)) === "desligadas") setMarcasLigadas(false);
    } catch {
      // Sem armazenamento (janela privada, dados bloqueados): fica no padrão, ligadas.
    }
    setMemoriaLida(true);
  }, [marcaId]);
  useEffect(() => {
    if (memoriaLida && marcasLigadas) pedirMarcas();
  }, [memoriaLida, marcasLigadas, pedirMarcas, chaveDoTexto]);
  function trocarMarcas(ligar: boolean) {
    setMarcasLigadas(ligar);
    try {
      if (ligar) window.localStorage.removeItem(chaveDaMemoria(marcaId));
      else window.localStorage.setItem(chaveDaMemoria(marcaId), "desligadas");
    } catch {
      // Sem armazenamento: vale só nesta visita.
    }
  }
  const temChaveDeMarcas = fala.podeMarcar && (!fala.somenteLeitura || fala.marcas !== null);
  const mostrarMarcas = marcasLigadas && marcasProntas !== null;
  // "Sair" só navega e espera o servidor sem mostrar nada (V7, item 4); sem conexão o navegador faz a navegação
  // inteira e a página do roteiro vem do que foi guardado, então continua funcionando.
  const [saindo, iniciarSaida] = useTransition();

  /**
   * O navegador solta o wake lock sozinho quando a aba fica escondida (a
   * pessoa troca para a câmera para gravar); pedir de novo ao voltar
   * visível, e esconder o aviso enquanto não tiver (revisão do PR #31,
   * item 5: nunca mentir que a tela vai ficar acesa).
   */
  useEffect(() => {
    if (!("wakeLock" in navigator)) return;
    let sentinela: WakeLockSentinel | null = null;
    let cancelado = false;

    async function pedir() {
      if (document.visibilityState !== "visible") return;
      try {
        const s = await navigator.wakeLock.request("screen");
        if (cancelado) {
          s.release();
          return;
        }
        sentinela = s;
        setTemWakeLock(true);
        s.addEventListener("release", () => setTemWakeLock(false));
      } catch {
        setTemWakeLock(false);
      }
    }

    function aoMudarVisibilidade() {
      if (document.visibilityState === "visible") pedir();
    }

    pedir();
    document.addEventListener("visibilitychange", aoMudarVisibilidade);
    return () => {
      cancelado = true;
      document.removeEventListener("visibilitychange", aoMudarVisibilidade);
      sentinela?.release();
    };
  }, []);

  const bloco = blocos[passo];
  // O Reels falado tem os quatro blocos na ordem de `BLOCOS_FALADOS`; o bloco marcado é o de mesmo nome (e só vale se tiver o mesmo número de parágrafos).
  const nomeDoBloco = fala.podeMarcar && blocos.length === BLOCOS_FALADOS.length ? BLOCOS_FALADOS[passo] : undefined;
  const paragrafosMarcadosDoBloco = mostrarMarcas && nomeDoBloco ? marcadoParaOsParagrafos(bloco.paragrafos, paragrafosMarcados(marcasProntas, nomeDoBloco)) : null;
  const tomDoBloco = paragrafosMarcadosDoBloco && nomeDoBloco ? marcasProntas?.blocos.find((b) => b.bloco === nomeDoBloco)?.tom : undefined;
  const proximo = blocos[passo + 1] ?? null;
  const primeiroParagrafoProximo = proximo?.paragrafos[0] ?? null;
  const ultimoBloco = passo === blocos.length - 1;

  /** O botão redondo, nos blocos que não são o último (V11, item 5): marca e mostra o toast, sem sair da tela. */
  function marcarGravado() {
    if (gravado || marcando) return;
    setMarcando(true);
    marcarGravadoAction(roteiroId)
      .then(() => {
        setGravado(true);
        setAvisoSucesso(true);
      })
      .catch((falha) => setAvisoErro(tratarFalha(falha, textosGravacao.erroMarcar, textosGravacao.erroMarcarSemRede)))
      .finally(() => setMarcando(false));
  }

  /**
   * "Terminei de gravar" (V11, item 5): só no último bloco. Marca gravado (se ainda não estava) e
   * sai para o roteiro, com o toast "Gravado" chegando lá (`?gravado=1`, `RoteiroTela.tsx`).
   */
  function terminarGravacao() {
    if (marcando) return;
    if (gravado) {
      iniciarSaida(() => router.push(`/roteiros/${roteiroId}?gravado=1`));
      return;
    }
    setMarcando(true);
    marcarGravadoAction(roteiroId)
      .then(() => {
        setGravado(true);
        iniciarSaida(() => router.push(`/roteiros/${roteiroId}?gravado=1`));
      })
      .catch((falha) => setAvisoErro(tratarFalha(falha, textosGravacao.erroMarcar, textosGravacao.erroMarcarSemRede)))
      .finally(() => setMarcando(false));
  }

  return (
    <div className={styles.gravacao}>
      <header className={nomeMarca ? `${styles.topo} ${styles.comMarca}` : styles.topo}>
        {nomeMarca ? (
          <p className={styles.marcaGravando}>
            <span className={styles.avatar} aria-hidden="true">
              {iniciaisDe(nomeMarca)}
            </span>
            <span>{nomeMarca}</span>
          </p>
        ) : null}
        <button
          type="button"
          aria-label={textosGravacao.sair}
          aria-busy={saindo || undefined}
          disabled={saindo}
          className={styles.botaoSair}
          onClick={() => iniciarSaida(() => router.push(`/roteiros/${roteiroId}`))}
        >
          <X size={22} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <div className={styles.passos} role="group" aria-label={titulo}>
          {blocos.map((_, indice) => (
            <span
              key={indice}
              className={[styles.passo, indice < passo ? styles.feito : "", indice === passo ? styles.atual : ""]
                .filter(Boolean)
                .join(" ")}
            />
          ))}
        </div>
        <span className={styles.contagem}>{textosGravacao.contagem(passo + 1, blocos.length)}</span>
      </header>

      <main className={styles.palco}>
        <div className={styles.palcoCentro}>
          <div className={styles.tomGravacao}>
            <span className={styles.blocoTempo}>{bloco.rotulo}</span>
            {tomDoBloco ? (
              <span className={styles.tom} data-tom-do-bloco={tomDoBloco}>
                <Mic size={16} strokeWidth={1.75} aria-hidden="true" />
                <span>
                  <b>{textosMarcasDeFala.tom.rotulo(tomDoBloco)}</b> {textosMarcasDeFala.tom.dica[tomDoBloco]}
                </span>
              </span>
            ) : null}
          </div>
          {bloco.paragrafos.map((paragrafo, indice) => (
            <p key={indice} className={styles.fala}>
              {paragrafosMarcadosDoBloco ? <FalaMarcada marcado={paragrafosMarcadosDoBloco[indice]} /> : paragrafo}
            </p>
          ))}
          {bloco.mostrar && bloco.mostrar.length > 0 ? (
            <div className={styles.mostrar}>
              {bloco.mostrar.map((linha, indice) => (
                <p key={indice} className={styles.mostrarLinha}>
                  {linha}
                </p>
              ))}
            </div>
          ) : null}
          {primeiroParagrafoProximo ? (
            <div className={styles.proximo}>
              <span className={styles.rotuloProximo}>{textosGravacao.depoisVem}</span>
              <p className={styles.falaProxima}>{primeiroParagrafoProximo}</p>
            </div>
          ) : null}
          {temChaveDeMarcas ? (
            <LinhaMarcasDeFala
              variante="gravacao"
              ligadas={marcasLigadas}
              aoTrocar={trocarMarcas}
              marcando={estadoMarcas === "marcando" && marcasProntas === null}
              erro={marcasLigadas ? erroMarcas : null}
              avisos={marcasProntas?.avisos ?? []}
            />
          ) : null}
          {temWakeLock ? (
            <p className={styles.avisoTela}>
              <Eye size={16} strokeWidth={1.5} aria-hidden="true" />
              {textosGravacao.telaAcesa}
            </p>
          ) : null}
        </div>
      </main>

      <div className={styles.controles}>
        <button
          type="button"
          aria-label={textosGravacao.blocoAnterior}
          className={styles.redondo}
          disabled={passo === 0}
          onClick={() => setPasso((p) => Math.max(0, p - 1))}
        >
          <ChevronLeft size={24} strokeWidth={1.75} aria-hidden="true" />
        </button>
        {ultimoBloco ? (
          <button
            type="button"
            className={styles.btn}
            disabled={marcando || semRede}
            aria-busy={marcando || undefined}
            aria-describedby={semRede ? idMotivoSemRede : undefined}
            onClick={terminarGravacao}
          >
            {textosGravacao.terminei}
          </button>
        ) : (
          <>
            <button
              type="button"
              className={styles.btn}
              disabled={passo === blocos.length - 1}
              onClick={() => setPasso((p) => Math.min(blocos.length - 1, p + 1))}
            >
              {textosGravacao.proximoBloco}
            </button>
            <button
              type="button"
              aria-label={gravado ? textosGravacao.gravado : textosGravacao.marcarGravei}
              aria-pressed={gravado}
              aria-describedby={semRede ? idMotivoSemRede : undefined}
              className={`${styles.redondo} ${gravado ? styles.redondoFeito : ""}`}
              disabled={marcando || semRede}
              onClick={marcarGravado}
            >
              <Check size={24} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </>
        )}
        {/* Na linha de baixo dos controles, ocupando a largura toda: não cobre nenhum toque nem some fora da tela
            (a `.gravacao` tem altura fixa, um irmão a mais dos controles cairia numa linha de fora). */}
        {semRede ? (
          <p id={idMotivoSemRede} className={styles.motivoSemRede}>
            {textosConexao.precisaDeConexao}
          </p>
        ) : null}
      </div>

      <Toast
        variante="erro"
        texto={avisoErro ?? ""}
        aberto={avisoErro !== null}
        onFechar={() => setAvisoErro(null)}
      />
      <Toast texto={textosGravacao.gravadoToast} aberto={avisoSucesso} onFechar={() => setAvisoSucesso(false)} />
    </div>
  );
}
