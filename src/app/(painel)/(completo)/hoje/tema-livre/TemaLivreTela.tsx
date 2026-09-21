"use client";

import { ArrowLeft, CircleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { ResultadoAvaliarTema } from "@/servicos/temas";
import { textosComuns } from "@/textos/comuns";
import { textosTemaLivre } from "@/textos/tema-livre";
import { AreaTexto } from "@/ui/componentes/AreaTexto";
import { BarraTopo } from "@/ui/componentes/BarraTopo";
import { Botao } from "@/ui/componentes/Botao";
import { EsperaEtapas } from "@/ui/componentes/EsperaEtapas";
import { faixaMeta } from "@/ui/componentes/notaFaixaMeta";
import { NotasLinha } from "@/ui/componentes/NotaLinha";

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
  const timerRascunhoRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const botaoRef = useRef<HTMLDivElement>(null);

  function aoMudarTexto(valor: string) {
    setTexto(valor);
    setCampoVazio(false);
    if (timerRascunhoRef.current) clearTimeout(timerRascunhoRef.current);
    timerRascunhoRef.current = setTimeout(() => {
      // Salva sozinho, sem bloquear a digitação; falhou, tenta de novo na próxima tecla, sem aviso (PROXIMO.md, item 2).
      salvarRascunhoAction(valor).catch(() => {});
    }, 800);
  }

  function avaliar(textoParaAvaliar: string) {
    const limpo = textoParaAvaliar.trim();
    if (!limpo) {
      setCampoVazio(true);
      return;
    }
    setCampoVazio(false);
    setFase("esperando");
    // Cancela o salvamento de rascunho pendente: sem isto, um debounce em voo podia gravar de
    // novo o rascunho logo depois da avaliação já ter apagado ele (achado testando esta etapa).
    if (timerRascunhoRef.current) clearTimeout(timerRascunhoRef.current);
    avaliarTemaAction(limpo)
      .then((dados) => {
        setTexto(limpo);
        setResultado(dados);
        setFase(dados.nota >= notaMinima ? "naMeta" : "abaixoDaMeta");
      })
      .catch(() => setFase("erro"));
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
            className={styles.botaoBarra}
            onClick={() => router.push("/hoje")}
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
                <span>{textosTemaLivre.salvaSozinho}</span>
                <span className={styles.contador}>{textosTemaLivre.contador(texto.length)}</span>
              </div>
              <div ref={botaoRef}>
                <Botao variante="primario" tamanho="lg" onClick={() => avaliar(texto)}>
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
              <Botao variante="ghost" tamanho="md" onClick={() => setFase("proposta")} className={styles.botaoEditar}>
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
            <Botao variante="primario" tamanho="lg" onClick={() => router.push(`/hoje/objetivo?livre=${encodeURIComponent(texto)}`)}>
              {textosTemaLivre.escreverRoteiro}
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
                <Botao variante="primario" tamanho="lg" onClick={() => avaliar(resultado.anguloSugerido!)}>
                  {textosTemaLivre.usarAngulo}
                </Botao>
                <Botao
                  variante="secundario"
                  tamanho="lg"
                  onClick={() => router.push(`/hoje/objetivo?livre=${encodeURIComponent(texto)}`)}
                >
                  {textosTemaLivre.seguirMeu}
                </Botao>
              </div>
            </section>
          ) : (
            <div className={styles.acaoUnica}>
              <Botao
                variante="secundario"
                tamanho="lg"
                onClick={() => router.push(`/hoje/objetivo?livre=${encodeURIComponent(texto)}`)}
              >
                {textosTemaLivre.seguirMeu}
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
            <p>{textosTemaLivre.textoErro}</p>
            <div className={styles.duasAcoes}>
              <Botao variante="primario" tamanho="lg" onClick={() => avaliar(texto)}>
                {textosComuns.tentarDeNovo}
              </Botao>
              <Botao variante="secundario" tamanho="lg" onClick={() => router.push("/hoje")}>
                {textosTemaLivre.escolherTemaDoDia}
              </Botao>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
