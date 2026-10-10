"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { ChaveDaNota, VersaoParaTela } from "@/servicos/versoes";
import { textosBriefing } from "@/textos/briefing";
import { textosVersoes } from "@/textos/versoes";
import { Botao } from "@/ui/componentes/Botao";
import { ClaqueteAnimada } from "@/ui/componentes/ClaqueteAnimada";
import { faixaMeta } from "@/ui/componentes/notaFaixaMeta";
import { NotaLinha } from "@/ui/componentes/NotaLinha";
import { useTratarFalha } from "@/ui/ConexaoContext";

import { ficarComVersaoAction, gerarOutraVersaoAction } from "./acoes";
import styles from "./VersoesTela.module.css";

type Props = {
  grupo: string;
  tema: string;
  /** "Reels, para o Instagram, o TikTok e o Shorts" e o resto: o formato que a pessoa escolheu. */
  formato: string;
  /** "Para que te chamem": o que ela pediu para o vídeo (ou "Com quem já segue", no Story). */
  paraQue: string;
  /** Qual das três notas é a do objetivo (a que ordena a lista). */
  chaveDaNota: ChaveDaNota;
  /** O Story e o vídeo sem fala não perguntam o objetivo: a frase da ordem não diz "que você escolheu" e não há "Trocar o objetivo". */
  escolheuOObjetivo: boolean;
  trocarObjetivoHref: string | null;
  /** Já na ordem da nota do objetivo. */
  versoes: VersaoParaTela[];
  /** A nota de tema que conta como "na meta". */
  meta: number;
};

function comInicialMaiuscula(texto: string): string {
  return texto.length > 0 ? texto.charAt(0).toUpperCase() + texto.slice(1) : texto;
}

function formatarNota(valor: number): string {
  return valor.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

const CHAVES_DAS_NOTAS: ChaveDaNota[] = ["viralizar", "chamarem", "lembrarem"];

/**
 * `/criar/versoes/[grupo]` (E26 4b, parte 2; `Objetivo.dc.html`, estados `comparar`, `gerandoOutra` e `quatroVersoes`): o roteiro inteiro de cada versão, com a nota do objetivo em destaque e as
 * outras duas pequenas. "Ficar com esta" cria o roteiro e abre nele; "Gerar outra" escreve mais uma, uma por vez, e ela entra no fim, marcada "Nova" (a ordem pela nota não se refaz na frente
 * da pessoa: a lista não pula; refaz quando ela volta à tela).
 *
 * Enquanto uma versão está sendo escrita, "Ficar com esta" espera: as Server Actions do Next andam uma de cada vez, e um toque nele ficaria parado até a escrita terminar, sem a pessoa saber por quê.
 */
export function VersoesTela({ grupo, tema, formato, paraQue, chaveDaNota, escolheuOObjetivo, trocarObjetivoHref, versoes, meta }: Props) {
  const router = useRouter();
  const tratarFalha = useTratarFalha();
  const [lista, setLista] = useState(versoes);
  // O que veio do servidor vale mais que o que a tela montou sozinha (depois de "Ver se ficou pronta", `router.refresh()` traz a lista de verdade).
  useEffect(() => setLista(versoes), [versoes]);
  const [novaId, setNovaId] = useState<number | null>(null);
  // No celular, uma aberta por vez: a de nota mais alta, e depois de "Gerar outra" a nova.
  const [abertaId, setAbertaId] = useState<number | null>(versoes[0]?.id ?? null);
  const [escrevendo, setEscrevendo] = useState(false);
  const [escolhendoId, setEscolhendoId] = useState<number | null>(null);
  /** O erro de "Gerar outra", no fim da lista (onde está o botão). */
  const [erro, setErro] = useState<string | null>(null);
  /** A conexão caiu no meio de "Gerar outra": a versão pode ter ficado pronta no servidor, e a pessoa pode pedir a lista de verdade. */
  const [podeTerFicadoPronta, setPodeTerFicadoPronta] = useState(false);
  /** O erro de "Ficar com esta", dentro da folha em que a pessoa tocou (é lá que ela está olhando). */
  const [erroDaFolha, setErroDaFolha] = useState<{ versaoId: number; frase: string } | null>(null);
  /** O que o leitor de tela anuncia quando a versão nova fica pronta. */
  const [aviso, setAviso] = useState("");
  const [folhaAgora, setFolhaAgora] = useState(0);
  const trilhoRef = useRef<HTMLDivElement>(null);

  const maisAltaId = versoes[0]?.notas ? versoes[0].id : null;
  const total = lista.length;
  const ocupada = escrevendo || escolhendoId !== null;

  // Com a versão nova (escrevendo ou pronta), o trilho aparece rolado até ela.
  useEffect(() => {
    const trilho = trilhoRef.current;
    if (!trilho || (!escrevendo && novaId === null)) return;
    trilho.scrollTo?.({ left: trilho.scrollWidth, behavior: "smooth" });
  }, [escrevendo, novaId]);

  // A versão nova fica à vista e com o foco (na lista do celular ela está abaixo das outras, e a pessoa estava no botão lá embaixo).
  useEffect(() => {
    if (novaId === null) return;
    const folha = trilhoRef.current?.querySelector<HTMLElement>(`[data-versao="${novaId}"]`);
    folha?.scrollIntoView?.({ block: "nearest", inline: "nearest", behavior: "smooth" });
    folha?.focus({ preventScroll: true });
  }, [novaId]);

  function aoRolar() {
    const trilho = trilhoRef.current;
    const primeira = trilho?.firstElementChild as HTMLElement | null;
    if (!trilho || !primeira) return;
    const passo = primeira.offsetWidth + 12;
    setFolhaAgora(Math.min(Math.max(Math.round(trilho.scrollLeft / Math.max(passo, 1)), 0), total + (escrevendo ? 0 : -1)));
  }

  async function gerarOutra() {
    if (ocupada) return;
    setErro(null);
    setPodeTerFicadoPronta(false);
    setErroDaFolha(null);
    setEscrevendo(true);
    try {
      const resultado = await gerarOutraVersaoAction(grupo);
      if (!resultado.ok) {
        setErro(resultado.erro);
        return;
      }
      const nova = resultado.dado.versao;
      setLista((atual) => (atual.some((v) => v.id === nova.id) ? atual : [...atual, nova]));
      setNovaId(nova.id);
      setAbertaId(nova.id);
      setAviso(textosVersoes.novaPronta(lista.length + 1));
    } catch (falha) {
      setErro(tratarFalha(falha, textosVersoes.erroGerarOutra, textosVersoes.erroGerarOutraRede));
      // Uma resposta que se perde não perde a versão: o servidor continua escrevendo. Atualizar a tela é uma escolha da pessoa (e só com rede: sem ela, o refresh derruba o app).
      setPodeTerFicadoPronta(true);
    } finally {
      setEscrevendo(false);
    }
  }

  async function ficarCom(versaoId: number) {
    if (ocupada) return;
    setErro(null);
    setErroDaFolha(null);
    setEscolhendoId(versaoId);
    try {
      const resultado = await ficarComVersaoAction(versaoId);
      if (!resultado.ok) {
        setErroDaFolha({ versaoId, frase: resultado.erro });
        setEscolhendoId(null);
        return;
      }
      router.push(`/roteiros/${resultado.dado.id}`);
    } catch (falha) {
      setErroDaFolha({ versaoId, frase: tratarFalha(falha, textosVersoes.erroFicarComEsta) });
      setEscolhendoId(null);
    }
  }

  const nomeDaNota = textosVersoes.nota[chaveDaNota];
  const maisDeTres = total > 3 || (escrevendo && total >= 3);
  const numeroDaEscrita = total + 1;

  return (
    <div className={styles.pagina}>
      <h1 className={styles.titulo}>{textosVersoes.titulo}</h1>

      <section className={styles.tema} aria-label={textosVersoes.temaEscolhido}>
        <span className={styles.rotulo}>{textosVersoes.temaEscolhido}</span>
        <p className={styles.temaTitulo}>{tema}</p>
        <p className={styles.formato}>{formato}</p>
        <p className={styles.paraQue}>{paraQue}</p>
      </section>

      <div className={styles.resumoOrdem}>
        <p>{escolheuOObjetivo ? textosVersoes.ordenadasPela(nomeDaNota) : textosVersoes.ordenadasPelaPadrao(nomeDaNota)}</p>
        {trocarObjetivoHref ? (
          <Link className={styles.link} href={trocarObjetivoHref}>
            {textosVersoes.trocarObjetivo}
          </Link>
        ) : null}
      </div>

      <div
        ref={trilhoRef}
        onScroll={aoRolar}
        className={[styles.trilho, maisDeTres ? styles.trilhoMaisDeTres : ""].filter(Boolean).join(" ")}
        role="group"
        aria-label={textosVersoes.versoes(total)}
      >
        {lista.map((versao, indice) => {
          const aberta = abertaId === versao.id;
          const escolhendo = escolhendoId === versao.id;
          const ehNova = novaId === versao.id;
          const idRoteiro = `roteiro-versao-${versao.id}`;
          const notas = versao.notas;
          const principal = versao.id === maisAltaId || (maisAltaId === null && indice === 0);
          const posicao = textosVersoes.versaoDe(indice + 1, total);
          return (
            <article
              key={versao.id}
              className={[styles.folha, aberta ? styles.aberta : "", escolhendo ? styles.escolhida : ""].filter(Boolean).join(" ")}
              aria-label={`${posicao}: ${versao.nome}`}
              data-versao={versao.id}
              tabIndex={-1}
            >
              <div className={styles.cabeca}>
                <span className={styles.rotulo}>{posicao}</span>
                {versao.id === maisAltaId ? <span className={styles.selo}>{textosVersoes.notaMaisAlta}</span> : null}
                {ehNova ? <span className={styles.selo}>{textosVersoes.nova}</span> : null}
                {versao.roteiroId !== null ? <span className={styles.selo}>{textosVersoes.escolhida}</span> : null}
              </div>
              <h3>{versao.nome}</h3>

              {notas ? (
                <>
                  <div className={styles.destaque}>
                    {escolheuOObjetivo ? <span className={styles.marcaEscolha}>{textosVersoes.escolhaDoObjetivo}</span> : null}
                    <NotaLinha
                      nome={nomeDaNota}
                      valor={notas[chaveDaNota]}
                      meta={meta}
                      porque={[textosBriefing.faixaMeta[faixaMeta(notas[chaveDaNota], meta)], comInicialMaiuscula(notas.fraseDoObjetivo.trim())]
                        .filter(Boolean)
                        .join(". ")
                        .replace(/\.{2,}/g, ".")}
                    />
                  </div>
                  <p className={styles.notasLeves}>
                    {CHAVES_DAS_NOTAS.filter((chave) => chave !== chaveDaNota).map((chave) => (
                      <span key={chave}>
                        {textosVersoes.notaCurta[chave]} <b>{formatarNota(notas[chave])}</b>
                      </span>
                    ))}
                  </p>
                </>
              ) : (
                <p className={styles.semNota}>{versao.notaEmAndamento ? textosVersoes.notaEmAndamento : textosVersoes.semNota}</p>
              )}

              <button
                type="button"
                className={styles.lerVersao}
                aria-expanded={aberta}
                aria-controls={idRoteiro}
                onClick={() => setAbertaId(aberta ? null : versao.id)}
              >
                {aberta ? textosVersoes.recolher : textosVersoes.lerInteira}
              </button>

              <ol id={idRoteiro} className={styles.roteiro} aria-label={textosVersoes.roteiroDaVersao}>
                {versao.blocos.map((bloco, i) => (
                  <li key={`${bloco.rotulo}-${i}`}>
                    {bloco.tempo ? <span className={styles.tempo}>{bloco.tempo}</span> : <span className={styles.nomeDoBloco}>{bloco.rotulo}</span>}
                    {bloco.linhas.map((linha, j) => (
                      <p key={j}>{linha}</p>
                    ))}
                  </li>
                ))}
              </ol>

              {notas?.jeitoDiferente.trim() ? (
                <p className={styles.angulo}>
                  <strong>{textosVersoes.jeitoDaVersao}</strong> {notas.jeitoDiferente.trim()}
                </p>
              ) : null}

              <div className={styles.acao}>
                {versao.roteiroId !== null ? (
                  <Link className={styles.link} href={`/roteiros/${versao.roteiroId}`}>
                    {textosVersoes.abrirRoteiro}
                  </Link>
                ) : (
                  <>
                    <Botao
                      variante={principal ? "primario" : "secundario"}
                      onClick={() => void ficarCom(versao.id)}
                      disabled={ocupada}
                      carregando={escolhendo}
                      precisaDeRede
                      aria-label={`${textosVersoes.ficarComEsta}: ${versao.nome}`}
                    >
                      {textosVersoes.ficarComEsta}
                    </Botao>
                    {escolhendo ? (
                      <p className={styles.abrindo} role="status">
                        {textosVersoes.abrindo}
                      </p>
                    ) : null}
                    {erroDaFolha?.versaoId === versao.id ? (
                      <p className={styles.erro} role="alert">
                        {erroDaFolha.frase}
                      </p>
                    ) : null}
                  </>
                )}
              </div>
            </article>
          );
        })}

        {escrevendo ? (
          <article className={[styles.folha, styles.escrevendo].join(" ")} aria-label={textosVersoes.escrevendoAVersao(numeroDaEscrita)} aria-busy="true">
            <div className={styles.cabeca}>
              <span className={styles.rotulo}>{textosVersoes.versaoNumero(numeroDaEscrita)}</span>
            </div>
            <ClaqueteAnimada altura={56} />
            <h3>{textosVersoes.escrevendoTitulo}</h3>
            <p>{textosVersoes.escrevendoTexto(total)}</p>
            <span className={styles.esqueleto} />
            <span className={styles.esqueleto} style={{ width: "80%" }} />
            <span className={styles.esqueleto} style={{ width: "90%" }} />
          </article>
        ) : null}
      </div>

      <p className={[styles.pontos, total + (escrevendo ? 1 : 0) <= 3 ? styles.pontosSoAteTres : ""].filter(Boolean).join(" ")} aria-hidden="true">
        {Array.from({ length: total + (escrevendo ? 1 : 0) }, (_, i) => (
          <i key={i} className={i === (escrevendo ? total : folhaAgora) ? styles.agora : undefined} />
        ))}
        <span className={styles.qual}>
          {escrevendo ? textosVersoes.pontosEscrevendo(numeroDaEscrita) : textosVersoes.pontos(Math.min(folhaAgora + 1, total), total)}
        </span>
      </p>

      <div className={styles.maisVersoes}>
        <h2>{textosVersoes.nenhumaServe}</h2>
        <p>{textosVersoes.nenhumaServeTexto}</p>
        {erro ? (
          <p className={styles.erro} role="alert">
            {erro}
          </p>
        ) : null}
        <div className={styles.acoesDoFim}>
          <Botao variante="secundario" onClick={() => void gerarOutra()} disabled={ocupada} carregando={escrevendo} precisaDeRede>
            {escrevendo ? textosVersoes.escrevendoAVersao(numeroDaEscrita) : textosVersoes.gerarOutra}
          </Botao>
          {podeTerFicadoPronta ? (
            <Botao variante="ghost" onClick={() => router.refresh()} precisaDeRede>
              {textosVersoes.verSeFicouPronta}
            </Botao>
          ) : null}
        </div>
      </div>

      {/* O que o leitor de tela precisa saber quando a versão nova chega (a lista cresce fora de onde ele está). */}
      <p className={styles.somenteLeitor} role="status" aria-live="polite">
        {aviso}
      </p>
    </div>
  );
}
