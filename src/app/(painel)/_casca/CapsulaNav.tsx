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

const ITENS_CAPSULA: { href: string; rotulo: string; Icone: ComponentType<{ size?: number; strokeWidth?: number }> }[] = [
  { href: "/hoje", rotulo: textosNav.hoje, Icone: House },
  { href: "/criar", rotulo: textosNav.criar, Icone: SquarePlus },
  { href: "/planejamento", rotulo: textosNav.planejar, Icone: Calendar },
];
/** As mesmas rotas de `FolhaMais.tsx`, só para saber quando "Mais" fica aceso. */
const ROTAS_NO_MAIS = ["/referencias", "/historico"];

type Props = {
  /** V5, item 5: o rótulo escrito some da vista ao rolar para baixo, continua para o leitor de tela. */
  encolhida?: boolean;
};

/**
 * A cápsula de navegação do celular (passo 13 do Opus, `Casca.dc.html`, `.abas`/`.aba`): só os
 * três destinos de todo dia (Hoje, Criar, Planejar) mais "Mais", que abre `FolhaMais.tsx` com o
 * que é para consultar (Referências, Histórico; Notícias quando a E43 existir). A 360 px, seis
 * (ou cinco) destinos não cabem com o rótulo legível e o alvo de 44 px; a barra lateral do
 * tablet/desktop (`Nav.tsx`) mostra todos direto, sem este recorte.
 */
export function CapsulaNav({ encolhida = false }: Props) {
  const pathname = usePathname();
  const [maisAberto, setMaisAberto] = useState(false);
  const { fechar: fecharMais, fecharENavegar: fecharMaisENavegar } = useFolhaNoHistorico(maisAberto, () =>
    setMaisAberto(false),
  );

  const classes = [navStyles.nav, encolhida && navStyles.navEncolhida].filter(Boolean).join(" ");
  const maisAtivo = ROTAS_NO_MAIS.some((rota) => ehRotaAtiva(pathname, rota));

  return (
    <>
      <nav className={classes} aria-label={textosNav.navegacaoPrincipal}>
        {ITENS_CAPSULA.map(({ href, rotulo, Icone }) => {
          const ativo = ehRotaAtiva(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              className={ativo ? `${navStyles.item} ${navStyles.ativo}` : navStyles.item}
              aria-current={ativo ? "page" : undefined}
            >
              <span className={navStyles.traco} aria-hidden="true" />
              <Icone size={22} strokeWidth={1.5} />
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
          onClick={() => setMaisAberto(true)}
        >
          <span className={navStyles.traco} aria-hidden="true" />
          <MoreHorizontal size={22} strokeWidth={1.5} />
          <span className={encolhida ? `${navStyles.rotulo} ${navStyles.escondidoDaVista}` : navStyles.rotulo}>
            {textosNav.mais}
          </span>
        </button>
      </nav>
      {maisAberto ? <FolhaMais aoFechar={fecharMais} aoNavegar={fecharMaisENavegar} /> : null}
    </>
  );
}
