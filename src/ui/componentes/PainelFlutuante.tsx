"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { usePuxarParaFechar } from "@/ui/usePuxarParaFechar";

import styles from "./PainelFlutuante.module.css";

const LARGURA_TABLET = 768;

type Props = {
  /** aria-label do painel. */
  titulo: string;
  aberto: boolean;
  /**
   * Quem é dono do estado `aberto` passa aqui o `fechar` de `useFolhaNoHistorico`
   * (V7, item 1 do PROXIMO.md): véu, Esc, arrastar a alça e o rolar do menu chamam
   * isto, e o botão Voltar do aparelho fecha pelo próprio histórico.
   */
  aoFechar: () => void;
  /** "menu" para uma lista de acoes (role="menuitem" nos filhos); "dialog" para formulario ou lista. */
  role?: "menu" | "dialog";
  /**
   * Rodapé que não rola com o resto (V7, item 3: o botão principal precisa
   * ficar dentro da área visível mesmo com a viewport reduzida). Só o painel
   * "reprovar" usa hoje, o mais alto dos quatro; os outros continuam com
   * tudo dentro de `children`, que ainda rola inteiro se passar de 80dvh.
   */
  rodape?: ReactNode;
  children: ReactNode;
};

/**
 * Um painel só, para os quatro que `/roteiros/[id]` abre (menu, postei,
 * ângulo, versões; `PROXIMO.md`, acabamento do iPad, item 1): no celular,
 * folha que sobe de baixo, fixa acima da barra de ações, com fundo
 * escurecido; do tablet para cima, painel ancorado no canto superior
 * direito, perto do botão "Mais ações" que os quatro reaproveitam como
 * ponto de abertura.
 *
 * O véu cobre a tela inteira e recebe o clique (ajuste da revisão do PR
 * #33, item 1): a primeira versão deixava o clique passar por baixo dele
 * (`pointer-events: none`) para o botão que abriu o painel conseguir
 * alternar; o efeito colateral era o toque atrás do véu escurecido, no
 * celular, chegar ao que está por baixo (um toque perto de "Já gravei"
 * fechava a folha e marcava como gravado ao mesmo tempo). Com o véu de
 * volta cobrindo o toque, um clique no botão que abriu o painel cai no véu
 * (que está por cima) e só fecha; não precisa mais de um caso especial para
 * esse botão, e o `document` não precisa ouvir clique fora, porque não
 * sobra nenhum lugar clicável fora do véu ou do próprio painel enquanto ele
 * está aberto.
 *
 * Fechar ao rolar a página de trás (mesma regra de `BarraNotaGeral`) só vale
 * do tablet para cima, e só para o menu: no celular a folha é modal (achado
 * do iPad, leitura prévia do Fable) e o próprio teclado rola a janela para
 * mostrar o campo em foco, o que fechava o formulário "Postei" no meio da
 * digitação; um formulário ancorado (tablet para cima) tem o mesmo problema
 * e também não fecha ao rolar.
 *
 * Arrastar a alça para baixo fecha, só no celular (`usePuxarParaFechar`, V7,
 * item 1 do PROXIMO.md). O `data-folha-aberta` no véu e no painel é o que a
 * regra global de `base.css` lê para travar a rolagem da página de trás
 * enquanto uma folha está aberta.
 */
export function PainelFlutuante({ titulo, aberto, aoFechar, role = "dialog", rodape, children }: Props) {
  const arrasto = usePuxarParaFechar(aoFechar);
  const painelRef = arrasto.folhaRef;

  // O pai cria um `aoFechar` novo a cada renderização (cada tecla digitada num campo do painel renderiza o pai).
  // Se ele entrasse nas dependências do efeito abaixo, o foco voltava para o painel a cada tecla e o teclado do
  // celular fechava no primeiro caractere (V7, item 1 do PROXIMO.md). Por isso o efeito lê o mais recente por aqui.
  const aoFecharRef = useRef(aoFechar);
  useEffect(() => {
    aoFecharRef.current = aoFechar;
  });

  useEffect(() => {
    if (!aberto) return;

    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === "Escape") aoFecharRef.current();
    }
    function aoRolar() {
      if (window.innerWidth < LARGURA_TABLET) return;
      if (role !== "menu") return;
      aoFecharRef.current();
    }

    document.addEventListener("keydown", aoTeclar);
    window.addEventListener("scroll", aoRolar, { passive: true });
    painelRef.current?.focus();

    return () => {
      document.removeEventListener("keydown", aoTeclar);
      window.removeEventListener("scroll", aoRolar);
    };
  }, [aberto, role, painelRef]);

  if (!aberto) return null;

  return (
    <>
      <div className={styles.veu} onClick={aoFechar} aria-hidden="true" data-folha-aberta="" />
      <div
        ref={painelRef}
        role={role}
        aria-modal={role === "dialog" ? true : undefined}
        aria-label={titulo}
        tabIndex={-1}
        data-folha-aberta=""
        className={rodape ? styles.painelComRodape : styles.painel}
      >
        {/* A alça desenhada tem 5px; quem agarra é esta área de 44px em volta dela (some do tablet para cima). */}
        <div className={styles.areaAlca} {...arrasto.alca}>
          <span className={styles.alca} aria-hidden="true" />
        </div>
        {rodape ? (
          <>
            <div className={styles.corpo}>{children}</div>
            <div className={styles.rodape}>{rodape}</div>
          </>
        ) : (
          children
        )}
      </div>
    </>
  );
}
