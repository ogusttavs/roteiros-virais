"use client";

import { Bookmark, Calendar, History, House, SquarePlus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";

import { textosNav } from "@/textos/nav";

import styles from "./Nav.module.css";
import { ehRotaAtiva } from "./navAtivo";

/**
 * Cinco itens, sem "Conta" (foi para o avatar do cabecalho, decisao do
 * Fable no PROXIMO.md, etapa D parte 1). Base de 64 px no celular, coluna de
 * 220 px no desktop (a largura e da casca, nao deste componente).
 *
 * E39a (desenho do Opus, passo 10): Hoje vira a agenda (so mostra o que ja esta marcado) e Criar
 * entra como a oficina (de onde todo roteiro nasce); Briefing sai daqui e vira uma linha dentro
 * de Conta, com a nota e uma seta (duvida 2 do desenho). `SquarePlus` e o icone mais perto do
 * "quadrado com mais" do desenho; nao existe um feito a mao no conjunto entregue ainda.
 *
 * E39c, parte 2a (decisao do Gustavo de 01/10, 22:15): "Planejar" entra entre Criar e
 * Referencias, com icone de calendario. Seis destinos no fim (Noticias, na E43) nao cabem na
 * capsula do celular; por enquanto sao cinco, `Nav.module.css` com a grade e 5 colunas.
 */
const ITENS: { href: string; rotulo: string; Icone: ComponentType<{ size?: number; strokeWidth?: number }> }[] = [
  { href: "/hoje", rotulo: textosNav.hoje, Icone: House },
  { href: "/criar", rotulo: textosNav.criar, Icone: SquarePlus },
  { href: "/planejamento", rotulo: textosNav.planejar, Icone: Calendar },
  { href: "/referencias", rotulo: textosNav.referencias, Icone: Bookmark },
  { href: "/historico", rotulo: textosNav.historico, Icone: History },
];

type Props = {
  /**
   * Só a barra lateral do desktop passa isto (etapa "acabamento visual 2"):
   * marca o `<nav>` para o CSS poder esconder o rótulo quando a barra está
   * recolhida (`html[data-barra-lateral="recolhida"]`), sem afetar a barra
   * inferior do celular, que usa o mesmo componente sem a prop.
   */
  compactavel?: boolean;
  /**
   * Só a cápsula do celular passa isto (V5, item 5, `CapsulaAbas.tsx`): o
   * rótulo escrito some da vista ao rolar para baixo, mas continua para o
   * leitor de tela (`.escondidoDaVista`, não `display: none`, diferente de
   * `compactavel` acima, que tem o `title` como alternativa de tooltip).
   */
  encolhida?: boolean;
};

export function Nav({ compactavel = false, encolhida = false }: Props) {
  const pathname = usePathname();

  const classes = [styles.nav, compactavel && styles.compactavel, encolhida && styles.navEncolhida]
    .filter(Boolean)
    .join(" ");

  return (
    <nav className={classes} aria-label={textosNav.navegacaoPrincipal}>
      {ITENS.map(({ href, rotulo, Icone }) => {
        const ativo = ehRotaAtiva(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            className={ativo ? `${styles.item} ${styles.ativo}` : styles.item}
            aria-current={ativo ? "page" : undefined}
            title={compactavel ? rotulo : undefined}
          >
            <span className={styles.traco} aria-hidden="true" />
            <Icone size={22} strokeWidth={1.5} />
            <span className={encolhida ? `${styles.rotulo} ${styles.escondidoDaVista}` : styles.rotulo}>
              {rotulo}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
