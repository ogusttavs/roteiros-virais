import type { ReactNode } from "react";

import { BotaoSair } from "@/app/(painel)/(completo)/conta/BotaoSair";
import { exigirAdmin } from "@/lib/sessao";
import { contarPedidosAbertos } from "@/servicos/pedidos-de-ramo";
import { textosAdmin } from "@/textos/admin";
import { Logo, Simbolo } from "@/ui/Logo";

import { LateralAdmin } from "./_casca/LateralAdmin";
import styles from "./layout.module.css";

const t = textosAdmin.navegacao;

/**
 * Casca do admin: a barra lateral e o conteúdo (E46 PR 1, `Casca.dc.html`), sem a navegação do cliente. `exigirAdmin` também é chamado na primeira linha de cada
 * `page.tsx` do admin; o layout continua conferindo aqui como segunda camada, e o `cache` do React evita repetir a leitura da sessão.
 */
export default async function LayoutAdmin({ children }: { children: ReactNode }) {
  const sessao = await exigirAdmin();
  // Quantos pedidos de ramo esperam o admin (E45 PR 2): o número ao lado de "Ramos", sem entrar na lista.
  const pedidosAbertos = await contarPedidosAbertos();

  return (
    <div className={styles.pagina}>
      <LateralAdmin
        rotulos={{ inicio: t.inicio, clientes: t.clientes, nichos: t.nichos, jobs: t.jobs, geracoes: t.geracoes, custos: t.custos }}
        selos={{ nichos: { quantos: pedidosAbertos, descricao: textosAdmin.pedidosDeRamo.seloAria(pedidosAbertos) } }}
        nomeDoAdmin={sessao.user.name}
        selo={t.equipe}
        marca={
          <>
            <span className={styles.logotipo}>
              <Logo altura={22} />
            </span>
            <span className={styles.simbolo}>
              <Simbolo altura={28} />
            </span>
          </>
        }
        rodape={<BotaoSair className={styles.sair} rotulo={t.sair} rotuloSaindo={t.saindo} />}
      />
      <main className={styles.corpo}>{children}</main>
    </div>
  );
}
