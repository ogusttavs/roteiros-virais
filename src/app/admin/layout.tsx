import type { ReactNode } from "react";

import { BotaoSair } from "@/app/(painel)/(completo)/conta/BotaoSair";
import { iniciaisDe } from "@/lib/iniciais";
import { exigirAdmin } from "@/lib/sessao";
import { textosAdmin } from "@/textos/admin";
import { Simbolo } from "@/ui/Logo";

import { AbasAdmin } from "./_casca/AbasAdmin";
import styles from "./layout.module.css";

const t = textosAdmin.navegacao;

/**
 * Casca do admin: abas, largura total, sem a navegacao do cliente
 * (CascaAdmin.dc.html). `exigirAdmin` tambem e chamado na primeira linha de
 * cada `page.tsx` do admin; o layout continua conferindo aqui como segunda
 * camada, e o `cache` do React evita repetir a leitura da sessao.
 */
export default async function LayoutAdmin({ children }: { children: ReactNode }) {
  const sessao = await exigirAdmin();

  return (
    <div className={styles.pagina}>
      <header className={styles.cabecalho}>
        <div className={styles.identidade}>
          <Simbolo altura={24} />
          <span className={styles.equipe}>{t.equipe}</span>
        </div>
        <AbasAdmin rotulos={{ clientes: t.clientes, nichos: t.nichos, jobs: t.jobs, geracoes: t.geracoes }} />
        <div className={styles.conta}>
          <span className={styles.nomeConta}>{sessao.user.name}</span>
          <span className={styles.avatar}>{iniciaisDe(sessao.user.name)}</span>
          <BotaoSair className={styles.sair} rotulo={t.sair} rotuloSaindo={t.saindo} />
        </div>
      </header>
      <main className={styles.corpo}>{children}</main>
    </div>
  );
}
