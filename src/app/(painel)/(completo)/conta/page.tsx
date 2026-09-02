import { redirect } from "next/navigation";

import { sessaoAtual } from "@/lib/sessao";
import { clienteDoUsuario } from "@/servicos/clientes";
import { textosConta } from "@/textos/conta";
import { Cartao } from "@/ui/componentes/Cartao";

import { BotaoSair } from "./BotaoSair";
import styles from "./page.module.css";

export default async function Conta() {
  const sessao = await sessaoAtual();
  if (!sessao) {
    redirect("/entrar");
  }

  const cliente = await clienteDoUsuario(sessao.user.id);
  const perfis = cliente?.perfis;
  const listaPerfis = [perfis?.instagram, perfis?.tiktok, perfis?.youtube].filter(Boolean);

  return (
    <div className={styles.pagina}>
      <h1>{textosConta.titulo}</h1>

      <Cartao>
        <div className={styles.linha}>
          <span className={styles.rotulo}>{textosConta.nome}</span>
          <span className={styles.valor}>{sessao.user.name}</span>
        </div>
        <div className={styles.linha}>
          <span className={styles.rotulo}>{textosConta.email}</span>
          <span className={styles.valor}>{sessao.user.email}</span>
        </div>
        <div className={styles.linha}>
          <span className={styles.rotulo}>{textosConta.perfis}</span>
          <span className={styles.valor}>
            {listaPerfis.length > 0 ? listaPerfis.join(", ") : textosConta.semPerfil}
          </span>
        </div>
      </Cartao>

      <Cartao variante="recuada">
        <div className={styles.linha}>
          <span className={styles.rotulo}>{textosConta.lembreteTitulo}</span>
          <span className={styles.valor}>{textosConta.lembreteDescricao}</span>
        </div>
      </Cartao>

      <BotaoSair />
    </div>
  );
}
