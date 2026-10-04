"use client";

import { Calendar, House, MoreHorizontal, SquarePlus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ComponentType } from "react";

import { textosNav } from "@/textos/nav";
import navStyles from "@/ui/componentes/Nav.module.css";
import { ehRotaAtiva } from "@/ui/componentes/navAtivo";
import { useFolhaNoHistorico } from "@/ui/useFolhaNoHistorico";

import { FolhaMais } from "./FolhaMais";

const ITENS_CAPSULA: { href: string; rotulo: string; Icone: ComponentType<{ size?: number; strokeWidth?: number; className?: string }> }[] = [
  { href: "/hoje", rotulo: textosNav.hoje, Icone: House },
  { href: "/criar", rotulo: textosNav.criar, Icone: SquarePlus },
  { href: "/planejamento", rotulo: textosNav.planejar, Icone: Calendar },
];
/** As mesmas rotas de `FolhaMais.tsx`, só para saber quando "Mais" fica aceso. */
const ROTAS_NO_MAIS = ["/referencias", "/noticias", "/historico", "/conta"];

type Props = {
  /** V5, item 5: o rótulo escrito some da vista ao rolar para baixo, continua para o leitor de tela. */
  encolhida?: boolean;
  /** A3, item 5: tocar em qualquer lugar da cápsula (o ícone encolhido é o atalho) a abre; o destino abre junto, pela troca de rota. */
  aoTocar?: () => void;
};

/**
 * A cápsula de navegação do celular (passo 13 do Opus, `Casca.dc.html`, `.abas`/`.aba`): só os
 * três destinos de todo dia (Hoje, Criar, Planejar) mais "Mais", que abre `FolhaMais.tsx` com o
 * que é para consultar (Referências, Notícias, Histórico). A 360 px, seis destinos não cabem com
 * o rótulo legível e o alvo de 44 px; a barra lateral do tablet/desktop (`Nav.tsx`) mostra todos
 * direto, sem este recorte.
 */
export function CapsulaNav({ encolhida = false, aoTocar }: Props) {
  const pathname = usePathname();
  const [maisAberto, setMaisAberto] = useState(false);
  const { fechar: fecharMais, fecharENavegar: fecharMaisENavegar } = useFolhaNoHistorico(maisAberto, () =>
    setMaisAberto(false),
  );

  const classes = [navStyles.nav, encolhida && navStyles.navEncolhida].filter(Boolean).join(" ");
  const maisAtivo = ROTAS_NO_MAIS.some((rota) => ehRotaAtiva(pathname, rota));
  // A seleção (o fundo do ativo) é UM elemento que desliza de aba em aba por `transform` (passo 16): o índice da aba ativa, ou nenhum.
  const indiceAtivo = maisAtivo ? ITENS_CAPSULA.length : ITENS_CAPSULA.findIndex(({ href }) => ehRotaAtiva(pathname, href));

  return (
    <>
      <nav className={classes} aria-label={textosNav.navegacaoPrincipal}>
        <span
          className={navStyles.selecao}
          aria-hidden="true"
          data-selecao
          style={{ transform: `translateX(${Math.max(indiceAtivo, 0) * 100}%)`, opacity: indiceAtivo < 0 ? 0 : 1 }}
        />
        {ITENS_CAPSULA.map(({ href, rotulo, Icone }) => {
          const ativo = ehRotaAtiva(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              className={ativo ? `${navStyles.item} ${navStyles.ativo}` : navStyles.item}
              aria-current={ativo ? "page" : undefined}
              onClick={aoTocar}
            >
              <span className={navStyles.traco} aria-hidden="true" />
              <Icone size={22} strokeWidth={ativo ? 2 : 1.5} className={ativo ? navStyles.iconeCheio : undefined} />
              <span className={encolhida ? `${navStyles.rotulo} ${navStyles.escondidoDaVista}` : navStyles.rotulo}>
                {rotulo}
              </span>
            </Link>
          );
        })}
        <button
          type="button"
          className={maisAtivo ? `${navStyles.item} ${navStyles.ativo}` : navStyles.item}
          aria-haspopup="dialog"
          aria-label={textosNav.maisAriaLabel}
          onClick={() => {
            aoTocar?.();
            setMaisAberto(true);
          }}
        >
          <span className={navStyles.traco} aria-hidden="true" />
          <MoreHorizontal size={22} strokeWidth={maisAtivo ? 2 : 1.5} />
          <span className={encolhida ? `${navStyles.rotulo} ${navStyles.escondidoDaVista}` : navStyles.rotulo}>
            {textosNav.mais}
          </span>
        </button>
      </nav>
      {maisAberto ? <FolhaMais aoFechar={fecharMais} aoNavegar={fecharMaisENavegar} /> : null}
    </>
  );
}
