import Link from "next/link";
import { redirect } from "next/navigation";

import { cadastroAberto } from "@/config/cadastro";
import { destinoDaSessao } from "@/lib/destino-sem-marca";
import { sessaoAtual } from "@/lib/sessao";
import { clienteAtivoDoUsuario } from "@/servicos/clientes";
import { textosEntrar } from "@/textos/entrar";
import { Logo } from "@/ui/Logo";

import { FormularioEntrar } from "./FormularioEntrar";
import { LimparCachesAoEntrar } from "./LimparCachesAoEntrar";
import styles from "./page.module.css";

export default async function Entrar({ searchParams }: { searchParams: Promise<{ esqueci?: string }> }) {
  const { esqueci } = await searchParams;
  const sessao = await sessaoAtual();
  if (sessao) {
    // Com sessao e sem marca, "/hoje" mandava de volta para ca (laco): `destinoDaSessao` leva a conta sem marca a tela propria.
    redirect(destinoDaSessao(sessao.user.role, Boolean(await clienteAtivoDoUsuario(sessao.user.id))));
  }

  return (
    <div className={styles.pagina}>
      <LimparCachesAoEntrar />
      <div className={styles.coluna}>
        <div className={styles.envoltorio}>
          <Logo altura={44} />
          <h1 className={styles.titulo}>{textosEntrar.titulo}</h1>
          <FormularioEntrar comecarEsquecendo={esqueci === "1"} />
        </div>
        {/* E63 PR 2: com a chave do cadastro ligada, o rodapé leva a quem ainda não tem conta; desligada, a tela fica como sempre foi. */}
        {cadastroAberto() ? (
          <p className={styles.rodape}>
            {textosEntrar.cadastro.pergunta}{" "}
            <Link href="/criar-conta" className={styles.linkRodape}>
              {textosEntrar.cadastro.botao}
            </Link>
          </p>
        ) : null}
      </div>
    </div>
  );
}
