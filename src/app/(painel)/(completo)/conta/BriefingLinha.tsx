import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { textosConta } from "@/textos/conta";

import styles from "./page.module.css";

/**
 * E39a (desenho do Opus, dúvida 2): Briefing saiu da navegação principal; esta linha, no topo de
 * Conta, é a única entrada para ele agora. `nota` nula (briefing recém criado, nunca avaliado)
 * mostra "Ainda sem nota" no lugar do número.
 */
export function BriefingLinha({ nota }: { nota: number | null }) {
  return (
    <Link href="/briefing" className={styles.linhaBriefing}>
      <span className={styles.linhaBriefingTitulo}>{textosConta.briefingLinha.rotulo}</span>
      <span className={styles.linhaBriefingNota}>
        {nota !== null ? textosConta.briefingLinha.nota(nota) : textosConta.briefingLinha.semNota}
      </span>
      <ChevronRight size={20} strokeWidth={1.75} aria-hidden="true" />
    </Link>
  );
}
