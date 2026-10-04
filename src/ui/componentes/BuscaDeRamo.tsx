"use client";

import { Check, Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type Ref } from "react";

import { ramoPorSlug } from "@/config/ramos";
import { buscarRamos, normalizarBusca, ramosEmOrdemDeTela } from "@/lib/buscar-ramo";
import { textosRamo } from "@/textos/ramo";
import { useFolhaNoHistorico } from "@/ui/useFolhaNoHistorico";

import styles from "./BuscaDeRamo.module.css";
import campo from "./Campo.module.css";
import { FolhaDosRamos } from "./FolhaDosRamos";

type Props = {
  rotulo: string;
  ajuda?: string;
  erro?: string;
  /** O ramo escolhido no catálogo (o `slug`), ou nulo. */
  valor: string | null;
  /**
   * O que mostrar no campo quando não há ramo do catálogo escolhido: o setor que a marca já tem e que o admin criou à mão, ou o
   * "Não achei o meu". Continua lá até a pessoa escolher outro ramo.
   */
  nomeForaDoCatalogo?: string | null;
  /**
   * "Não achei o meu": o rótulo da última linha da lista (o mesmo que o campo mostra depois de escolhida). Sem ele (e sem `onNaoAchei`),
   * a lista não oferece a saída: é o caso da Conta, onde o pedido de um ramo que não existe chega com o PR 2 da E45.
   */
  textoNaoAchei?: string;
  onEscolher: (slug: string) => void;
  /** Ramos que não aparecem na lista (E45 PR 3, no admin: o ramo principal da marca e os que já estão ligados não são opção). */
  ramosEscondidos?: readonly string[];
  /** "Não achei o meu": recebe o que a pessoa tinha digitado. */
  onNaoAchei?: (texto: string) => void;
  /** Para levar o foco ao campo quando ele está errado. */
  ref?: Ref<HTMLInputElement>;
};

/**
 * A busca instantânea de ramo (E45, PR 1; exigência do Gustavo: "digita uma palavra ou uma letra e já vai aparecendo, como uma
 * pesquisa do Google"). Um combobox editável com lista (o padrão de teclado e de leitor de tela do WAI-ARIA): o foco fica sempre no
 * campo, a opção destacada é anunciada por `aria-activedescendant`, e o Enter escolhe a destacada, que ao digitar é a primeira.
 *
 * Quem digita vê os ramos agrupados (`buscarRamos`: começo de palavra, sem acento e sem maiúscula, no nome, nos exemplos e nas
 * palavras que levam ao ramo). Sem resultado, ou a qualquer hora que haja texto, a última linha é o "Não achei o meu".
 * O Enter nunca envia o formulário com a lista aberta: ele escolhe.
 */
export function BuscaDeRamo({ rotulo, ajuda, erro, valor, nomeForaDoCatalogo, textoNaoAchei, onEscolher, ramosEscondidos, onNaoAchei, ref }: Props) {
  const id = useId();
  const idLista = `${id}-lista`;
  const idAjuda = ajuda ? `${id}-ajuda` : undefined;
  const idErro = erro ? `${id}-erro` : undefined;
  const idNaoAchei = `${id}-nao-achei`;

  const nomeAtual = ramoPorSlug(valor)?.nome ?? nomeForaDoCatalogo ?? "";
  const [texto, setTexto] = useState(nomeAtual);
  const [aberto, setAberto] = useState(false);
  /** A pessoa mexeu no texto: só então a lista é a busca; antes disso mostra o catálogo inteiro. */
  const [digitou, setDigitou] = useState(false);
  /** A opção destacada pelo teclado ou pelo mouse; -1 é nenhuma (com a lista aberta e nada digitado, o Enter não escolhe um ramo que ninguém olhou). */
  const [ativo, setAtivo] = useState(-1);
  const [anuncio, setAnuncio] = useState("");
  /** A folha "Os ramos" (passo 16): os 44 ramos de uma vez, que o campo vazio não abre mais dentro do cartão. */
  const [folhaAberta, setFolhaAberta] = useState(false);
  /** Cada abertura da folha é uma folha nova (a busca do alto começa vazia). */
  const [aberturas, setAberturas] = useState(0);
  /** A folha, ao fechar, devolve o foco ao campo: esse foco não é a pessoa tocando nele e não deve reabrir a lista do campo. */
  const ignorarFoco = useRef(false);
  const { fechar: fecharFolha, fecharEDepois } = useFolhaNoHistorico(folhaAberta, () => {
    ignorarFoco.current = true;
    setTimeout(() => {
      ignorarFoco.current = false;
    }, 600);
    setFolhaAberta(false);
  });
  const entradaRef = useRef<HTMLInputElement | null>(null);
  const trocarRef = useRef<HTMLButtonElement | null>(null);
  /** Escolheu pela folha: o botão que a abriu desmontou, e o foco vai ao "Trocar" (não ao campo: no Android o foco no campo abre o teclado por cima). */
  const focarTrocar = useRef(false);
  useEffect(() => {
    if (focarTrocar.current && trocarRef.current) {
      focarTrocar.current = false;
      trocarRef.current.focus({ preventScroll: true });
    }
  });
  const grupoRef = useRef<HTMLDivElement | null>(null);

  function abrirFolha() {
    setAberturas((n) => n + 1);
    setFolhaAberta(true);
  }

  // O que está escolhido mudou por fora (a tela trocou o ramo): o campo passa a mostrar o novo.
  const [nomeAnterior, setNomeAnterior] = useState(nomeAtual);
  if (nomeAnterior !== nomeAtual) {
    setNomeAnterior(nomeAtual);
    setTexto(nomeAtual);
    setDigitou(false);
  }

  /** Há o que procurar: texto com pelo menos uma letra ou número (só pontuação ou espaço mostra o catálogo inteiro, sem destacar nada). */
  const buscando = digitou && normalizarBusca(texto) !== "";
  const consulta = buscando ? texto : "";
  const escondidos = (ramosEscondidos ?? []).join("|");
  const grupos = useMemo(() => {
    const fora = new Set(escondidos ? escondidos.split("|") : []);
    const todos = buscarRamos(consulta);
    return fora.size === 0 ? todos : todos.map((g) => ({ ...g, ramos: g.ramos.filter((r) => !fora.has(r.slug)) })).filter((g) => g.ramos.length > 0);
  }, [consulta, escondidos]);
  const ramos = ramosEmOrdemDeTela(grupos);
  const mostrarNaoAchei = buscando && Boolean(textoNaoAchei && onNaoAchei);
  const total = ramos.length + (mostrarNaoAchei ? 1 : 0);
  // Quem digitou e ainda não mexeu nas setas tem o primeiro resultado destacado (é o que o Enter escolhe); quem só abriu a lista, nenhum.
  const indiceAtivo = total === 0 ? -1 : ativo >= 0 ? Math.min(ativo, total - 1) : buscando ? 0 : -1;
  const indiceDe = new Map(ramos.map((ramo, indice) => [ramo.slug, indice]));

  const idDaOpcao = (slug: string) => `${id}-op-${slug}`;
  const idAtivo =
    aberto && buscando && indiceAtivo >= 0 ? (indiceAtivo < ramos.length ? idDaOpcao(ramos[indiceAtivo].slug) : idNaoAchei) : undefined;

  // A opção destacada pelo teclado precisa estar à vista dentro da lista que rola.
  useEffect(() => {
    if (idAtivo) document.getElementById(idAtivo)?.scrollIntoView?.({ block: "nearest" });
  }, [idAtivo]);

  function fechar() {
    setAberto(false);
    setDigitou(false);
    setTexto(nomeAtual);
    setAtivo(-1);
  }

  function escolher(slug: string) {
    const ramo = ramoPorSlug(slug);
    if (!ramo) return;
    setTexto(ramo.nome);
    setDigitou(false);
    setAberto(false);
    setAtivo(-1);
    setAnuncio(textosRamo.escolhido(ramo.nome));
    onEscolher(slug);
  }

  function naoAchei() {
    if (!textoNaoAchei || !onNaoAchei) return;
    const digitado = texto.trim();
    setTexto(textoNaoAchei);
    setDigitou(false);
    setAberto(false);
    setAtivo(-1);
    onNaoAchei(digitado);
  }

  function aoTeclar(evento: KeyboardEvent<HTMLInputElement>) {
    switch (evento.key) {
      case "ArrowDown":
        evento.preventDefault();
        if (!aberto) setAberto(true);
        else if (!buscando) abrirFolha();
        else if (total > 0) setAtivo(indiceAtivo < 0 ? 0 : (indiceAtivo + 1) % total);
        break;
      case "ArrowUp":
        evento.preventDefault();
        if (!aberto) setAberto(true);
        else if (buscando && total > 0) setAtivo(indiceAtivo < 0 ? total - 1 : (indiceAtivo - 1 + total) % total);
        break;
      case "Enter":
        // Lista fechada: o Enter é do formulário. Aberta: ele escolhe, e nunca envia.
        if (!aberto) return;
        evento.preventDefault();
        if (!buscando || indiceAtivo < 0) return;
        if (indiceAtivo < ramos.length) escolher(ramos[indiceAtivo].slug);
        else naoAchei();
        break;
      case "Escape":
        if (aberto) {
          // Só fecha a lista: o Esc não pode fechar também a folha ou a tela em que o campo está.
          evento.preventDefault();
          evento.stopPropagation();
          fechar();
        }
        break;
    }
  }

  const fala = aberto && buscando ? (ramos.length === 0 ? textosRamo.nenhum : textosRamo.resultados(ramos.length)) : anuncio;

  return (
    <div className={campo.grupo} ref={grupoRef}>
      <label className={campo.rotulo} htmlFor={id}>
        {rotulo}
      </label>
      {ajuda ? (
        <span className={campo.ajuda} id={idAjuda}>
          {ajuda}
        </span>
      ) : null}
      <div className={styles.caixa}>
        <Search className={styles.lupa} size={18} strokeWidth={1.5} aria-hidden="true" />
        <input
          id={id}
          ref={(elemento) => {
            entradaRef.current = elemento;
            if (typeof ref === "function") ref(elemento);
            else if (ref) ref.current = elemento;
          }}
          type="text"
          role="combobox"
          aria-expanded={aberto && buscando && total > 0}
          aria-controls={idLista}
          aria-autocomplete="list"
          aria-activedescendant={idAtivo}
          aria-describedby={[idAjuda, idErro].filter(Boolean).join(" ") || undefined}
          aria-invalid={Boolean(erro)}
          className={[campo.entrada, styles.entrada, erro ? campo.comErro : ""].filter(Boolean).join(" ")}
          value={texto}
          title={nomeAtual || undefined}
          placeholder={textosRamo.placeholder}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onFocus={(evento) => {
            if (ignorarFoco.current) {
              ignorarFoco.current = false;
              return;
            }
            setAberto(true);
            setDigitou(false);
            setAtivo(-1);
            evento.currentTarget.select();
          }}
          onClick={() => setAberto(true)}
          onBlur={(evento) => {
            // O foco indo para a dica ("Ver a lista de ramos") ou para o "Trocar" não fecha: senão o Tab nunca chegaria neles.
            if (evento.relatedTarget instanceof Node && grupoRef.current?.contains(evento.relatedTarget)) return;
            fechar();
          }}
          onChange={(evento) => {
            setTexto(evento.target.value);
            setDigitou(true);
            setAberto(true);
            // Digitar leva o destaque de volta ao primeiro resultado (o que o Enter escolhe), mesmo depois de usar as setas.
            setAtivo(-1);
            setAnuncio("");
          }}
          onKeyDown={aoTeclar}
        />
        {buscando ? (
          <button
            type="button"
            className={styles.limpar}
            aria-label={textosRamo.apagarBusca}
            onMouseDown={(evento) => evento.preventDefault()}
            onClick={() => {
              setTexto("");
              setDigitou(true);
              setAtivo(-1);
              entradaRef.current?.focus();
            }}
          >
            <X size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {/* A lista fica DENTRO do cartão e empurra o que está embaixo (passo 16): nunca cobre a pergunta seguinte nem some atrás do teclado. */}
      {aberto && !buscando ? (
        <div className={styles.dica} onMouseDown={(evento) => evento.preventDefault()}>
          <span>{textosRamo.dica}</span>
          <button type="button" className={styles.verALista} aria-haspopup="dialog" onClick={abrirFolha}>
            {textosRamo.verALista}
          </button>
        </div>
      ) : null}
      {aberto && buscando ? (
        <div
          className={styles.lista}
          // Clicar na barra de rolagem ou no título de um grupo não pode tirar o foco do campo (fecharia a lista).
          onMouseDown={(evento) => evento.preventDefault()}
        >
          {/* Fora do listbox, que só pode ter opções e grupos de opções (um parágrafo dentro dele reprova no leitor de tela). */}
          {ramos.length === 0 ? (
            <p className={styles.semResultado}>
              {textosRamo.semResultado(texto.trim())}
              {textoNaoAchei && onNaoAchei ? ` ${textosRamo.semResultadoSaida}` : ""}
            </p>
          ) : null}
          {total > 0 ? (
            <div id={idLista} role="listbox" aria-label={textosRamo.rotuloLista} className={styles.opcoes}>
              {grupos.map(({ grupo, ramos: doGrupo }) => (
                <div key={grupo.slug} role="group" aria-labelledby={`${id}-g-${grupo.slug}`} className={styles.grupoDeRamos}>
                  <div id={`${id}-g-${grupo.slug}`} className={styles.cabecalhoDoGrupo}>
                    {grupo.nome}
                  </div>
                  {doGrupo.map((ramo) => {
                    const indice = indiceDe.get(ramo.slug) ?? -1;
                    return (
                      <div
                        key={ramo.slug}
                        id={idDaOpcao(ramo.slug)}
                        role="option"
                        aria-selected={indice === indiceAtivo}
                        className={[styles.opcao, indice === indiceAtivo ? styles.opcaoAtiva : ""].filter(Boolean).join(" ")}
                        // O mousedown no campo tiraria o foco dele antes do clique chegar: o foco fica no campo.
                        onMouseDown={(evento) => evento.preventDefault()}
                        onMouseMove={() => {
                          if (ativo !== indice) setAtivo(indice);
                        }}
                        onClick={() => escolher(ramo.slug)}
                      >
                        <span className={styles.nome}>{ramo.nome}</span>
                        <span className={styles.exemplos}>{ramo.exemplos}</span>
                        {ramo.slug === valor ? (
                          <>
                            <Check className={styles.marca} size={18} strokeWidth={2} aria-hidden="true" />
                            <span className="so-leitor">{textosRamo.ramoAtual}</span>
                          </>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ))}
              {mostrarNaoAchei ? (
                <div
                  id={idNaoAchei}
                  role="option"
                  aria-selected={indiceAtivo === ramos.length}
                  className={[styles.opcao, styles.naoAchei, indiceAtivo === ramos.length ? styles.opcaoAtiva : ""].filter(Boolean).join(" ")}
                  onMouseDown={(evento) => evento.preventDefault()}
                  onMouseMove={() => {
                    if (ativo !== ramos.length) setAtivo(ramos.length);
                  }}
                  onClick={naoAchei}
                >
                  <span className={styles.nome}>{textoNaoAchei}</span>
                  <span className={styles.exemplos}>{textosRamo.naoAcheiAjuda}</span>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {/* O ramo escolhido (passo 16): a linha de exemplos e o "Trocar" embaixo do campo, que continua sendo o campo. */}
      {!aberto && ramoPorSlug(valor) ? (
        <div className={styles.escolhido}>
          <span className={styles.exemplos}>{ramoPorSlug(valor)?.exemplos}</span>
          <button ref={trocarRef} type="button" className={styles.verALista} aria-label={textosRamo.trocarORamo} onClick={() => entradaRef.current?.focus()}>
            {textosRamo.trocar}
          </button>
        </div>
      ) : null}
      <FolhaDosRamos
        key={aberturas}
        aberto={folhaAberta}
        aoFechar={fecharFolha}
        valor={valor}
        ramosEscondidos={ramosEscondidos ?? []}
        aoEscolher={(slug) =>
          fecharEDepois(() => {
            focarTrocar.current = true;
            escolher(slug);
          })
        }
        textoNaoAchei={onNaoAchei ? textoNaoAchei : undefined}
        aoNaoAchei={onNaoAchei ? () => fecharEDepois(() => naoAchei()) : undefined}
      />
      {/* Sem `role="status"`: o campo está em telas cujos testes esperam o aviso de "salvo" com `getByRole("status")`, e um status sempre presente
          (mesmo vazio e fora da vista) o confundia com o aviso (achado do e2e do tema, que recarregava antes de o salvar terminar). */}
      <span className="so-leitor" aria-live="polite" aria-atomic="true" data-fala-da-busca-de-ramo>
        {fala}
      </span>
      {erro ? (
        <span className={campo.erro} id={idErro} role="alert">
          {erro}
        </span>
      ) : null}
    </div>
  );
}
