"use client";

import { ArrowLeft, CircleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import type { ResultadoAvaliarTema } from "@/servicos/temas";
import { textosComuns } from "@/textos/comuns";
import { textosTemaLivre } from "@/textos/tema-livre";
import { AreaTexto } from "@/ui/componentes/AreaTexto";
import { BarraTopo } from "@/ui/componentes/BarraTopo";
import { Botao } from "@/ui/componentes/Botao";
import { EsperaEtapas } from "@/ui/componentes/EsperaEtapas";
import { faixaMeta } from "@/ui/componentes/notaFaixaMeta";
import { NotasLinha } from "@/ui/componentes/NotaLinha";
import { useConexao, useTratarFalha } from "@/ui/ConexaoContext";

import { avaliarTemaAction, salvarRascunhoAction } from "./acoes";
import styles from "./TemaLivreTela.module.css";

type Fase = "proposta" | "esperando" | "naMeta" | "abaixoDaMeta" | "erro";

const ORDEM_PILARES: { chave: keyof ResultadoAvaliarTema["pilares"]; indice: number }[] = [
  { chave: "viralizar", indice: 0 },
  { chave: "gerarCliente", indice: 1 },
  { chave: "encaixe", indice: 2 },
  { chave: "novidade", indice: 3 },
  { chave: "facilidade", indice: 4 },
];

const TITULO_COMPACTO: Record<Fase, string> = {
  proposta: textosTemaLivre.tituloCompactoProposta,
  esperando: textosTemaLivre.tituloCompactoEsperandoErro,
  erro: textosTemaLivre.tituloCompactoEsperandoErro,
  naMeta: textosTemaLivre.tituloCompactoResultado,
  abaixoDaMeta: textosTemaLivre.tituloCompactoResultado,
};

const TITULO: Record<Fase, string> = {
  proposta: textosTemaLivre.titulo,
  esperando: textosTemaLivre.tituloEsperando,
  erro: textosTemaLivre.tituloEsperando,
  naMeta: textosTemaLivre.tituloNaMeta,
  abaixoDaMeta: textosTemaLivre.tituloAbaixoDaMeta,
};

const SUBTITULO: Record<Fase, string> = {
  proposta: textosTemaLivre.subtitulo,
  esperando: textosTemaLivre.subtituloEsperando,
  erro: textosTemaLivre.subtituloErro,
  naMeta: textosTemaLivre.subtituloNaMeta,
  abaixoDaMeta: textosTemaLivre.subtituloAbaixoDaMeta,
};

function formatarNota(valor: number): string {
  return valor.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

type Props = { notaMinima: number; temaInicial?: string };

/**
 * `/hoje/tema-livre` (V5b, D2 parte 4; design v2,
 * `entrega/telas/TemaLivre.dc.html`, cinco estados). O texto digitado e o
 * resultado de uma avaliação ficam em estado local; o rascunho no servidor
 * (item 2) só existe para sobreviver a troca de tela, de aparelho ou queda
 * de rede antes de avaliar.
 */
export function TemaLivreTela({ notaMinima, temaInicial = "" }: Props) {
  const router = useRouter();
  const [texto, setTexto] = useState(temaInicial);
  const [fase, setFase] = useState<Fase>("proposta");
  const [resultado, setResultado] = useState<ResultadoAvaliarTema | null>(null);
  const [campoVazio, setCampoVazio] = useState(false);
  // A frase da tela de erro: a de sempre (falha do servidor, "a falha foi nossa") ou a de rede (V7, item 4).
  const [fraseErro, setFraseErro] = useState(textosTemaLivre.textoErro);
  const [rascunhoComErro, setRascunhoComErro] = useState(false);
  const timerRascunhoRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // O que a pessoa digitou por último, e se isso ainda não chegou ao servidor (o reenvio depende dos dois).
  const textoAtualRef = useRef(temaInicial);
  const rascunhoPendenteRef = useRef(false);
  const botaoRef = useRef<HTMLDivElement>(null);
  const tratarFalha = useTratarFalha();
  const { avisarRedeOk } = useConexao();
  // Toque que só navega espera o servidor sem mostrar nada; "Abrindo" no botão tocado, os outros desabilitados
  // (V7, item 4). `destino` diz qual toque está em andamento.
  const [abrindo, iniciarTransicao] = useTransition();
  const [destino, setDestino] = useState<string | null>(null);
  const abrindoEste = (chave: string) => abrindo && destino === chave;
  const urlObjetivo = `/hoje/objetivo?livre=${encodeURIComponent(texto)}`;

  function abrir(chave: string, url: string) {
    if (abrindo) return;
    setDestino(chave);
    iniciarTransicao(() => router.push(url));
  }

  // Salva sozinho, sem bloquear a digitação. Se falhar, a frase "salva sozinho" seria falsa: troca por uma
  // honesta e o texto continua pendente para o reenvio (rede de volta, ou a pessoa trocando de app).
  const salvarRascunho = useCallback((valor: string) => {
    salvarRascunhoAction(valor)
      .then(() => {
        // Uma resposta antiga não apaga o pendente de um texto que a pessoa já mudou depois.
        if (textoAtualRef.current !== valor) return;
        rascunhoPendenteRef.current = false;
        setRascunhoComErro(false);
      })
      .catch(() => {
        if (textoAtualRef.current === valor) setRascunhoComErro(true);
      });
  }, []);

  function aoMudarTexto(valor: string) {
    setTexto(valor);
    setCampoVazio(false);
    textoAtualRef.current = valor;
    rascunhoPendenteRef.current = true;
    if (timerRascunhoRef.current) clearTimeout(timerRascunhoRef.current);
    timerRascunhoRef.current = setTimeout(() => salvarRascunho(valor), 800);
  }

  // Reenvia o que ficou pendente quando a rede volta e quando a aba vai para o fundo (o iOS descarta aba
  // escondida: sem isto o texto digitado sumia com a tela dizendo que estava salvo). O que ainda esperava o
  // debounce também sai agora.
  useEffect(() => {
    function reenviarPendente() {
      if (!rascunhoPendenteRef.current) return;
      if (timerRascunhoRef.current) clearTimeout(timerRascunhoRef.current);
      salvarRascunho(textoAtualRef.current);
    }
    function aoMudarVisibilidade() {
      if (document.visibilityState === "hidden") reenviarPendente();
    }
    window.addEventListener("online", reenviarPendente);
    document.addEventListener("visibilitychange", aoMudarVisibilidade);
    return () => {
      window.removeEventListener("online", reenviarPendente);
      document.removeEventListener("visibilitychange", aoMudarVisibilidade);
    };
  }, [salvarRascunho]);

  function avaliar(textoParaAvaliar: string) {
    const limpo = textoParaAvaliar.trim();
    if (!limpo) {
      setCampoVazio(true);
      return;
    }
    setCampoVazio(false);
    setFase("esperando");
    // O rascunho não é mais apagado ao avaliar (item 0 da V6): o debounce pendente pode
    // continuar e gravar a versão mais recente, sem corrida com a avaliação.
    avaliarTemaAction(limpo)
      .then((dados) => {
        avisarRedeOk();
        setTexto(limpo);
        setResultado(dados);
        setFase(dados.nota >= notaMinima ? "naMeta" : "abaixoDaMeta");
      })
      .catch((falha) => {
        // Rede caída não é "falha nossa": a frase de rede diz o que aconteceu, e o texto continua na tela.
        setFraseErro(tratarFalha(falha, textosTemaLivre.textoErro));
        setFase("erro");
      });
  }

  // No celular o teclado não pode cobrir o botão de avaliar (item 1, PROXIMO.md): quando o
  // visualViewport encolhe (o teclado abriu), rola até o botão ficar visível.
  useEffect(() => {
    if (fase !== "proposta") return;
    const vv = window.visualViewport;
    if (!vv) return;
    function aoRedimensionar() {
      botaoRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
    vv.addEventListener("resize", aoRedimensionar);
    return () => vv.removeEventListener("resize", aoRedimensionar);
  }, [fase]);

  const pilares = resultado
    ? ORDEM_PILARES.map(({ chave, indice }) => ({
        nome: textosTemaLivre.pilares[indice],
        valor: resultado.pilares[chave].nota,
        porque: resultado.pilares[chave].justificativa,
        meta: notaMinima,
      }))
    : [];
  const quantosAbaixo = pilares.filter((p) => faixaMeta(p.valor, p.meta) !== "naMeta").length;

  return (
    <div className={styles.pagina}>
      <BarraTopo
        titulo={TITULO_COMPACTO[fase]}
        esquerda={
          <button
            type="button"
            aria-label={textosTemaLivre.voltar}
            aria-busy={abrindoEste("voltar") || undefined}
            disabled={abrindo}
            className={styles.botaoBarra}
            onClick={() => abrir("voltar", "/hoje")}
          >
            <ArrowLeft size={20} strokeWidth={1.75} aria-hidden="true" />
          </button>
        }
      />

      <div className={styles.miolo}>
        <div className={styles.cabecalhoTela}>
          <h1 className={styles.titulo}>{TITULO[fase]}</h1>
          <p className={styles.subtitulo}>{SUBTITULO[fase]}</p>
        </div>

        {fase === "proposta" ? (
          <>
            <section className={[styles.cartao, styles.campo].join(" ")}>
              <AreaTexto
                rotulo={textosTemaLivre.titulo}
                rotuloOculto
                placeholder={textosTemaLivre.placeholder}
                erro={campoVazio ? textosTemaLivre.campoVazio : undefined}
                value={texto}
                onChange={(evento) => aoMudarTexto(evento.target.value)}
                caixaAlta="longa"
              />
              <div className={styles.campoRodape}>
                <span className={rascunhoComErro ? styles.rascunhoComErro : undefined} aria-live="polite">
                  {rascunhoComErro ? textosTemaLivre.rascunhoComErro : textosTemaLivre.salvaSozinho}
                </span>
                <span className={styles.contador}>{textosTemaLivre.contador(texto.length)}</span>
              </div>
              <div ref={botaoRef}>
                <Botao variante="primario" tamanho="lg" precisaDeRede onClick={() => avaliar(texto)}>
                  {textosTemaLivre.avaliar}
                </Botao>
              </div>
            </section>
            <p className={styles.notaRodape}>{textosTemaLivre.rodapeProposta}</p>
          </>
        ) : null}

        {fase !== "proposta" ? (
          <section className={[styles.cartao, styles.temaProposto].join(" ")} aria-label={textosTemaLivre.oQueEscreveu}>
            <span className={styles.rotulo}>{textosTemaLivre.oQueEscreveu}</span>
            <p className={styles.textoProposto}>{texto}</p>
            {fase !== "esperando" ? (
              <Botao
                variante="ghost"
                tamanho="md"
                disabled={abrindo}
                onClick={() => setFase("proposta")}
                className={styles.botaoEditar}
              >
                {textosTemaLivre.editarTexto}
              </Botao>
            ) : null}
          </section>
        ) : null}

        {fase === "esperando" ? (
          <EsperaEtapas
            titulo={textosTemaLivre.esperandoTopo}
            passos={textosTemaLivre.passos}
            dica={textosTemaLivre.esperandoDica}
          />
        ) : null}

        {(fase === "naMeta" || fase === "abaixoDaMeta") && resultado ? (
          <section className={styles.cartao} aria-label={TITULO_COMPACTO[fase]}>
            <div className={[styles.mediaTema, fase === "naMeta" ? styles.naMeta : ""].filter(Boolean).join(" ")}>
              <span className={styles.mediaValor}>{formatarNota(resultado.nota)}</span>
              <span className={styles.mediaFaixa}>
                {fase === "naMeta" ? textosTemaLivre.faixaNaMeta : textosTemaLivre.faixaAbaixoDaMeta}
              </span>
              <span className={styles.mediaMeta}>meta {formatarNota(notaMinima)}</span>
            </div>
            <p className={styles.mediaFrase}>
              {fase === "naMeta" ? textosTemaLivre.mediaFraseNaMeta : textosTemaLivre.mediaFrasePuxam(quantosAbaixo)}
            </p>
            <div className={styles.divisor} />
            <NotasLinha pilares={pilares} />
          </section>
        ) : null}

        {fase === "naMeta" ? (
          <div className={styles.acaoUnica}>
            <Botao
              variante="primario"
              tamanho="lg"
              precisaDeRede
              disabled={abrindo}
              onClick={() => abrir("objetivo", urlObjetivo)}
            >
              {abrindoEste("objetivo") ? textosTemaLivre.abrindo : textosTemaLivre.escreverRoteiro}
            </Botao>
            <p className={styles.notaRodape}>{textosTemaLivre.proximaTelaObjetivo}</p>
          </div>
        ) : null}

        {fase === "abaixoDaMeta" && resultado ? (
          resultado.anguloSugerido && resultado.anguloTemProva ? (
            <section
              className={[styles.cartao, styles.cartaoRecuado, styles.recomendacao].join(" ")}
              aria-label={textosTemaLivre.anguloTitulo}
            >
              <span className={styles.rotulo}>{textosTemaLivre.anguloTitulo}</span>
              <h2 className={styles.anguloNome}>{resultado.anguloSugerido}</h2>
              <div className={styles.duasAcoes}>
                <Botao
                  variante="primario"
                  tamanho="lg"
                  precisaDeRede
                  disabled={abrindo}
                  onClick={() => avaliar(resultado.anguloSugerido!)}
                >
                  {textosTemaLivre.usarAngulo}
                </Botao>
                <Botao
                  variante="secundario"
                  tamanho="lg"
                  precisaDeRede
                  disabled={abrindo}
                  onClick={() => abrir("objetivo", urlObjetivo)}
                >
                  {abrindoEste("objetivo") ? textosTemaLivre.abrindo : textosTemaLivre.seguirMeu}
                </Botao>
              </div>
            </section>
          ) : (
            <div className={styles.acaoUnica}>
              <Botao
                variante="secundario"
                tamanho="lg"
                precisaDeRede
                disabled={abrindo}
                onClick={() => abrir("objetivo", urlObjetivo)}
              >
                {abrindoEste("objetivo") ? textosTemaLivre.abrindo : textosTemaLivre.seguirMeu}
              </Botao>
            </div>
          )
        ) : null}

        {fase === "erro" ? (
          <div className={[styles.cartao, styles.blocoErro].join(" ")}>
            <span className={styles.avisoErro}>
              <CircleAlert size={18} strokeWidth={1.75} aria-hidden="true" />
              {textosTemaLivre.avisoErro}
            </span>
            <h2 className={styles.erroTitulo}>{textosTemaLivre.tituloErro}</h2>
            <p>{fraseErro}</p>
            <div className={styles.duasAcoes}>
              <Botao
                variante="primario"
                tamanho="lg"
                precisaDeRede
                disabled={abrindo}
                onClick={() => avaliar(texto)}
              >
                {textosComuns.tentarDeNovo}
              </Botao>
              <Botao
                variante="secundario"
                tamanho="lg"
                disabled={abrindo}
                onClick={() => abrir("hoje", "/hoje")}
              >
                {abrindoEste("hoje") ? textosTemaLivre.abrindo : textosTemaLivre.escolherTemaDoDia}
              </Botao>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
