"use client";

import { Eye } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { textosVerComo } from "@/textos/ver-como";

import styles from "./FaixaVerComo.module.css";
import { sairDoVerComoAction } from "./ver-como-acoes";

type Props = {
  pessoa: string;
  conta: string;
  /** Quando o modo termina, em milissegundos desde 1970 (o servidor já conferiu que vale). */
  expiraEm: number;
};

const MINUTO_MS = 60 * 1000;

/**
 * A faixa fixa do "ver como" (E46 PR 2): fica no alto de todas as telas do painel enquanto o modo está ligado, diz quem e qual conta, quanto falta (30 minutos no total) e tem "Sair do
 * modo". Quando o tempo acaba, atualiza a tela: o servidor já não aceita o cookie e o painel volta ao que o admin é. A altura entra em `--area-topo` por `:has()` em `base.css`.
 */
/** A faixa já pronta a partir da sessão do painel (`null` fora do modo): o mesmo uso no layout do painel e nas páginas que ficam fora dele (`/comecar`, o gravar). */
export function FaixaDoModo({ verComo, pessoa, conta }: { verComo: { expiraEm: Date } | null; pessoa: string; conta: string }) {
  return verComo ? <FaixaVerComo pessoa={pessoa} conta={conta} expiraEm={verComo.expiraEm.getTime()} /> : null;
}

export function FaixaVerComo({ pessoa, conta, expiraEm }: Props) {
  const router = useRouter();
  const [agora, setAgora] = useState(() => Date.now());
  const [saindo, iniciarSaida] = useTransition();

  useEffect(() => {
    const intervalo = setInterval(() => setAgora(Date.now()), 15 * 1000);
    return () => clearInterval(intervalo);
  }, []);

  const restamMs = expiraEm - agora;
  useEffect(() => {
    if (restamMs <= 0) router.refresh();
  }, [restamMs, router]);

  return (
    <div className={styles.faixa} role="status" data-faixa-ver-como="">
      <Eye size={16} strokeWidth={1.5} aria-hidden="true" />
      <span className={styles.quemVe}>{textosVerComo.faixa(pessoa, conta)}</span>
      <span className={styles.resta}>{textosVerComo.restam(Math.max(0, Math.ceil(restamMs / MINUTO_MS)))}</span>
      <button type="button" className={styles.sair} disabled={saindo} onClick={() => iniciarSaida(async () => sairDoVerComoAction())}>
        {saindo ? textosVerComo.saindo : textosVerComo.sair}
      </button>
    </div>
  );
}
