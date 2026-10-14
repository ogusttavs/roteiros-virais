"use client";

import { Check, ChevronLeft, ChevronRight, Copy, Eye, Mic, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";

import { marcarGravadoAction } from "@/app/(painel)/(completo)/roteiros/[id]/acoes";
import { useMarcasDeFala } from "@/app/(painel)/(completo)/roteiros/[id]/useMarcasDeFala";
import type { CapituloDoRoteiro } from "@/db/schema";
import { capitulosParaCopiar, iniciosDosCapitulos, primeiroCapituloQueFalta, tempoNaTela } from "@/lib/capitulos-do-roteiro";
import { iniciaisDe } from "@/lib/iniciais";
import { blocosFaladosDoConteudo, ganchosDosCapitulos, marcadoParaOsParagrafos, paragrafosMarcados, TONS_DO_BLOCO, type FalaDoRoteiro, type TomDoBloco } from "@/lib/marcas-de-fala";
import { textosConexao } from "@/textos/conexao";
import { textosGravacao } from "@/textos/gravacao";
import { textosMarcasDeFala } from "@/textos/marcas-de-fala";
import { FalaMarcada } from "@/ui/componentes/FalaMarcada";
import { LinhaMarcasDeFala } from "@/ui/componentes/LinhaMarcasDeFala";
import { Toast } from "@/ui/componentes/Toast";
import { useTratarFalha } from "@/ui/ConexaoContext";
import { useSemRede } from "@/ui/useSemRede";

import stylesLongo from "./GravacaoLonga.module.css";
import styles from "./GravacaoTela.module.css";
import { useTelaAcesa } from "./useTelaAcesa";

type Props = {
  roteiroId: number;
  titulo: string;
  capitulos: CapituloDoRoteiro[];
  /** O gancho do vídeo e a chamada final: o que se diz como está escrito, no primeiro e no último capítulo. */
  gancho: string;
  chamadaFinal: string;
  /** Se o roteiro já estava marcado como gravado ao entrar. */
  jaGravado: boolean;
  nomeMarca?: string;
  fala: FalaDoRoteiro;
  /** A marca ativa: a escolha das marcas aqui é lembrada por marca, neste aparelho (a mesma do modo gravação de sempre). */
  marcaId: number;
};

function chaveDaMemoriaDasMarcas(marcaId: number): string {
  return `marcas-de-fala:gravacao:${marcaId}`;
}

/** O "Já gravei" de cada capítulo fica neste aparelho, por roteiro (como a escolha das marcas na E41): nada disso vai para o servidor. */
function chaveDosGravados(roteiroId: number): string {
  return `capitulos-gravados:${roteiroId}`;
}

function lerGravados(roteiroId: number, total: number): Set<number> {
  try {
    const bruto = JSON.parse(window.localStorage.getItem(chaveDosGravados(roteiroId)) ?? "[]") as unknown;
    if (!Array.isArray(bruto)) return new Set();
    return new Set(bruto.filter((n): n is number => Number.isInteger(n) && n >= 0 && n < total));
  } catch {
    return new Set();
  }
}

function guardarGravados(roteiroId: number, gravados: Set<number>): void {
  try {
    window.localStorage.setItem(chaveDosGravados(roteiroId), JSON.stringify([...gravados].sort((a, b) => a - b)));
  } catch {
    // Sem armazenamento (janela privada, dados bloqueados): vale só nesta visita.
  }
}

/**
 * O modo gravação do vídeo longo (E52, PR 5, `Gravacao.dc.html`, estados `longo` e `longoTodos`): um capítulo por vez, com o nome, os pontos numerados (direção, nunca letra grande), o que
 * está na imagem e, na letra grande, só a frase que segura até o próximo (no primeiro capítulo, o gancho do vídeo vem antes; no último, a chamada final no lugar da frase). "Já gravei este"
 * marca e passa ao seguinte; a seta da direita passa sem marcar. Com todos marcados aparece a lista com "Copiar os capítulos".
 */
export function GravacaoLongaTela({ roteiroId, titulo, capitulos, gancho, chamadaFinal, jaGravado, nomeMarca, fala, marcaId }: Props) {
  const router = useRouter();
  const total = capitulos.length;
  const inicios = iniciosDosCapitulos(capitulos);
  const [indice, setIndice] = useState(0);
  const [gravados, setGravados] = useState<Set<number>>(() => new Set());
  const [vendoFim, setVendoFim] = useState(false);
  const [gravadoNoServidor, setGravadoNoServidor] = useState(jaGravado);
  const [marcandoServidor, setMarcandoServidor] = useState(false);
  const [copiado, setCopiado] = useState<"sim" | "erro" | null>(null);
  const [avisoErro, setAvisoErro] = useState<string | null>(null);
  const [saindo, iniciarSaida] = useTransition();
  const semRede = useSemRede();
  const tratarFalha = useTratarFalha();
  const idMotivoSemRede = useId();
  const temWakeLock = useTelaAcesa();

  // A memória do aparelho só vale depois de lida (no navegador): quem já gravou capítulos volta ao primeiro que falta, e com todos marcados volta ao fim.
  const [memoriaLida, setMemoriaLida] = useState(false);
  /** Marca o roteiro como gravado no servidor uma vez só: ao marcar o último capítulo, ou ao voltar com todos já marcados no aparelho e o servidor ainda sem saber (a primeira tentativa pode ter caído sem rede). */
  const marcouNoServidor = useRef(jaGravado);
  function marcarRoteiroGravado() {
    if (marcouNoServidor.current) return;
    marcouNoServidor.current = true;
    setMarcandoServidor(true);
    marcarGravadoAction(roteiroId)
      .then(() => setGravadoNoServidor(true))
      .catch((falha) => {
        marcouNoServidor.current = false;
        setAvisoErro(tratarFalha(falha, textosGravacao.erroMarcar, textosGravacao.erroMarcarSemRede));
      })
      .finally(() => setMarcandoServidor(false));
  }
  useEffect(() => {
    const lidos = lerGravados(roteiroId, total);
    setGravados(lidos);
    const falta = primeiroCapituloQueFalta(lidos, total);
    if (falta === null) {
      setVendoFim(true);
      marcarRoteiroGravado();
    } else setIndice(falta);
    setMemoriaLida(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só ao abrir (ou ao trocar de roteiro): a função lê estado que muda depois
  }, [roteiroId, total]);

  // As marcas de fala: LIGADAS por padrão aqui (é onde a marca importa) e a escolha de desligar é lembrada por marca neste aparelho, a mesma do modo gravação de sempre. Só as frases ditas como
  // estão escritas levam marca; os pontos nunca.
  const [marcasLigadas, setMarcasLigadas] = useState(true);
  const chaveDoTexto = JSON.stringify(blocosFaladosDoConteudo({ gancho, corpo: "", fechamento: "", chamadaFinal, capitulos }));
  const { marcas: marcasProntas, estado: estadoMarcas, erro: erroMarcas, pedir: pedirMarcas } = useMarcasDeFala(roteiroId, fala, chaveDoTexto);
  const [memoriaDasMarcasLida, setMemoriaDasMarcasLida] = useState(false);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(chaveDaMemoriaDasMarcas(marcaId)) === "desligadas") setMarcasLigadas(false);
    } catch {
      // Sem armazenamento: fica no padrão, ligadas.
    }
    setMemoriaDasMarcasLida(true);
  }, [marcaId]);
  useEffect(() => {
    if (memoriaDasMarcasLida && marcasLigadas) pedirMarcas();
  }, [memoriaDasMarcasLida, marcasLigadas, pedirMarcas, chaveDoTexto]);
  function trocarMarcas(ligar: boolean) {
    setMarcasLigadas(ligar);
    try {
      if (ligar) window.localStorage.removeItem(chaveDaMemoriaDasMarcas(marcaId));
      else window.localStorage.setItem(chaveDaMemoriaDasMarcas(marcaId), "desligadas");
    } catch {
      // Sem armazenamento: vale só nesta visita.
    }
  }
  const temChaveDeMarcas = fala.podeMarcar && (!fala.somenteLeitura || fala.marcas !== null);
  const marcas = marcasLigadas ? marcasProntas : null;
  const ganchos = ganchosDosCapitulos({ capitulos });
  const marcadosDosCapitulos = marcadoParaOsParagrafos(
    ganchos.map((g) => g.texto),
    paragrafosMarcados(marcas, "corpo"),
  );
  const marcadoDoGancho = marcadoParaOsParagrafos([gancho.trim()], paragrafosMarcados(marcas, "gancho"))?.[0] ?? null;
  const marcadoDaChamada = marcadoParaOsParagrafos([chamadaFinal.trim()], paragrafosMarcados(marcas, "chamadaFinal"))?.[0] ?? null;

  const capitulo = capitulos[indice];
  const ehOPrimeiro = indice === 0;
  const ehOUltimo = indice === total - 1;
  const seguinte = capitulos[indice + 1] ?? null;
  const tomValido = (TONS_DO_BLOCO as readonly string[]).includes(capitulo?.tom ?? "") ? (capitulo.tom as TomDoBloco) : null;
  const marcadoDoCapitulo = marcadosDosCapitulos ? (marcadosDosCapitulos[ganchos.findIndex((g) => g.indice === indice)] ?? null) : null;

  /** Marca o capítulo da vez neste aparelho e passa ao seguinte (ou ao primeiro que falta). Com todos marcados, marca o roteiro como gravado e mostra o fim. */
  function jaGravei() {
    const proximos = new Set(gravados).add(indice);
    setGravados(proximos);
    guardarGravados(roteiroId, proximos);
    const falta = primeiroCapituloQueFalta(proximos, total, indice + 1);
    if (falta !== null) {
      setIndice(falta);
      return;
    }
    setVendoFim(true);
    marcarRoteiroGravado();
  }

  /** A seta da direita passa sem marcar; no último capítulo volta ao primeiro que ainda falta (ou ao fim, se não falta nenhum). */
  function proximoSemMarcar() {
    if (indice < total - 1) {
      setIndice(indice + 1);
      return;
    }
    const falta = primeiroCapituloQueFalta(gravados, total);
    if (falta === null) setVendoFim(true);
    else setIndice(falta);
  }

  function anterior() {
    if (vendoFim) {
      setVendoFim(false);
      setIndice(total - 1);
      return;
    }
    setIndice((i) => Math.max(0, i - 1));
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(capitulosParaCopiar(capitulos));
      setCopiado("sim");
    } catch {
      setCopiado("erro");
    }
  }

  function voltarAoRoteiro() {
    iniciarSaida(() => router.push(`/roteiros/${roteiroId}?gravado=1`));
  }

  const t = textosGravacao.longo;
  const mostrandoFim = vendoFim && memoriaLida;

  return (
    <div className={styles.gravacao} data-gravacao-longa>
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
        <div className={styles.passos} role="group" aria-label={t.gruposAria} title={titulo}>
          {capitulos.map((c, i) => (
            <span
              key={i}
              data-passo-gravado={gravados.has(i) ? "" : undefined}
              data-passo-atual={!mostrandoFim && i === indice ? "" : undefined}
              className={[styles.passo, gravados.has(i) ? styles.feito : "", !mostrandoFim && i === indice ? styles.atual : ""].filter(Boolean).join(" ")}
            />
          ))}
        </div>
        <span className={styles.contagem}>{textosGravacao.contagem(mostrandoFim ? total : indice + 1, total)}</span>
      </header>

      <main className={`${styles.palco} ${stylesLongo.palcoCapitulo}`}>
        {mostrandoFim ? (
          <div className={styles.palcoCentro} data-gravacao-longa-fim>
            <span className={styles.blocoTempo}>{t.quantosGravados(gravados.size, total)}</span>
            <h1 className={stylesLongo.nomeCapitulo}>{t.fimTitulo(total)}</h1>
            <p className={stylesLongo.ajudaFim}>{t.fimAjuda}</p>
            <ol className={stylesLongo.gravados} aria-label={t.listaAria}>
              {capitulos.map((c, i) => (
                <li key={i}>
                  <Check size={16} strokeWidth={2} aria-hidden="true" />
                  <b>{tempoNaTela(inicios[i])}</b>
                  <span>{c.nome}</span>
                </li>
              ))}
            </ol>
            <button type="button" className={stylesLongo.copiar} onClick={() => void copiar()} data-copiar-capitulos>
              <Copy size={16} strokeWidth={1.5} aria-hidden="true" />
              {t.copiarCapitulos}
            </button>
            <span role="status" className={stylesLongo.statusCopia}>
              {copiado === "sim" ? t.copiado : copiado === "erro" ? t.erroCopiar : ""}
            </span>
          </div>
        ) : (
          <div className={styles.palcoCentro} data-capitulo-da-vez={indice + 1}>
            <div className={styles.tomGravacao}>
              <span className={styles.blocoTempo}>{t.capitulo(indice + 1, total, tempoNaTela(inicios[indice]), tempoNaTela(inicios[indice] + capitulo.duracaoS))}</span>
              {tomValido ? (
                <span className={styles.tom} data-tom-do-capitulo={tomValido}>
                  <Mic size={16} strokeWidth={1.75} aria-hidden="true" />
                  <span>
                    <b>{textosMarcasDeFala.tom.rotulo(tomValido)}</b> {textosMarcasDeFala.tom.dica[tomValido]}
                  </span>
                </span>
              ) : null}
            </div>
            <h1 className={stylesLongo.nomeCapitulo}>{capitulo.nome}</h1>
            {ehOPrimeiro && gancho.trim() ? (
              <div className={stylesLongo.segurar} data-gancho-do-video>
                <span className={styles.rotuloProximo}>{t.ganchoDoVideo}</span>
                <p className={styles.fala}>{marcadoDoGancho ? <FalaMarcada marcado={marcadoDoGancho} /> : gancho}</p>
              </div>
            ) : null}
            <ol className={stylesLongo.pontos} aria-label={t.pontosAria}>
              {capitulo.pontos.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ol>
            {capitulo.naImagem ? (
              <p className={stylesLongo.naImagem} data-na-imagem>
                <b>{t.naImagem}</b> {capitulo.naImagem}
              </p>
            ) : null}
            {ehOUltimo ? (
              chamadaFinal.trim() ? (
                <div className={stylesLongo.segurar} data-chamada-final>
                  <span className={styles.rotuloProximo}>{t.chamada}</span>
                  <p className={styles.fala}>{marcadoDaChamada ? <FalaMarcada marcado={marcadoDaChamada} /> : chamadaFinal}</p>
                </div>
              ) : null
            ) : capitulo.ganchoParaOProximo ? (
              <div className={stylesLongo.segurar} data-segurar>
                <span className={styles.rotuloProximo}>{t.segurar}</span>
                <p className={styles.fala}>{marcadoDoCapitulo ? <FalaMarcada marcado={marcadoDoCapitulo} /> : capitulo.ganchoParaOProximo}</p>
              </div>
            ) : null}
            {seguinte ? (
              <div className={styles.proximo}>
                <span className={styles.rotuloProximo}>{t.depoisVemCapitulo(indice + 2, tempoNaTela(inicios[indice + 1]), tempoNaTela(inicios[indice + 1] + seguinte.duracaoS))}</span>
                <p className={styles.falaProxima}>{seguinte.nome}</p>
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
        )}
      </main>

      <div className={styles.controles}>
        <button type="button" aria-label={t.capituloAnterior} className={styles.redondo} disabled={!mostrandoFim && indice === 0} onClick={anterior}>
          <ChevronLeft size={24} strokeWidth={1.75} aria-hidden="true" />
        </button>
        {mostrandoFim ? (
          <button type="button" className={styles.btn} disabled={saindo} aria-busy={saindo || undefined} onClick={voltarAoRoteiro}>
            {t.voltarAoRoteiro}
          </button>
        ) : (
          <button type="button" className={styles.btn} aria-label={t.jaGraveiAria(capitulo.nome)} onClick={jaGravei} data-ja-gravei>
            {t.jaGravei}
          </button>
        )}
        <button type="button" aria-label={mostrandoFim ? t.proximoCapitulo : t.proximoSemMarcar} className={styles.redondo} disabled={mostrandoFim} onClick={proximoSemMarcar} data-proximo-sem-marcar>
          <ChevronRight size={24} strokeWidth={1.75} aria-hidden="true" />
        </button>
        {semRede ? (
          <p id={idMotivoSemRede} className={styles.motivoSemRede}>
            {textosConexao.precisaDeConexao}
          </p>
        ) : null}
      </div>

      <Toast variante="erro" texto={avisoErro ?? ""} aberto={avisoErro !== null} onFechar={() => setAvisoErro(null)} />
    </div>
  );
}
