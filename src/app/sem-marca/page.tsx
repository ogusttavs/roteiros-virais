import { redirect } from "next/navigation";

import { BotaoSair } from "@/app/(painel)/(completo)/conta/BotaoSair";
import { destinoDaSessao } from "@/lib/destino-sem-marca";
import { sessaoAtual } from "@/lib/sessao";
import { clienteAtivoDoUsuario } from "@/servicos/clientes";
import { senhaEhProvisoria } from "@/servicos/senha";
import { textosSemMarca } from "@/textos/sem-marca";
import { Logo } from "@/ui/Logo";

import styles from "./page.module.css";

/**
 * Onde cai quem tem sessao e nao tem marca ativa (marca apagada, convite sem marca). Fora do grupo `(painel)` de proposito, como `/comecar` e `/trocar-senha`: o layout do
 * painel manda para ca, e o proprio layout nao pode barrar a tela. Quebra o laco `/hoje` > `/comecar` > `/entrar` > `/hoje` (`src/lib/destino-sem-marca.ts`).
 *
 * Sem sessao volta a entrar; quem na verdade tem marca (ligaram agora) ou e admin segue para o lugar certo, entao a tela nunca fica no caminho de uma conta que funciona.
 */
export default async function SemMarca() {
  const sessao = await sessaoAtual();
  if (!sessao) redirect("/entrar");
  // E58: a senha provisoria do convite se troca antes de qualquer outra coisa, tambem para quem ainda nao tem marca.
  if (sessao.user.role !== "admin" && (await senhaEhProvisoria(sessao.user.id))) redirect("/trocar-senha");

  const temMarca = Boolean(await clienteAtivoDoUsuario(sessao.user.id));
  const destino = destinoDaSessao(sessao.user.role, temMarca);
  if (destino !== "/sem-marca") redirect(destino);

  return (
    <div className={styles.pagina}>
      <main className={styles.envoltorio} data-sem-marca="">
        <Logo altura={44} />
        <h1 className={styles.titulo}>{textosSemMarca.titulo}</h1>
        <p className={styles.explica}>{textosSemMarca.explica}</p>
        <p className={styles.conta}>
          <span className={styles.contaRotulo}>{textosSemMarca.contaLabel}</span>
          <span className={styles.contaEmail} data-conta-email="">
            {sessao.user.email}
          </span>
        </p>
        <p className={styles.explica}>{textosSemMarca.depoisDeLigar}</p>
        <div className={styles.acoes}>
          <BotaoSair className={styles.sair} />
        </div>
      </main>
    </div>
  );
}
