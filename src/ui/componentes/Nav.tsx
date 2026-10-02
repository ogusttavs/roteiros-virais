"use client";

import { Bookmark, Calendar, History, House, Newspaper, SquarePlus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, type ComponentType } from "react";

import { textosNav } from "@/textos/nav";

import styles from "./Nav.module.css";
import { ehRotaAtiva } from "./navAtivo";

/**
 * A barra lateral do tablet e do desktop (etapa "acabamento visual 2"), sem "Conta" (foi para o
 * avatar do cabecalho, decisao do Fable no PROXIMO.md, etapa D parte 1).
 *
 * E39a (desenho do Opus, passo 10): Hoje vira a agenda (so mostra o que ja esta marcado) e Criar
 * entra como a oficina (de onde todo roteiro nasce); Briefing sai daqui e vira uma linha dentro
 * de Conta, com a nota e uma seta (duvida 2 do desenho). `SquarePlus` e o icone mais perto do
 * "quadrado com mais" do desenho; nao existe um feito a mao no conjunto entregue ainda.
 *
 * E39c, parte 2a (decisao do Gustavo de 01/10, 22:15; passo 13 do Opus, 01/10 23:50): "Planejar"
 * entra entre Criar e Referencias, com icone de calendario, com um traco depois dele (o que se
 * faz todo dia de um lado, o que e para consultar do outro). A capsula do celular NAO usa este
 * componente: so tres (Hoje, Criar, Planejar) cabem a 360px com o rotulo inteiro, os outros vao
 * para o botao "Mais" (`CapsulaNav.tsx`, `../../_casca/CapsulaNav.tsx`), que abre uma folha.
 *
 * E43 (decisao do Gustavo de 01/10, 22:20; passo 13 do Opus): "Noticias" entra entre Referencias e
 * Historico, com icone de jornal.
 */
const ITENS: { href: string; rotulo: string; Icone: ComponentType<{ size?: number; strokeWidth?: number }>; divisorDepois?: boolean }[] = [
  { href: "/hoje", rotulo: textosNav.hoje, Icone: House },
  { href: "/criar", rotulo: textosNav.criar, Icone: SquarePlus },
  { href: "/planejamento", rotulo: textosNav.planejar, Icone: Calendar, divisorDepois: true },
  { href: "/referencias", rotulo: textosNav.referencias, Icone: Bookmark },
  { href: "/noticias", rotulo: textosNav.noticias, Icone: Newspaper },
  { href: "/historico", rotulo: textosNav.historico, Icone: History },
];

type Props = {
  /**
   * Marca o `<nav>` para o CSS poder esconder o rótulo quando a barra está
   * recolhida (`html[data-barra-lateral="recolhida"]`), com o `title` como
   * alternativa de tooltip. Sempre `true` na prática (só a barra lateral usa
   * este componente), mantido como prop por já existir assim.
   */
  compactavel?: boolean;
};

export function Nav({ compactavel = false }: Props) {
  const pathname = usePathname();

  const classes = [styles.nav, compactavel && styles.compactavel].filter(Boolean).join(" ");

  return (
    <nav className={classes} aria-label={textosNav.navegacaoPrincipal}>
      {ITENS.map(({ href, rotulo, Icone, divisorDepois }) => {
        const ativo = ehRotaAtiva(pathname, href);
        return (
          <Fragment key={href}>
            <Link
              href={href}
              className={ativo ? `${styles.item} ${styles.ativo}` : styles.item}
              aria-current={ativo ? "page" : undefined}
              title={compactavel ? rotulo : undefined}
            >
              <span className={styles.traco} aria-hidden="true" />
              <Icone size={22} strokeWidth={1.5} />
              <span className={styles.rotulo}>{rotulo}</span>
            </Link>
            {divisorDepois ? <span className={styles.divisor} aria-hidden="true" /> : null}
          </Fragment>
        );
      })}
    </nav>
  );
}
