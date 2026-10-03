"use client";

import { ChevronRight, Search } from "lucide-react";
import { useId, useMemo, useState } from "react";

import { buscarRamos } from "@/lib/buscar-ramo";
import { textosRamo } from "@/textos/ramo";

import { Botao } from "./Botao";
import styles from "./BuscaDeRamo.module.css";
import { Folha } from "./Folha";

type Props = {
  aberto: boolean;
  /** O `fechar` de `useFolhaNoHistorico` (quem é dono do estado chama o hook). */
  aoFechar: () => void;
  /** Escolher um ramo: quem é dono fecha a folha e segue como se tivesse escolhido na lista do campo. */
  aoEscolher: (slug: string) => void;
  /** O ramo marcado hoje (o `slug`), se houver. */
  valor: string | null;
  ramosEscondidos: readonly string[];
  /** "Não achei o meu": o rótulo do botão do pé; sem ele, a folha não oferece a saída. */
  textoNaoAchei?: string;
  aoNaoAchei?: () => void;
};

/**
 * A folha "Os ramos" (passo 16 do Opus, `Comecar.dc.html`, estado `ramoLista`): os nove grupos na ordem do catálogo, com a busca do alto filtrando a mesma lista;
 * no computador, um painel no meio (o padrão `Folha`). Rola por dentro. É onde "Ver a lista de ramos" leva, porque o campo vazio não abre mais os 44 ramos
 * de uma vez dentro do cartão.
 */
export function FolhaDosRamos({ aberto, aoFechar, aoEscolher, valor, ramosEscondidos, textoNaoAchei, aoNaoAchei }: Props) {
  const id = useId();
  const [consulta, setConsulta] = useState("");
  const escondidos = ramosEscondidos.join("|");
  const grupos = useMemo(() => {
    const fora = new Set(escondidos ? escondidos.split("|") : []);
    const todos = buscarRamos(consulta);
    return fora.size === 0 ? todos : todos.map((g) => ({ ...g, ramos: g.ramos.filter((r) => !fora.has(r.slug)) })).filter((g) => g.ramos.length > 0);
  }, [consulta, escondidos]);

  return (
    <Folha
      titulo={textosRamo.tituloFolha}
      aberto={aberto}
      aoFechar={aoFechar}
      rodape={
        textoNaoAchei && aoNaoAchei ? (
          <Botao variante="secundario" tamanho="lg" onClick={aoNaoAchei}>
            {textoNaoAchei}
          </Botao>
        ) : undefined
      }
    >
      <div className={styles.campoDaFolha}>
        <Search className={styles.lupa} size={18} strokeWidth={1.5} aria-hidden="true" />
        <input
          type="text"
          className={styles.entradaDaFolha}
          aria-label={textosRamo.buscarUmRamo}
          placeholder={textosRamo.placeholder}
          value={consulta}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onChange={(evento) => setConsulta(evento.target.value)}
        />
      </div>
      {grupos.length === 0 ? (
        <p className={styles.semResultado} role="status">
          {textosRamo.semResultado(consulta.trim())}
        </p>
      ) : (
        <div role="listbox" aria-label={textosRamo.rotuloLista} className={styles.listaDaFolha}>
          {grupos.map(({ grupo, ramos }) => (
            <div key={grupo.slug} role="group" aria-labelledby={`${id}-g-${grupo.slug}`} className={styles.grupoDaFolha}>
              <div id={`${id}-g-${grupo.slug}`} className={styles.cabecalhoDoGrupo}>
                {grupo.nome}
              </div>
              {ramos.map((ramo) => (
                <div
                  key={ramo.slug}
                  role="option"
                  aria-selected={ramo.slug === valor}
                  tabIndex={0}
                  className={[styles.opcao, styles.opcaoDaFolha, ramo.slug === valor ? styles.opcaoAtiva : ""].filter(Boolean).join(" ")}
                  onClick={() => aoEscolher(ramo.slug)}
                  onKeyDown={(evento) => {
                    if (evento.key === "Enter" || evento.key === " ") {
                      evento.preventDefault();
                      aoEscolher(ramo.slug);
                    }
                  }}
                >
                  <span className={styles.nome}>{ramo.nome}</span>
                  <span className={styles.exemplos}>{ramo.exemplos}</span>
                  <ChevronRight className={styles.marca} size={18} strokeWidth={1.75} aria-hidden="true" />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </Folha>
  );
}
