"use client";

import { Search, TrendingUp, X } from "lucide-react";
import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { grupoDoAssunto } from "@/config/assuntos-do-catalogo";
import { buscarAssuntos } from "@/lib/buscar-assunto";
import { normalizarBusca } from "@/lib/buscar-ramo";
import { textosNoticias } from "@/textos/noticias";
import { Botao } from "@/ui/componentes/Botao";
import campo from "@/ui/componentes/Campo.module.css";

import styles from "./CampoDeAssunto.module.css";

/** Um assunto em alta no Brasil agora, com as palavras que a coleta já guardou (`assuntosEmAltaParaAcompanhar`). */
export type AssuntoEmAltaNaFolha = { chave: string; assunto: string; palavras: string[] };

export type AssuntoEscolhido = { nome: string; palavras: string[]; origem: "lista" | "alta" };

type Opcao = { id: string; nome: string; palavras: string[]; origem: "lista" | "alta"; grupo: string };

type Props = {
  /** O que está escrito no campo (o dono é a folha, que também guarda as palavras). */
  texto: string;
  aoMudarTexto: (texto: string) => void;
  aoEscolher: (assunto: AssuntoEscolhido) => void;
  emAlta: AssuntoEmAltaNaFolha[];
  maxLength: number;
  desabilitado: boolean;
  /** O botão "Sugerir palavras": só aparece quando o assunto é um texto livre que a lista não tem. */
  mostrarSugerir: boolean;
  sugerindo: boolean;
  aoSugerir: () => void;
};

/** Quantas palavras prontas a linha mostra (as outras aparecem depois de escolhido, no campo das palavras). */
const PALAVRAS_NA_LINHA = 4;

/**
 * O campo "Assunto" da folha dos assuntos, que sugere enquanto a pessoa digita (melhoria da E53, pedido do Gustavo em 23/10/2026, com o modelo da busca de ramo, `BuscaDeRamo`). Um combobox
 * editável com lista embaixo: o foco fica sempre no campo, a opção destacada é anunciada por `aria-activedescendant`, e o Enter escolhe a destacada (ao digitar, a primeira).
 *
 * Campo vazio e em foco: o que está em alta no Brasil agora. Digitando: o que está em alta e combina, depois os assuntos da nossa lista (`buscarAssuntos`). Escolher preenche o nome e as palavras
 * de busca; a pessoa ainda edita tudo. Assunto que a lista não tem: o botão "Sugerir palavras" (o modelo barato propõe, a pessoa aceita ou edita).
 */
export function CampoDeAssunto({ texto, aoMudarTexto, aoEscolher, emAlta, maxLength, desabilitado, mostrarSugerir, sugerindo, aoSugerir }: Props) {
  const id = useId();
  const idLista = `${id}-lista`;
  const idAjuda = `${id}-ajuda`;
  const [aberto, setAberto] = useState(false);
  const [ativo, setAtivo] = useState(-1);
  const [anuncio, setAnuncio] = useState("");
  const grupoRef = useRef<HTMLDivElement | null>(null);
  const entradaRef = useRef<HTMLInputElement | null>(null);

  const consulta = normalizarBusca(texto);
  const digitando = consulta !== "";

  const { opcoes, doTexto } = useMemo(() => {
    const palavrasDigitadas = consulta === "" ? [] : consulta.split(" ");
    const altas = emAlta
      .filter((a) => {
        if (palavrasDigitadas.length === 0) return true;
        const palavrasDoAssunto = normalizarBusca(a.assunto).split(" ");
        return palavrasDigitadas.every((digitada) => palavrasDoAssunto.some((palavra) => palavra.startsWith(digitada)));
      })
      .map((a): Opcao => ({ id: `${id}-alta-${a.chave}`, nome: a.assunto, palavras: a.palavras, origem: "alta", grupo: textosNoticias.grupoEmAlta }));
    const nomesEmAlta = new Set(altas.map((o) => normalizarBusca(o.nome)));
    const lista = buscarAssuntos(texto)
      .filter((a) => !nomesEmAlta.has(normalizarBusca(a.nome)))
      .map((a): Opcao => ({ id: `${id}-lista-${a.slug}`, nome: a.nome, palavras: [...a.palavras], origem: "lista", grupo: grupoDoAssunto(a).nome }));
    return { opcoes: [...altas, ...lista], doTexto: palavrasDigitadas.length > 0 };
  }, [texto, consulta, emAlta, id]);

  const mostrarLista = aberto && !desabilitado && (opcoes.length > 0 || doTexto);
  // Quem digitou e ainda não mexeu nas setas tem o primeiro resultado destacado (é o que o Enter escolhe); quem só abriu a lista, nenhum.
  const indiceAtivo = opcoes.length === 0 ? -1 : ativo >= 0 ? Math.min(ativo, opcoes.length - 1) : doTexto ? 0 : -1;
  const idAtivo = mostrarLista && indiceAtivo >= 0 ? opcoes[indiceAtivo].id : undefined;

  function escolher(opcao: Opcao) {
    setAberto(false);
    setAtivo(-1);
    setAnuncio(textosNoticias.assuntoEscolhido(opcao.nome, opcao.palavras.length));
    aoEscolher({ nome: opcao.nome, palavras: opcao.palavras, origem: opcao.origem });
  }

  /** Pedir as palavras fecha a lista (a frase "não achamos" já foi lida) e deixa o foco onde a pessoa estava. */
  function sugerir() {
    setAberto(false);
    setAtivo(-1);
    aoSugerir();
  }

  function aoTeclar(evento: KeyboardEvent<HTMLInputElement>) {
    switch (evento.key) {
      case "ArrowDown":
        evento.preventDefault();
        if (!aberto) setAberto(true);
        else if (opcoes.length > 0) setAtivo(indiceAtivo < 0 ? 0 : (indiceAtivo + 1) % opcoes.length);
        break;
      case "ArrowUp":
        evento.preventDefault();
        if (!aberto) setAberto(true);
        else if (opcoes.length > 0) setAtivo(indiceAtivo < 0 ? opcoes.length - 1 : (indiceAtivo - 1 + opcoes.length) % opcoes.length);
        break;
      case "Enter":
        // Lista fechada, ou aberta sem nada destacado: o Enter é do formulário. Aberta e destacada: ele escolhe, e nunca envia.
        if (!mostrarLista || indiceAtivo < 0) return;
        evento.preventDefault();
        escolher(opcoes[indiceAtivo]);
        break;
      case "Escape":
        if (aberto) {
          // Só fecha a lista: o Esc não pode fechar também a folha em que o campo está.
          evento.preventDefault();
          evento.stopPropagation();
          setAberto(false);
          setAtivo(-1);
        }
        break;
    }
  }

  const fala = mostrarLista && doTexto ? (opcoes.length === 0 ? textosNoticias.nenhumAssunto(texto.trim()) : textosNoticias.resultadosAssunto(opcoes.length)) : anuncio;
  let ultimoGrupo = "";

  return (
    <div className={campo.grupo} ref={grupoRef}>
      <label className={campo.rotulo} htmlFor={id}>
        {textosNoticias.campoAssunto}
      </label>
      <span className={campo.ajuda} id={idAjuda}>
        {textosNoticias.ajudaAssuntoVazio}
      </span>
      <div className={styles.caixa}>
        <Search className={styles.lupa} size={18} strokeWidth={1.5} aria-hidden="true" />
        <input
          id={id}
          ref={entradaRef}
          type="text"
          role="combobox"
          aria-expanded={mostrarLista && opcoes.length > 0}
          aria-controls={idLista}
          aria-autocomplete="list"
          aria-activedescendant={idAtivo}
          aria-describedby={idAjuda}
          className={[campo.entrada, styles.entrada].join(" ")}
          value={texto}
          maxLength={maxLength}
          disabled={desabilitado}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onFocus={() => {
            setAberto(true);
            setAtivo(-1);
          }}
          onClick={() => setAberto(true)}
          onBlur={(evento) => {
            // O foco indo para o "Sugerir palavras" ou para o apagar não fecha: senão o Tab nunca chegaria neles.
            if (evento.relatedTarget instanceof Node && grupoRef.current?.contains(evento.relatedTarget)) return;
            setAberto(false);
            setAtivo(-1);
          }}
          onChange={(evento) => {
            aoMudarTexto(evento.target.value);
            setAberto(true);
            // Digitar leva o destaque de volta ao primeiro resultado, mesmo depois de usar as setas.
            setAtivo(-1);
            setAnuncio("");
          }}
          onKeyDown={aoTeclar}
        />
        {digitando && !desabilitado ? (
          <button
            type="button"
            className={styles.limpar}
            aria-label={textosNoticias.limparAssunto}
            onMouseDown={(evento) => evento.preventDefault()}
            onClick={() => {
              aoMudarTexto("");
              setAtivo(-1);
              setAberto(true);
              entradaRef.current?.focus();
            }}
          >
            <X size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      {mostrarLista ? (
        // Clicar na barra de rolagem ou no título de um grupo não pode tirar o foco do campo (fecharia a lista).
        <div className={styles.lista} onMouseDown={(evento) => evento.preventDefault()} data-sugestoes-de-assunto>
          {opcoes.length === 0 ? <p className={styles.semResultado}>{textosNoticias.nenhumAssunto(texto.trim())}</p> : null}
          {opcoes.length > 0 ? (
            <div id={idLista} role="listbox" aria-label={textosNoticias.sugestoesAria} className={styles.opcoes}>
              {opcoes.map((opcao, indice) => {
                const novoGrupo = opcao.grupo !== ultimoGrupo;
                ultimoGrupo = opcao.grupo;
                return (
                  <div key={opcao.id} role="presentation" className={styles.linha}>
                    {novoGrupo ? (
                      <div className={styles.cabecalhoDoGrupo} aria-hidden="true">
                        {opcao.grupo}
                      </div>
                    ) : null}
                    <div
                      id={opcao.id}
                      role="option"
                      aria-selected={indice === indiceAtivo}
                      className={[styles.opcao, indice === indiceAtivo ? styles.opcaoAtiva : ""].filter(Boolean).join(" ")}
                      // O mousedown no campo tiraria o foco dele antes do clique chegar: o foco fica no campo.
                      onMouseDown={(evento) => evento.preventDefault()}
                      onMouseMove={() => {
                        if (ativo !== indice) setAtivo(indice);
                      }}
                      onClick={() => escolher(opcao)}
                    >
                      <span className={styles.nome}>
                        {opcao.origem === "alta" ? <TrendingUp className={styles.alta} size={14} strokeWidth={2} aria-hidden="true" /> : null}
                        {opcao.nome}
                      </span>
                      <span className={styles.palavras}>
                        {opcao.palavras.slice(0, PALAVRAS_NA_LINHA).join(", ")}
                        {opcao.palavras.length > PALAVRAS_NA_LINHA ? "..." : ""}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}

      {mostrarSugerir ? (
        <div className={styles.sugerir} onMouseDown={(evento) => evento.preventDefault()}>
          <span>{textosNoticias.sugerirAjuda}</span>
          <Botao type="button" variante="secundario" tamanho="md" carregando={sugerindo} disabled={sugerindo || desabilitado} onClick={sugerir}>
            {textosNoticias.sugerirPalavras}
          </Botao>
        </div>
      ) : null}

      <span className="so-leitor" aria-live="polite" aria-atomic="true" data-fala-do-assunto>
        {fala}
      </span>
    </div>
  );
}
